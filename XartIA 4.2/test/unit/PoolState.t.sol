// SPDX-License-Identifier: AGPL-3.0
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";

import {Roles} from "../../contracts/core/Roles.sol";
import {Errors} from "../../contracts/math/Errors.sol";
import {PoolState} from "../../contracts/math/PoolState.sol";
import {IPoolState} from "../../contracts/math/IPoolState.sol";
import {Events} from "../../contracts/events/Events.sol";

/// @title PoolState.t.sol — T.1.01.20
contract PoolStateTest is Test {
    address internal admin = address(0xA11CE);
    address internal priceWriter = address(0xC0DE);
    address internal poolWriter = address(0xBEEF);

    PoolState internal ps;

    function setUp() public {
        ps = new PoolState();
        ps.grantRole(Roles.PRICE_WRITER_ROLE, priceWriter);
        ps.grantRole(Roles.POOL_WRITER_ROLE, poolWriter);
    }

    // ------------------------------------------------------------------ initialize

    function test_initializePoolPrice() public {
        ps.initializePoolPrice(2e15);
        assertEq(ps.poolPrice(), 2e15);
    }

    function test_initializePoolPrice_emit() public {
        vm.expectEmit(false, false, false, true);
        emit Events.PoolPriceInitialized(2e15);
        ps.initializePoolPrice(2e15);
    }

    function test_initializePoolPrice_revert_twice() public {
        ps.initializePoolPrice(2e15);
        vm.expectRevert(Errors.AlreadyInitialized.selector);
        ps.initializePoolPrice(3e15);
    }

    function test_initializePoolPrice_revert_zero() public {
        vm.expectRevert(Errors.InvalidAmount.selector);
        ps.initializePoolPrice(0);
    }

    function test_initializePoolPrice_revert_unauthorized() public {
        vm.prank(admin);
        vm.expectRevert();
        ps.initializePoolPrice(2e15);
    }

    // ------------------------------------------------------------------ setPool

    function test_setPool_role() public {
        vm.prank(poolWriter);
        ps.setPool(100e18);
        assertEq(ps.pool(), 100e18);
    }

    function test_setPool_revert_unauthorized() public {
        vm.prank(admin);
        vm.expectRevert();
        ps.setPool(100e18);
    }

    // ------------------------------------------------------------------ setPoolPrice

    function test_setPoolPrice_curve_role() public {
        ps.initializePoolPrice(2e15);
        vm.prank(priceWriter);
        ps.setPoolPrice(3e15);
        assertEq(ps.poolPrice(), 3e15);
    }

    function test_setPoolPrice_pool_role() public {
        // PRICE_WRITER_ROLE выдана poolController'у тоже
        ps.initializePoolPrice(2e15);
        vm.prank(priceWriter);
        ps.setPoolPrice(3e15);
        assertEq(ps.poolPrice(), 3e15);
    }

    function test_setPoolPrice_emit() public {
        ps.initializePoolPrice(2e15);
        vm.expectEmit(false, false, false, true);
        emit Events.PoolPriceUpdated(2e15, 3e15);
        vm.prank(priceWriter);
        ps.setPoolPrice(3e15);
    }

    function test_setPoolPrice_revert_unauthorized() public {
        ps.initializePoolPrice(2e15);
        vm.prank(admin);
        vm.expectRevert();
        ps.setPoolPrice(3e15);
    }

    function test_revert_unauthorized() public {
        // Сводная проверка: без ролей ни setPool, ни setPoolPrice
        ps.initializePoolPrice(2e15);
        vm.prank(admin);
        vm.expectRevert();
        ps.setPool(1e18);
        vm.prank(admin);
        vm.expectRevert();
        ps.setPoolPrice(3e15);
    }
}
