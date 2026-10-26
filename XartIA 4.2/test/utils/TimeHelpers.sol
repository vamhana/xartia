// SPDX-License-Identifier: AGPL-3.0
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";

uint256 constant VESTING_CLIFF_HELPER = 365 days;
uint256 constant VESTING_DURATION_HELPER = 730 days;

/// @title TimeHelpers — обёртки над vm.warp
abstract contract TimeHelpers is Test {
    function warpTo(uint256 timestamp) internal {
        vm.warp(timestamp);
    }

    function warpBy(uint256 seconds_) internal {
        vm.warp(block.timestamp + seconds_);
    }

    /// @dev Проскакивает cliff (365 дней) с запасом 1 сек.
    function skipCliff() internal {
        vm.warp(block.timestamp + VESTING_CLIFF_HELPER + 1);
    }

    /// @dev Проскакивает cliff + duration (365 + 730 дней) с запасом 1 сек.
    function skipVesting() internal {
        vm.warp(block.timestamp + VESTING_CLIFF_HELPER + VESTING_DURATION_HELPER + 1);
    }
}
