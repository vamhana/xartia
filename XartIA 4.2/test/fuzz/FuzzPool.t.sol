// SPDX-License-Identifier: AGPL-3.0
pragma solidity 0.8.24;

import {IPoolState} from "../../contracts/math/IPoolState.sol";
import {Constants} from "../../contracts/math/Constants.sol";
import {IReserveManager} from "../../contracts/reserve/IReserveManager.sol";
import {ICurveController} from "../../contracts/controllers/ICurveController.sol";
import {IPoolController} from "../../contracts/controllers/IPoolController.sol";
import {IXartIAToken} from "../../contracts/token/IXartIAToken.sol";
import {IXartIAFactory} from "../../contracts/factory/IXartIAFactory.sol";
import {MockUSDC} from "../utils/MockUSDC.sol";
import {TestHelpers} from "../utils/TestHelpers.sol";

/// @title FuzzPool.t.sol — T.2.01.02
contract FuzzPoolTest is TestHelpers {
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

        // Начальная покупка для инициализации S_curve
        vm.prank(user);
        ICurveController(curveCtrl).buyFromCurve(1000e6, 0, 0);
        // Отключаем CB, наливая USDC в резерв
        mintUSDC(reserveMgr, 10_000_000e6);
    }

    function testFuzz_buyPool(uint256 X_6) public {
        X_6 = bound(X_6, 1_005_026, 99e6); // ≤ maxBalance уровня 0

        uint256 rmBefore = IReserveManager(reserveMgr).reserve();
        uint256 userTokensBefore = IXartIAToken(token).balanceOf(user);

        vm.prank(user);
        uint256 tokens = IPoolController(poolCtrl).buyFromPool(X_6, 0, 0);

        assertGt(tokens, 0, "no tokens");
        assertEq(IXartIAToken(token).balanceOf(user), userTokensBefore + tokens);
        // reserve += X_18 (fee + каскад)
        assertEq(IReserveManager(reserveMgr).reserve() - rmBefore, uint256(X_6) * 1e12);
        // sweep-dust: PoolController держит 0 USDC
        assertEq(MockUSDC(usdc).balanceOf(poolCtrl), 0);
        // инвариант
        assertGe(IReserveManager(reserveMgr).reserve(), IReserveManager(reserveMgr).curveBacking());
    }

    function testFuzz_sellPool(uint256 deltaP) public {
        uint256 bal = IXartIAToken(token).balanceOf(user);
        uint256 sCurve = IReserveManager(reserveMgr).S_curve();
        uint256 limit = (200 * sCurve) / Constants.BASIS_POINTS;
        if (limit > bal) limit = bal;
        if (limit == 0) return;
        deltaP = bound(deltaP, 1, limit);

        uint256 rmBefore = IReserveManager(reserveMgr).reserve();
        vm.prank(user);
        IPoolController(poolCtrl).sellToPool(deltaP, 0, 0);

        assertGe(IReserveManager(reserveMgr).reserve(), IReserveManager(reserveMgr).curveBacking());
        assertLe(IReserveManager(reserveMgr).reserve(), rmBefore);
    }
}
