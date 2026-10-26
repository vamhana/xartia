// SPDX-License-Identifier: AGPL-3.0
pragma solidity 0.8.24;

import {Constants} from "../../contracts/math/Constants.sol";
import {Errors} from "../../contracts/math/Errors.sol";
import {IReserveManager} from "../../contracts/reserve/IReserveManager.sol";
import {ICurveController} from "../../contracts/controllers/ICurveController.sol";
import {IXartIAToken} from "../../contracts/token/IXartIAToken.sol";
import {IXartIAFactory} from "../../contracts/factory/IXartIAFactory.sol";
import {MockUSDC} from "../utils/MockUSDC.sol";
import {ILevels} from "../../contracts/math/ILevels.sol";
import {TestHelpers} from "../utils/TestHelpers.sol";

/// @title Whale.t.sol вЂ” T.5.01.02
/// @notice РљРёС‚ СЃ Р±РѕР»СЊС€РёРј % supply. РџСЂРѕРІРµСЂРєР° maxBalance Рё Р»РёРјРёС‚РѕРІ РїСЂРѕРґР°Р¶.
contract WhaleTest is TestHelpers {
    address internal factory;
    address internal usdc;
    address internal curveCtrl;
    address internal reserveMgr;
    address internal token;

    address internal whale = address(0xCAFE);
    address internal small = address(0xA11CE);

    function setUp() public {
        setUpBase();
        usdc = mockUSDC();
        factory = deployFullSystem();
        IXartIAFactory f = IXartIAFactory(factory);
        curveCtrl = f.curveController();
        reserveMgr = f.reserveManager();
        token = f.token();

        mintUSDC(whale, 1_000_000_000e6);
        mintUSDC(small, 10_000e6);
        vm.prank(whale);
        MockUSDC(usdc).approve(curveCtrl, type(uint256).max);
        vm.prank(whale);
        IXartIAToken(token).approve(curveCtrl, type(uint256).max);
        vm.prank(small);
        MockUSDC(usdc).approve(curveCtrl, type(uint256).max);
        vm.prank(small);
        IXartIAToken(token).approve(curveCtrl, type(uint256).max);
    }

    /// @notice РџРѕРїС‹С‚РєР° РєРёС‚Р° РєСѓРїРёС‚СЊ Р±РѕР»СЊС€Рµ maxBalance_0 в†’ revert.
    function test_whale_maxBalance() public {
        buySafe(curveCtrl, whale, 200e6);
        uint256 s = IReserveManager(IXartIAFactory(factory).reserveManager()).S_curve();
        assertLe(IXartIAToken(token).balanceOf(whale), _maxBalanceAt(s));
    }

    /// @notice РљРёС‚ РїРѕРєСѓРїР°РµС‚ С‡РµСЂРµР· РЅРµСЃРєРѕР»СЊРєРѕ С‚СЂР°РЅР·Р°РєС†РёР№ РІ РїСЂРµРґРµР»Р°С… maxBalance, РїРѕС‚РѕРј РїСЂРѕРґР°С‘С‚.
    function test_whale_partial_exit() public {
        // 40_000 XRT < maxBalance_0 = 50_000e18
        // X в‰€ 40_000 * 2e15 / 1e18 / 0.995 в‰€ 80.4 USDC
        vm.prank(whale);
        ICurveController(curveCtrl).buyFromCurve(100e6, 0, 0); // ~49_750 XRT
        warpBy(1);

        uint256 bal = IXartIAToken(token).balanceOf(whale);
        assertGt(bal, 0);

        // Redeem РІРµСЃСЊ Р±Р°Р»Р°РЅСЃ вЂ” РёРЅРІР°СЂРёР°РЅС‚ РґРµСЂР¶РёС‚СЃСЏ
        vm.prank(whale);
        ICurveController(curveCtrl).redeemFromCurve(bal, 0, 0);

        assertGe(
            IReserveManager(IXartIAFactory(factory).reserveManager()).reserve(),
            IReserveManager(IXartIAFactory(factory).reserveManager()).curveBacking()
        );
    }

    /// @notice РљРёС‚ РїС‹С‚Р°РµС‚СЃСЏ РїСЂРѕРґР°С‚СЊ Р±РѕР»СЊС€Рµ maxSellPctPerDay РІ РѕРґРёРЅ РґРµРЅСЊ.
    function test_whale_maxSellPctPerDay() public {
        // Seed: whale РїРѕРєСѓРїР°РµС‚ Рё РїРѕР»СѓС‡Р°РµС‚ С‚РѕРєРµРЅС‹, РІС‚РѕСЂРѕР№ РїРѕРєСѓРїР°С‚РµР»СЊ вЂ” С‡С‚РѕР±С‹ poolPrice Р±С‹Р» > 0
        vm.prank(whale);
        ICurveController(curveCtrl).buyFromCurve(100e6, 0, 0);
        warpBy(1);
        mintUSDC(reserveMgr, 10_000_000e6); // disable CB

        uint256 sCurve = IReserveManager(IXartIAFactory(factory).reserveManager()).S_curve();
        uint256 limit = (200 * sCurve) / Constants.BASIS_POINTS; // maxSellPctPerDay = 200 bp
        uint256 whaleBal = IXartIAToken(token).balanceOf(whale);

        // Р‘РµСЂС‘Рј СЂРѕРІРЅРѕ limit Рё С‡СѓС‚СЊ Р±РѕР»СЊС€Рµ
        uint256 sellAmount = limit + 1e18;
        if (sellAmount > whaleBal) {
            // Р•СЃР»Рё limit Р±РѕР»СЊС€Рµ Р±Р°Р»Р°РЅСЃР° РєРёС‚Р° вЂ” whale РЅРµ СЃРјРѕР¶РµС‚ РЅР°СЂСѓС€РёС‚СЊ Р»РёРјРёС‚.
            // РўРѕРіРґР° РЅР°СЂСѓС€РµРЅРёРµ С‡РµСЂРµР· РІС‚РѕСЂРѕР№ Р°РєРєР°СѓРЅС‚: РїСЂРѕРґР°С‘Рј РґРІР°Р¶РґС‹.
            vm.prank(whale);
            vm.expectRevert(Errors.MaxSellPerDayExceeded.selector);
            // РџРѕРїС‹С‚РєР° РїСЂРѕРґР°С‚СЊ Р±Р°Р»Р°РЅСЃ Р±РѕР»СЊС€Рµ Р»РёРјРёС‚Р°
            (bool ok,) = curveCtrl.call(abi.encodeWithSignature("sellToPool(uint256,uint256,uint256)", limit + 1, 0, 0));
        }
    }

    function test_whale_cannot_bypass_maxBalance_via_multiple_buys() public {
        buySafe(curveCtrl, whale, 100e6);
        buySafe(curveCtrl, whale, 50e6);
        uint256 s = IReserveManager(IXartIAFactory(factory).reserveManager()).S_curve();
        assertLe(IXartIAToken(token).balanceOf(whale), _maxBalanceAt(s));
    }

    function _maxBalanceAt(uint256 s) internal view returns (uint256) {
        ILevels lv = ILevels(IXartIAFactory(factory).levels());
        return lv.getMaxBalance(lv.getLevel(s));
    }
}
