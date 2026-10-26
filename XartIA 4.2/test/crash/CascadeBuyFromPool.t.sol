// SPDX-License-Identifier: AGPL-3.0
pragma solidity 0.8.24;

import {IReserveManager} from "../../contracts/reserve/IReserveManager.sol";
import {IPoolState} from "../../contracts/math/IPoolState.sol";
import {ICurveController} from "../../contracts/controllers/ICurveController.sol";
import {IPoolController} from "../../contracts/controllers/IPoolController.sol";
import {IXartIAToken} from "../../contracts/token/IXartIAToken.sol";
import {IXartIAFactory} from "../../contracts/factory/IXartIAFactory.sol";
import {MockUSDC} from "../utils/MockUSDC.sol";
import {TestHelpers} from "../utils/TestHelpers.sol";

/// @title CascadeBuyFromPool.t.sol — T.5.01.19
contract CascadeBuyFromPoolTest is TestHelpers {
    address internal factory;
    address internal usdc;
    address internal curveCtrl;
    address internal poolCtrl;
    address internal reserveMgr;
    address internal poolState;
    address internal token;

    address internal user = address(0xA11CE);
    address internal user2 = address(0xB0B);

    function setUp() public {
        setUpBase();
        usdc = mockUSDC();
        factory = deployFullSystem();
        IXartIAFactory f = IXartIAFactory(factory);
        curveCtrl = f.curveController();
        poolCtrl = f.poolController();
        reserveMgr = f.reserveManager();
        poolState = f.poolState();
        token = f.token();

        mintUSDC(user, 10_000_000e6);
        mintUSDC(user2, 10_000_000e6);
        for (uint256 i = 0; i < 2; i++) {
            address u = i == 0 ? user : user2;
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

    function _seedPool() internal {
        // user покупает на кривой, затем продаёт часть в pool
        vm.prank(user);
        ICurveController(curveCtrl).buyFromCurve(500e6, 0, 0);
        warpBy(1);
        vm.prank(user);
        IPoolController(poolCtrl).sellToPool(6_000e18, 0, 0);
    }

    function test_cascade_full_pool() public {
        // pool пуст, весь X идёт через каскад
        assertEq(IPoolState(poolState).pool(), 0);
        uint256 rmBefore = IReserveManager(reserveMgr).reserve();
        vm.prank(user2);
        uint256 tokens = IPoolController(poolCtrl).buyFromPool(1000e6, 0, 0);
        assertGt(tokens, 0);
        // reserve += X_18 полностью (fee + каскад)
        assertEq(IReserveManager(reserveMgr).reserve() - rmBefore, 1000e18);
    }

    function test_cascade_partial_pool() public {
        _seedPool();
        uint256 poolBefore = IPoolState(poolState).pool();
        assertGt(poolBefore, 0);

        // user2 покупает — часть из pool, остаток из каскада
        vm.prank(user2);
        uint256 tokens = IPoolController(poolCtrl).buyFromPool(45e6, 0, 0);
        assertGt(tokens, 0);
        assertLt(IPoolState(poolState).pool(), poolBefore); // pool уменьшился
    }

    function test_cascade_empty_pool() public {
        // pool = 0 → 100% через каскад
        test_cascade_full_pool();
    }

    function test_cascade_pool_controller_approves() public {
        // allowance(poolCtrl → curveCtrl) должен быть 0 после tx (сброшен)
        vm.prank(user2);
        IPoolController(poolCtrl).buyFromPool(1000e6, 0, 0);
        assertEq(MockUSDC(usdc).allowance(poolCtrl, curveCtrl), 0);
    }

    function test_cascade_curve_controller_pulls() public {
        uint256 rmBefore = IReserveManager(reserveMgr).reserve();
        vm.prank(user2);
        IPoolController(poolCtrl).buyFromPool(1000e6, 0, 0);
        // reserve += X_18
        assertEq(IReserveManager(reserveMgr).reserve() - rmBefore, 1000e18);
    }

    function test_cascade_allowance_reset() public {
        vm.prank(user2);
        IPoolController(poolCtrl).buyFromPool(1000e6, 0, 0);
        assertEq(MockUSDC(usdc).allowance(poolCtrl, curveCtrl), 0);
    }

    function test_cascade_fee_to_reserve() public {
        // fee_18 идёт в reserveManager на шаге 11a
        uint256 rmBefore = IReserveManager(reserveMgr).reserve();
        vm.prank(user2);
        IPoolController(poolCtrl).buyFromPool(1000e6, 0, 0);
        uint256 delta = IReserveManager(reserveMgr).reserve() - rmBefore;
        assertEq(delta, 1000e18); // весь X_18 (fee + каскад)
    }

    function test_cascade_no_usdc_left_in_pool_controller() public {
        vm.prank(user2);
        IPoolController(poolCtrl).buyFromPool(1000e6, 0, 0);
        assertEq(MockUSDC(usdc).balanceOf(poolCtrl), 0);
    }
}
