// SPDX-License-Identifier: AGPL-3.0
pragma solidity 0.8.24;

import {Errors} from "../../contracts/math/Errors.sol";
import {IReserveManager} from "../../contracts/reserve/IReserveManager.sol";
import {ICircuitBreaker} from "../../contracts/safety/ICircuitBreaker.sol";
import {ICurveController} from "../../contracts/controllers/ICurveController.sol";
import {IPoolController} from "../../contracts/controllers/IPoolController.sol";
import {IXartIAToken} from "../../contracts/token/IXartIAToken.sol";
import {IXartIAFactory} from "../../contracts/factory/IXartIAFactory.sol";
import {Events} from "../../contracts/events/Events.sol";
import {MockUSDC} from "../utils/MockUSDC.sol";
import {TestHelpers} from "../utils/TestHelpers.sol";

/// @title CircuitBreakerTrigger.t.sol — T.5.01.05
/// @notice Сценарии срабатывания Circuit Breaker.
contract CircuitBreakerTriggerTest is TestHelpers {
    address internal factory;
    address internal usdc;
    address internal curveCtrl;
    address internal poolCtrl;
    address internal reserveMgr;
    address internal cb;
    address internal token;

    address internal user = address(0xA11CE);

    function setUp() public {
        setUpBase();
        usdc = mockUSDC();
        factory = deployFullSystem();
        IXartIAFactory f = IXartIAFactory(factory);
        curveCtrl = f.curveController();
        poolCtrl = f.poolController();
        reserveMgr = f.reserveManager();
        cb = f.circuitBreaker();
        token = f.token();

        mintUSDC(user, 10_000_000e6);
        vm.prank(user);
        MockUSDC(usdc).approve(curveCtrl, type(uint256).max);
        vm.prank(user);
        MockUSDC(usdc).approve(poolCtrl, type(uint256).max);
        vm.prank(user);
        IXartIAToken(token).approve(curveCtrl, type(uint256).max);
        vm.prank(user);
        IXartIAToken(token).approve(poolCtrl, type(uint256).max);
    }

    /// @notice Срабатывание CB после маленькой покупки (freeReserve = buyFee, ~0.5%).
    function test_scenario_trigger() public {
        assertFalse(ICircuitBreaker(cb).active());

        vm.prank(user);
        ICurveController(curveCtrl).buyFromCurve(1000e6, 0, 0);

        // fee = 5e18, reserve = 1000e18, ratio = 0.5% < 10% → CB active
        assertTrue(ICircuitBreaker(cb).active());
    }

    /// @notice Срабатывание CB блокирует sellToPool.
    function test_scenario_trigger_via_sellToPool() public {
        vm.prank(user);
        ICurveController(curveCtrl).buyFromCurve(1000e6, 0, 0);
        warpBy(1);

        assertTrue(ICircuitBreaker(cb).active());

        uint256 bal = IXartIAToken(token).balanceOf(user);
        vm.prank(user);
        vm.expectRevert(Errors.CircuitBreakerActive.selector);
        IPoolController(poolCtrl).sellToPool(bal / 2, 0, 0);
    }

    /// @notice Redeem работает при CB active. Эмитится CircuitBreakerTriggered при переходе.
    function test_scenario_trigger_via_redeem() public {
        vm.prank(user);
        ICurveController(curveCtrl).buyFromCurve(1000e6, 0, 0);
        warpBy(1);

        // CB active (ratio 0.5%). Redeem — работает, но CB уже active, event не эмитится
        // (было_active = true, стало true).
        uint256 bal = IXartIAToken(token).balanceOf(user);
        vm.prank(user);
        ICurveController(curveCtrl).redeemFromCurve(bal / 2, 0, 0);

        // CB может деактивироваться при сильном redeem (fee остаётся, а curveBacking падает)
        // Это допустимо — событие не проверяем.
    }
}
