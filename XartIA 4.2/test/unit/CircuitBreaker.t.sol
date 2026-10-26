// SPDX-License-Identifier: AGPL-3.0
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";

import {Roles} from "../../contracts/core/Roles.sol";
import {Errors} from "../../contracts/math/Errors.sol";
import {Types} from "../../contracts/math/Types.sol";
import {Levels} from "../../contracts/math/Levels.sol";
import {ReserveManager} from "../../contracts/reserve/ReserveManager.sol";
import {CircuitBreaker} from "../../contracts/safety/CircuitBreaker.sol";
import {Events} from "../../contracts/events/Events.sol";
import {MockUSDC} from "../utils/MockUSDC.sol";

/// @title CircuitBreaker.t.sol — T.1.01.07
contract CircuitBreakerTest is Test {
    address internal admin = address(0xA11CE);
    address internal timelock = address(0x71E);

    MockUSDC internal usdc;
    Levels internal levels;
    ReserveManager internal rm;
    CircuitBreaker internal cb;

    function setUp() public {
        usdc = new MockUSDC();
        levels = new Levels();

        Types.Level[] memory lv = new Types.Level[](1);
        lv[0] = Types.Level(0, 1_000_000e18, 2e15, 2e15, 1_000_000e18);
        levels.init(lv);

        rm = new ReserveManager(address(usdc), address(levels));
        cb = new CircuitBreaker(1000, address(rm));
        // GOVERNANCE_ROLE выдаётся Timelock в Factory.deploy; в unit-тесте — вручную
        cb.grantRole(Roles.GOVERNANCE_ROLE, timelock);
        rm.grantRole(Roles.CONTROLLER_ROLE, address(this));
    }

    // ------------------------------------------------------------------ constructor

    function test_constructor_sets_threshold() public view {
        assertEq(cb.threshold(), 1000);
    }

    function test_constructor_sets_reserveManager() public view {
        assertEq(cb.reserveManager(), address(rm));
    }

    function test_constructor_revert_invalid_bounds() public {
        vm.expectRevert(Errors.OutOfBounds.selector);
        new CircuitBreaker(49, address(rm));
        vm.expectRevert(Errors.OutOfBounds.selector);
        new CircuitBreaker(2001, address(rm));
    }

    function test_constructor_revert_zero_reserveManager() public {
        vm.expectRevert(Errors.InvalidAddress.selector);
        new CircuitBreaker(1000, address(0));
    }

    // ------------------------------------------------------------------ active

    function test_active_below_threshold() public {
        // reserve = 1000, curveBacking = 0 → freeReserve = 1000, ratio = 100% > 10% → inactive
        usdc.mint(address(rm), 1000e6);
        assertFalse(cb.active());
    }

    function test_active_above_threshold() public {
        // reserve = 1000, curveBacking = 0, но freeReserve = 1000 (100%) — inactive.
        // Чтобы CB сработал: freeReserve/reserve < 10%.
        // Берём S такой, что curveBacking = 950 (т.е. S = 475_000e18 при P=2e15).
        usdc.mint(address(rm), 1000e6);
        rm.updateScurve(475_000e18);
        // freeReserve = 50, ratio = 5% < 10% → active
        assertTrue(cb.active());
    }

    function test_zero_reserve() public view {
        // reserve = 0 → active = false (деление на ноль защищено)
        assertEq(rm.reserve(), 0);
        assertFalse(cb.active());
    }

    function test_freeReserve_underflow() public {
        // reserve = 0, curveBacking = 0 → freeReserve = 0 (без underflow)
        assertEq(rm.freeReserve(), 0);
        assertFalse(cb.active());
    }

    // ------------------------------------------------------------------ setThreshold

    function test_setThreshold() public {
        vm.prank(timelock);
        cb.setThreshold(2000);
        assertEq(cb.threshold(), 2000);
    }

    function test_setThreshold_emit() public {
        vm.expectEmit(false, false, false, true);
        emit Events.ThresholdUpdated(1000, 1500);
        vm.prank(timelock);
        cb.setThreshold(1500);
    }

    function test_setThreshold_revert_bounds() public {
        vm.prank(timelock);
        vm.expectRevert(Errors.OutOfBounds.selector);
        cb.setThreshold(49);

        vm.prank(timelock);
        vm.expectRevert(Errors.OutOfBounds.selector);
        cb.setThreshold(2001);
    }

    function test_setThreshold_revert_unauthorized() public {
        vm.prank(admin);
        vm.expectRevert();
        cb.setThreshold(2000);
    }
}
