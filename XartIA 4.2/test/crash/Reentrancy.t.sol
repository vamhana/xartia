// SPDX-License-Identifier: AGPL-3.0
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {Errors} from "../../contracts/math/Errors.sol";
import {IReserveManager} from "../../contracts/reserve/IReserveManager.sol";
import {ICurveController} from "../../contracts/controllers/ICurveController.sol";
import {IPoolController} from "../../contracts/controllers/IPoolController.sol";
import {IXartIAToken} from "../../contracts/token/IXartIAToken.sol";
import {IXartIAFactory} from "../../contracts/factory/IXartIAFactory.sol";
import {MockUSDC} from "../utils/MockUSDC.sol";
import {ReentrancyAttacker} from "../utils/ReentrancyAttacker.sol";
import {TestHelpers} from "../utils/TestHelpers.sol";

/// @title Reentrancy.t.sol вЂ” T.5.01.13
/// @notice nonReentrant Р·Р°С‰РёС‰Р°РµС‚ РІСЃРµ trade-С„СѓРЅРєС†РёРё. РџСЂРѕРІРµСЂСЏРµС‚СЃСЏ С‡РµСЂРµР· MockUSDC-hook.
/// @dev tryReenter РїСЂРё _reenterTarget == 0 вЂ” no-op. РџСЂРё СѓСЃРїРµС€РЅРѕРј reenter вЂ” revert "Reentrancy not blocked"
///      (С‚РµСЃС‚ РїР°РґР°РµС‚, РµСЃР»Рё Р·Р°С‰РёС‚Р° РѕС‚СЃСѓС‚СЃС‚РІСѓРµС‚).
contract ReentrancyTest is TestHelpers {
    address internal factory;
    address internal usdc;
    address internal curveCtrl;
    address internal poolCtrl;
    address internal reserveMgr;
    address internal token;

    ReentrancyAttacker internal attacker;

    function setUp() public {
        setUpBase();
        usdc = mockUSDC();
        factory = deployFullSystem();
        IXartIAFactory f = IXartIAFactory(factory);
        curveCtrl = f.curveController();
        poolCtrl = f.poolController();
        reserveMgr = f.reserveManager();
        token = f.token();

        attacker = new ReentrancyAttacker();
        mintUSDC(address(attacker), 100_000_000e6);
        mintUSDC(reserveMgr, 10_000_000e6); // disable CB

        // hook СЃСЂР°Р±Р°С‚С‹РІР°РµС‚ РїСЂРё USDC-transfer, РіРґРµ from/to = attacker
        MockUSDC(usdc).setHook(address(attacker), address(attacker), ReentrancyAttacker.tryReenter.selector);
    }

    function test_reentrancy_buyFromCurve() public {
        attacker.setReenter(
            curveCtrl,
            abi.encodeWithSelector(ICurveController.buyFromCurve.selector, uint256(100e6), uint256(0), uint256(0))
        );
        attacker.attack_buyFromCurve(curveCtrl, usdc, 1000e6);
    }

    function test_reentrancy_redeemFromCurve() public {
        attacker.setReenter(
            curveCtrl,
            abi.encodeWithSelector(ICurveController.redeemFromCurve.selector, uint256(0), uint256(0), uint256(0))
        ); // no-op: заведомо ревертит
        // Seed: attacker РїРѕРєСѓРїР°РµС‚ (reenter РѕС‚РєР»СЋС‡С‘РЅ)
        attacker.attack_buyFromCurve(curveCtrl, usdc, 1000e6);
        uint256 bal = IXartIAToken(token).balanceOf(address(attacker));
        assertGt(bal, 0);

        // Attacker approve XRT в†’ curveCtrl (РґР»СЏ burnFrom)
        vm.prank(address(attacker));
        IXartIAToken(token).approve(curveCtrl, type(uint256).max);

        attacker.setReenter(
            curveCtrl, abi.encodeWithSelector(ICurveController.redeemFromCurve.selector, bal, uint256(0), uint256(0))
        );
        attacker.attack_redeemFromCurve(curveCtrl, bal);
    }

    function test_reentrancy_buyFromPool() public {
        attacker.setReenter(
            poolCtrl,
            abi.encodeWithSelector(IPoolController.buyFromPool.selector, uint256(100e6), uint256(0), uint256(0))
        );
        attacker.attack_buyFromPool(poolCtrl, usdc, 1000e6);
    }

    function test_reentrancy_sellToPool() public {
        attacker.setReenter(
            curveCtrl,
            abi.encodeWithSelector(ICurveController.redeemFromCurve.selector, uint256(0), uint256(0), uint256(0))
        ); // no-op: заведомо ревертит
        // Seed: attacker РїРѕРєСѓРїР°РµС‚ Рё approve XRT Рє poolCtrl
        attacker.attack_buyFromCurve(curveCtrl, usdc, 1000e6);
        uint256 bal = IXartIAToken(token).balanceOf(address(attacker));

        vm.prank(address(attacker));
        IXartIAToken(token).approve(poolCtrl, type(uint256).max);

        attacker.setReenter(
            poolCtrl, abi.encodeWithSelector(IPoolController.sellToPool.selector, bal / 2, uint256(0), uint256(0))
        );
        attacker.attack_sellToPool(poolCtrl, bal / 50); // 2% от S: в дневном лимите
    }

    function test_reentrancy_buyFromCurveFor() public {
        // РџСЂСЏРјРѕР№ РґРµРїР»РѕР№: attacker = poolController
        (address cc, address tk,,, address rm,,, address tr) = deployCurveControllerForReentrancy(address(attacker));
        usdc = mockUSDC(); // helper создал новый MockUSDC
        mintUSDC(address(attacker), 100_000_000e6);

        // Attacker = poolController. РЈ РЅРµРіРѕ РµСЃС‚СЊ USDC Рё approve.
        attacker.setReenter(
            cc, abi.encodeWithSelector(ICurveController.redeemFromCurve.selector, uint256(1e18), uint256(0), uint256(0))
        );

        vm.prank(address(attacker));
        MockUSDC(usdc).approve(cc, type(uint256).max);
        // buyFromCurveFor: safeTransferFrom(attacker в†’ reserveManager) в†’ hook в†’ tryReenter в†’ redeemFromCurve в†’ nonReentrant в†’ revert
        attacker.attack_buyFromCurveFor(cc, usdc, address(0xCAFE), 1000e18);
    }

    function test_buyFromCurveFor_revert_unauthorized_sender() public {
        vm.prank(address(0xBAD));
        vm.expectRevert(Errors.Unauthorized.selector);
        ICurveController(curveCtrl).buyFromCurveFor(address(0xCAFE), 1000e18, 0, 0);
    }
}
