// SPDX-License-Identifier: AGPL-3.0
pragma solidity 0.8.24;

import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";

import {Roles} from "../../contracts/core/Roles.sol";
import {Errors} from "../../contracts/math/Errors.sol";
import {Vesting} from "../../contracts/vesting/Vesting.sol";
import {XartIAToken} from "../../contracts/token/XartIAToken.sol";
import {TestHelpers} from "../utils/TestHelpers.sol";

/// @title Vesting.t.sol — T.1.01.06
contract VestingTest is TestHelpers {
    address internal safe = address(0x5AFE);
    address internal minter = address(0xB0B);
    address internal user = address(0xA11CE);

    XartIAToken internal token;
    Vesting internal vesting;

    function setUp() public {
        token = new XartIAToken();
        vesting = new Vesting(safe, address(token));
        // Vesting конструктор выдал DEFAULT_ADMIN_ROLE msg.sender'у (этот контракт)
        vesting.grantRole(Roles.MINTER_ROLE, minter);
        token.grantRole(Roles.MINTER_ROLE, address(this));
    }

    // ------------------------------------------------------------------ addTokens

    function test_addTokens() public {
        _mintToVesting(1000e18);
        vm.prank(minter);
        vesting.addTokens(1000e18);
        assertEq(vesting.totalAdded(), 1000e18);
    }

    function test_addTokens_revert_unauthorized() public {
        vm.prank(user);
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, user, Roles.MINTER_ROLE)
        );
        vesting.addTokens(1000e18);
    }

    function test_addTokens_revert_insufficient_balance() public {
        // Не минтим в vesting — баланс 0, addTokens → revert
        vm.prank(minter);
        vm.expectRevert(Errors.InsufficientVestingBalance.selector);
        vesting.addTokens(1000e18);
    }

    function test_addTokens_revert_zero() public {
        vm.prank(minter);
        vm.expectRevert(Errors.InvalidAmount.selector);
        vesting.addTokens(0);
    }

    function test_addTokens_first_sets_vestingStart() public {
        _mintToVesting(1000e18);
        uint256 t0 = block.timestamp;
        vm.prank(minter);
        vesting.addTokens(1000e18);
        assertEq(vesting.vestingStart(), t0);
    }

    function test_addTokens_multiple_share_schedule() public {
        _mintToVesting(1000e18);
        vm.prank(minter);
        vesting.addTokens(500e18);

        uint256 start = vesting.vestingStart();

        // Второй addTokens позже — vestingStart не меняется
        warpBy(100 days);
        vm.prank(minter);
        vesting.addTokens(500e18);
        assertEq(vesting.vestingStart(), start);
        assertEq(vesting.totalAdded(), 1000e18);
    }

    // ------------------------------------------------------------------ vestedAmount

    function test_cliff() public {
        _mintToVesting(1000e18);
        vm.prank(minter);
        vesting.addTokens(1000e18);

        // До cliff — 0 vested
        warpBy(365 days - 1);
        assertEq(vesting.vestedAmount(), 0);
    }

    function test_linear_vesting() public {
        _mintToVesting(1000e18);
        vm.prank(minter);
        vesting.addTokens(1000e18);
        uint256 start = vesting.vestingStart();

        // 50% от duration (365 дней) после cliff → 50% vested
        vm.warp(start + 365 days + 365 days);
        assertEq(vesting.vestedAmount(), 500e18);

        // Полный duration → 100% vested
        vm.warp(start + 365 days + 730 days);
        assertEq(vesting.vestedAmount(), 1000e18);
    }

    // ------------------------------------------------------------------ release

    function test_release() public {
        _mintToVesting(1000e18);
        vm.prank(minter);
        vesting.addTokens(1000e18);

        warpBy(365 days + 730 days);
        vesting.release();

        assertEq(token.balanceOf(safe), 1000e18);
        assertEq(vesting.totalReleased(), 1000e18);
        assertEq(vesting.releasable(), 0);
    }

    function test_release_revert_zero() public {
        _mintToVesting(1000e18);
        vm.prank(minter);
        vesting.addTokens(1000e18);

        // Сразу после addTokens — 0 vested
        vm.expectRevert(Errors.InvalidAmount.selector);
        vesting.release();
    }

    function test_release_after_cliff() public {
        _mintToVesting(1000e18);
        vm.prank(minter);
        vesting.addTokens(1000e18);
        uint256 start = vesting.vestingStart();

        // 365 дней после cliff (т.е. 365 + 365 = 730 от старта) — 50% vested
        vm.warp(start + 365 days + 365 days);

        vesting.release();
        assertEq(token.balanceOf(safe), 500e18);
        assertEq(vesting.releasable(), 0);
    }

    // ------------------------------------------------------------------ helpers

    function _mintToVesting(uint256 amount) internal {
        token.mint(address(vesting), amount);
    }
}
