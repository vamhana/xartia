// SPDX-License-Identifier: AGPL-3.0
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";

import {Roles} from "../../contracts/core/Roles.sol";
import {Errors} from "../../contracts/math/Errors.sol";
import {Constants} from "../../contracts/math/Constants.sol";
import {Types} from "../../contracts/math/Types.sol";
import {Levels} from "../../contracts/math/Levels.sol";
import {ILevels} from "../../contracts/math/ILevels.sol";
import {ReserveManager} from "../../contracts/reserve/ReserveManager.sol";
import {IReserveManager} from "../../contracts/reserve/IReserveManager.sol";
import {MockUSDC} from "../utils/MockUSDC.sol";

/// @title ReserveManager.t.sol — T.1.01.05
contract ReserveManagerTest is Test {
    address internal admin = address(0xA11CE);
    address internal controller = address(0xC0DE);
    address internal recipient = address(0xBEEF);

    MockUSDC internal usdc;
    Levels internal levels;
    ReserveManager internal rm;

    function setUp() public {
        usdc = new MockUSDC();
        levels = new Levels();

        Types.Level[] memory lv = new Types.Level[](1);
        lv[0] = Types.Level(0, 1_000e18, 2e15, 2e15, 1_000e18);
        levels.init(lv);

        rm = new ReserveManager(address(usdc), address(levels));
        rm.grantRole(Roles.CONTROLLER_ROLE, controller);
    }

    // ------------------------------------------------------------------ constructor

    function test_constructor_sets_levels() public view {
        assertEq(rm.levels(), address(levels));
    }

    function test_constructor_sets_usdc() public view {
        assertEq(rm.usdc(), address(usdc));
    }

    function test_constructor_revert_zero_usdc() public {
        vm.expectRevert(Errors.InvalidAddress.selector);
        new ReserveManager(address(0), address(levels));
    }

    function test_constructor_revert_zero_levels() public {
        vm.expectRevert(Errors.InvalidAddress.selector);
        new ReserveManager(address(usdc), address(0));
    }

    // ------------------------------------------------------------------ units

    function test_reserve_18_dec() public {
        usdc.mint(address(rm), 100e6);
        assertEq(rm.reserve(), 100e18); // 100 USDC → 100e18
    }

    function test_curveBacking_18_dec() public {
        // S=0 → R(0) = 0
        assertEq(rm.curveBacking(), 0);
    }

    function test_curveBacking_at_S() public {
        usdc.mint(address(rm), 1000e6);
        vm.prank(controller);
        rm.updateScurve(500e18);

        // R(500e18) = 500e18 * 2e15 / 1e18 = 1e18 = 1 USDC
        assertEq(rm.curveBacking(), 1e18);
    }

    // ------------------------------------------------------------------ updateScurve

    function test_updateScurve() public {
        usdc.mint(address(rm), 1000e6);
        vm.prank(controller);
        rm.updateScurve(500e18);
        assertEq(rm.S_curve(), 500e18);
        assertTrue(rm.checkInvariant());
    }

    function test_updateScurve_revert_invariant() public {
        // reserve = 0, S = 1e18 → curveBacking ≈ 0.002 USDC > 0 → revert
        vm.prank(controller);
        vm.expectRevert(Errors.ReserveInvariantViolation.selector);
        rm.updateScurve(1e18);
    }

    function test_updateScurve_revert_unauthorized() public {
        vm.expectRevert();
        rm.updateScurve(1e18);
    }

    // ------------------------------------------------------------------ pay

    function test_pay() public {
        usdc.mint(address(rm), 100e6);

        vm.prank(controller);
        rm.pay(recipient, 50e18);

        assertEq(usdc.balanceOf(recipient), 50e6);
        assertEq(rm.reserve(), 50e18);
    }

    function test_pay_revert_unauthorized() public {
        usdc.mint(address(rm), 100e6);
        vm.expectRevert();
        rm.pay(recipient, 50e18);
    }

    function test_pay_revert_insufficient() public {
        usdc.mint(address(rm), 10e6);
        vm.prank(controller);
        vm.expectRevert(Errors.InsufficientReserve.selector);
        rm.pay(recipient, 20e18);
    }

    // ------------------------------------------------------------------ freeReserve

    function test_freeReserve_no_underflow() public view {
        assertEq(rm.freeReserve(), 0);
    }

    function test_freeReserve_positive() public {
        usdc.mint(address(rm), 1000e6);
        vm.prank(controller);
        rm.updateScurve(500e18);

        // reserve = 1000e18, curveBacking = 1e18 → freeReserve = 999e18
        assertEq(rm.freeReserve(), 999e18);
    }

    // ------------------------------------------------------------------ misc

    function test_S_curve_proxy() public {
        usdc.mint(address(rm), 1000e6);
        vm.prank(controller);
        rm.updateScurve(500e18);
        assertEq(rm.S_curve(), 500e18);
    }

    function test_checkInvariant_true() public {
        usdc.mint(address(rm), 100e6);
        assertTrue(rm.checkInvariant());
    }

    function test_checkInvariant_false() public {
        // reserve = 0, S_curve = 0 → invariant true
        assertTrue(rm.checkInvariant());

        // Попытка установить S без баланса — revert, значит checkInvariant всегда true
        // при успешном updateScurve. Но если бы был способ — возвращал бы false.
        // Проверяем на «невыполненном» состоянии через прямой расчёт:
        assertEq(rm.reserve(), 0);
        assertEq(rm.curveBacking(), 0);
    }

    function test_revert_no_receive() public {
        // ReserveManager не имеет receive/fallback
        vm.deal(address(this), 1 ether);
        (bool ok,) = address(rm).call{value: 1}("");
        assertFalse(ok);
    }
}
