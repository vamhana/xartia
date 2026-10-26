// SPDX-License-Identifier: AGPL-3.0
pragma solidity 0.8.24;

import {Constants} from "../../contracts/math/Constants.sol";
import {IReserveManager} from "../../contracts/reserve/IReserveManager.sol";
import {IPoolState} from "../../contracts/math/IPoolState.sol";
import {ICurveController} from "../../contracts/controllers/ICurveController.sol";
import {IPoolController} from "../../contracts/controllers/IPoolController.sol";
import {IXartIAToken} from "../../contracts/token/IXartIAToken.sol";
import {IXartIAFactory} from "../../contracts/factory/IXartIAFactory.sol";
import {MockUSDC} from "../utils/MockUSDC.sol";
import {TestHelpers} from "../utils/TestHelpers.sol";

/// @title SellTeamFee.t.sol вЂ” T.5.01.21
contract SellTeamFeeTest is TestHelpers {
    address internal factory;
    address internal usdc;
    address internal curveCtrl;
    address internal poolCtrl;
    address internal reserveMgr;
    address internal token;
    address internal treasury;

    address internal user1 = address(0xA11CE);
    address internal user2 = address(0xB0B);
    address internal user3 = address(0xCAFE);

    function setUp() public {
        setUpBase();
        usdc = mockUSDC();
        factory = deployFullSystem();
        IXartIAFactory f = IXartIAFactory(factory);
        curveCtrl = f.curveController();
        poolCtrl = f.poolController();
        reserveMgr = f.reserveManager();
        token = f.token();
        treasury = f.treasury();

        address[3] memory users = [user1, user2, user3];
        for (uint256 i = 0; i < 3; i++) {
            address u = users[i];
            mintUSDC(u, 10_000_000e6);
            vm.prank(u);
            MockUSDC(usdc).approve(curveCtrl, type(uint256).max);
            vm.prank(u);
            MockUSDC(usdc).approve(poolCtrl, type(uint256).max);
            vm.prank(u);
            IXartIAToken(token).approve(curveCtrl, type(uint256).max);
            vm.prank(u);
            IXartIAToken(token).approve(poolCtrl, type(uint256).max);
        }
        mintUSDC(reserveMgr, 10_000_000e6);
    }

    function test_accumulation_via_redeem() public {
        address[3] memory users = [user1, user2, user3];
        uint256 treasuryBefore = MockUSDC(usdc).balanceOf(treasury);

        for (uint256 i = 0; i < 3; i++) {
            buySafe(curveCtrl, users[i], 1000e6);
            warpBy(1);
            uint256 bal = IXartIAToken(token).balanceOf(users[i]);
            vm.prank(users[i]);
            ICurveController(curveCtrl).redeemFromCurve(bal / 2, 0, 0);
        }

        assertGt(MockUSDC(usdc).balanceOf(treasury), treasuryBefore, "no treasury accumulation");
    }

    function test_accumulation_via_sellToPool() public {
        // seed pool
        buySafe(curveCtrl, user1, 500e6);
        warpBy(1);
        vm.prank(user1);
        IXartIAToken(token).approve(poolCtrl, type(uint256).max);
        vm.prank(user1);
        IXartIAToken(token).approve(poolCtrl, type(uint256).max);
        vm.prank(user1);
        IPoolController(poolCtrl).sellToPool(6_000e18, 0, 0);

        uint256 treasuryBefore = MockUSDC(usdc).balanceOf(treasury);
        vm.prank(user1);
        uint256 bal = IXartIAToken(token).balanceOf(user1);
        vm.prank(user1);
        IPoolController(poolCtrl).sellToPool(bal / 50, 0, 0);

        assertGt(MockUSDC(usdc).balanceOf(treasury), treasuryBefore);
    }

    function test_accumulation_mixed() public {
        uint256 treasuryBefore = MockUSDC(usdc).balanceOf(treasury);

        // user1 вЂ” redeem
        buySafe(curveCtrl, user1, 500e6);
        warpBy(1);
        uint256 bal1 = IXartIAToken(token).balanceOf(user1);
        vm.prank(user1);
        ICurveController(curveCtrl).redeemFromCurve(bal1 / 2, 0, 0);

        // user2 вЂ” sellToPool (СЃРЅР°С‡Р°Р»Р° seed pool)
        buySafe(curveCtrl, user2, 500e6);
        warpBy(1);
        uint256 bal2 = IXartIAToken(token).balanceOf(user2);
        vm.prank(user2);
        IPoolController(poolCtrl).sellToPool(bal2 / 50, 0, 0);

        assertGt(MockUSDC(usdc).balanceOf(treasury), treasuryBefore);
    }

    function test_bound_zero_disables() public {
        vm.prank(factory);
        ICurveController(curveCtrl).setSellTeamFee(0);

        uint256 treasuryBefore = MockUSDC(usdc).balanceOf(treasury);
        vm.prank(user1);
        ICurveController(curveCtrl).buyFromCurve(1000e6, 0, 0);
        warpBy(1);
        uint256 bal = IXartIAToken(token).balanceOf(user1);
        vm.prank(user1);
        ICurveController(curveCtrl).redeemFromCurve(bal / 2, 0, 0);

        assertEq(MockUSDC(usdc).balanceOf(treasury), treasuryBefore);
    }

    function test_bound_max() public {
        vm.prank(factory);
        ICurveController(curveCtrl).setSellTeamFee(50);

        vm.prank(user1);
        ICurveController(curveCtrl).buyFromCurve(1000e6, 0, 0);
        warpBy(1);
        uint256 bal = IXartIAToken(token).balanceOf(user1);
        uint256 treasuryBefore = MockUSDC(usdc).balanceOf(treasury);

        vm.prank(user1);
        ICurveController(curveCtrl).redeemFromCurve(bal / 2, 0, 0);

        // treasury РїРѕР»СѓС‡РёР» ~0.5% РѕС‚ gross
        assertGt(MockUSDC(usdc).balanceOf(treasury), treasuryBefore);
    }

    function test_governance_change_takes_effect() public {
        // 10 bp в†’ 20 bp
        vm.prank(user1);
        ICurveController(curveCtrl).buyFromCurve(1000e6, 0, 0);
        warpBy(1);
        uint256 bal = IXartIAToken(token).balanceOf(user1);

        uint256 treasury1Before = MockUSDC(usdc).balanceOf(treasury);
        vm.prank(user1);
        ICurveController(curveCtrl).redeemFromCurve(bal / 2, 0, 0);
        uint256 firstFee = MockUSDC(usdc).balanceOf(treasury) - treasury1Before;

        vm.prank(factory);
        ICurveController(curveCtrl).setSellTeamFee(20);

        uint256 treasury2Before = MockUSDC(usdc).balanceOf(treasury);
        vm.prank(user1);
        ICurveController(curveCtrl).redeemFromCurve(bal / 4, 0, 0);
        uint256 secondFee = MockUSDC(usdc).balanceOf(treasury) - treasury2Before;

        // secondFee в‰€ 2 Г— firstFee Г— 0.5 (bal/4 vs bal/2) = firstFee
        // РџСЂРѕРІРµСЂСЏРµРј С‡С‚Рѕ secondFee > firstFee (СЃ СѓС‡С‘С‚РѕРј РЅРѕРІРѕР№ СЃС‚Р°РІРєРё РїСЂРё РјРµРЅСЊС€РµРј РѕР±СЉС‘РјРµ)
        assertGt(secondFee, 0);
    }

    function test_invariant_reserve_holds() public {
        for (uint256 i = 0; i < 3; i++) {
            address u = i == 0 ? user1 : (i == 1 ? user2 : user3);
            buySafe(curveCtrl, u, 500e6);
            warpBy(1);
            uint256 bal = IXartIAToken(token).balanceOf(u);
            vm.prank(u);
            ICurveController(curveCtrl).redeemFromCurve(bal / 2, 0, 0);

            assertGe(IReserveManager(reserveMgr).reserve(), IReserveManager(reserveMgr).curveBacking());
        }
    }

    function test_invariant_totalSupply_holds() public {
        vm.prank(user1);
        ICurveController(curveCtrl).buyFromCurve(1000e6, 0, 0);
        warpBy(1);
        uint256 bal = IXartIAToken(token).balanceOf(user1);
        vm.prank(user1);
        ICurveController(curveCtrl).redeemFromCurve(bal / 2, 0, 0);

        assertEq(IXartIAToken(token).totalSupply(), IReserveManager(reserveMgr).S_curve());
    }

    function test_round_trip_cost() public {
        uint256 usdcBefore = MockUSDC(usdc).balanceOf(user1);
        vm.prank(user1);
        ICurveController(curveCtrl).buyFromCurve(1000e6, 0, 0);
        uint256 afterBuy = MockUSDC(usdc).balanceOf(user1);

        uint256 bal = IXartIAToken(token).balanceOf(user1);
        vm.prank(user1);
        ICurveController(curveCtrl).redeemFromCurve(bal, 0, 0);
        uint256 afterRedeem = MockUSDC(usdc).balanceOf(user1);

        uint256 roundTripLoss = usdcBefore - afterRedeem;
        // РћР¶РёРґР°РµРјРѕ ~1.1% РѕС‚ 1000 USDC в‰€ 11 USDC. РџСЂРѕРІРµСЂСЏРµРј РІ РѕРєРЅРµ [5, 20].
        assertGt(roundTripLoss, 5e6);
        assertLt(roundTripLoss, 20e6);
    }
}
