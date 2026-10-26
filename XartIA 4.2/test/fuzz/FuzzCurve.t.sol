// SPDX-License-Identifier: AGPL-3.0
pragma solidity 0.8.24;

import {Constants} from "../../contracts/math/Constants.sol";
import {IReserveManager} from "../../contracts/reserve/IReserveManager.sol";
import {ICurveController} from "../../contracts/controllers/ICurveController.sol";
import {IXartIAToken} from "../../contracts/token/IXartIAToken.sol";
import {IXartIAFactory} from "../../contracts/factory/IXartIAFactory.sol";
import {MockUSDC} from "../utils/MockUSDC.sol";
import {TestHelpers} from "../utils/TestHelpers.sol";

/// @title FuzzCurve.t.sol — T.2.01.01
contract FuzzCurveTest is TestHelpers {
    address internal factory;
    address internal token;
    address internal curveCtrl;
    address internal poolCtrl;
    address internal reserveMgr;
    address internal usdc;

    address internal user = address(0xA11CE);

    function setUp() public {
        setUpBase();
        factory = deployFullSystem();
        IXartIAFactory f = IXartIAFactory(factory);
        token = f.token();
        curveCtrl = f.curveController();
        poolCtrl = f.poolController();
        reserveMgr = f.reserveManager();
        usdc = mockUSDC();

        mintUSDC(user, 1_000_000_000e6);
        vm.prank(user);
        MockUSDC(usdc).approve(curveCtrl, type(uint256).max);
        vm.prank(user);
        MockUSDC(usdc).approve(poolCtrl, type(uint256).max);
        vm.prank(user);
        IXartIAToken(token).approve(curveCtrl, type(uint256).max);
        vm.prank(user);
        IXartIAToken(token).approve(poolCtrl, type(uint256).max);
    }

    function testFuzz_buy(uint256 X_6) public {
        // Первая покупка: X_6 ∈ [effectiveMinimalX6, maxPurchasePct без genesis-лимита]
        // На genesis maxPurchasePct не применяется. Берём до 1M USDC — больше maxBalance не влезет.
        X_6 = bound(X_6, 1_005_026, 99e6); // ≤ maxBalance уровня 0 (50k токенов)

        uint256 rmBefore = IReserveManager(reserveMgr).reserve();
        uint256 userTokensBefore = IXartIAToken(token).balanceOf(user);

        vm.prank(user);
        uint256 tokens = ICurveController(curveCtrl).buyFromCurve(X_6, 0, 0);

        assertGt(tokens, 0);
        assertEq(IXartIAToken(token).balanceOf(user), userTokensBefore + tokens);
        assertEq(IReserveManager(reserveMgr).reserve() - rmBefore, uint256(X_6) * 1e12);
        assertGe(IReserveManager(reserveMgr).reserve(), IReserveManager(reserveMgr).curveBacking());
    }

    function testFuzz_redeem(uint256 seedX_6, uint256 deltaS) public {
        seedX_6 = bound(seedX_6, 1_005_026, 99e6);
        vm.prank(user);
        ICurveController(curveCtrl).buyFromCurve(seedX_6, 0, 0);
        warpBy(1);

        uint256 bal = IXartIAToken(token).balanceOf(user);
        if (bal == 0) return;
        deltaS = bound(deltaS, 1, bal);

        uint256 userUSDCBefore = MockUSDC(usdc).balanceOf(user);
        vm.prank(user);
        uint256 out = ICurveController(curveCtrl).redeemFromCurve(deltaS, 0, 0);

        assertGt(out, 0);
        assertEq(MockUSDC(usdc).balanceOf(user), userUSDCBefore + out / 1e12); // out — 18 dec
        assertGe(IReserveManager(reserveMgr).reserve(), IReserveManager(reserveMgr).curveBacking());
    }

    function testFuzz_buyFor(uint256 X_18) public {
        // Первая покупка через buyFromCurveFor (genesis)
        X_18 = bound(X_18, 1e18, 99e18);
        // Минтим на poolController и approve
        mintUSDC(poolCtrl, X_18 / 1e12 + 1e6);
        vm.prank(poolCtrl);
        MockUSDC(usdc).approve(curveCtrl, type(uint256).max);

        address buyer = address(0xCAFE);
        vm.prank(poolCtrl);
        uint256 tokens = ICurveController(curveCtrl).buyFromCurveFor(buyer, X_18, 0, 0);

        assertGt(tokens, 0);
        assertEq(IXartIAToken(token).balanceOf(buyer), tokens);
        assertGe(IReserveManager(reserveMgr).reserve(), IReserveManager(reserveMgr).curveBacking());
        // PoolController не остаётся с USDC-остатком (sweep не здесь, но approve);
        // BalanceOf(poolCtrl) может быть > 0 от fee-остатка, но approve не важен
    }
}
