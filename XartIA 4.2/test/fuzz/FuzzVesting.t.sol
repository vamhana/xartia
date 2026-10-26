// SPDX-License-Identifier: AGPL-3.0
pragma solidity 0.8.24;

import {Roles} from "../../contracts/core/Roles.sol";
import {Errors} from "../../contracts/math/Errors.sol";
import {Vesting} from "../../contracts/vesting/Vesting.sol";
import {XartIAToken} from "../../contracts/token/XartIAToken.sol";
import {TestHelpers} from "../utils/TestHelpers.sol";

/// @title FuzzVesting.t.sol — T.2.01.05
contract FuzzVestingTest is TestHelpers {
    address internal safe = address(0x5AFE);
    address internal minter = address(0xB0B);

    XartIAToken internal token;
    Vesting internal vesting;

    function setUp() public {
        token = new XartIAToken();
        vesting = new Vesting(safe, address(token));
        vesting.grantRole(Roles.MINTER_ROLE, minter);
        token.grantRole(Roles.MINTER_ROLE, address(this));
    }

    function testFuzz_add(uint256 amount) public {
        amount = bound(amount, 1, 1_000_000e18);
        token.mint(address(vesting), amount);

        vm.prank(minter);
        vesting.addTokens(amount);
        assertEq(vesting.totalAdded(), amount);
    }

    function testFuzz_release(uint256 amount, uint256 elapsed) public {
        amount = bound(amount, 1, 1_000_000e18);
        elapsed = bound(elapsed, 0, 365 days + 730 days + 1 days);

        token.mint(address(vesting), amount);
        vm.prank(minter);
        vesting.addTokens(amount);
        uint256 start = vesting.vestingStart();

        vm.warp(start + elapsed);
        uint256 vested = vesting.vestedAmount();

        // Инвариант: vested ∈ [0, amount]
        assertLe(vested, amount);
        // Инвариант: vested монотонно (сравниваем с чуть большим elapsed)
        vm.warp(start + elapsed + 1);
        assertGe(vesting.vestedAmount(), vested);
    }

    function testFuzz_vestedAmount_linear(uint256 amount, uint256 elapsed) public {
        amount = bound(amount, 1e6, 1_000_000e18);
        token.mint(address(vesting), amount);
        vm.prank(minter);
        vesting.addTokens(amount);
        uint256 start = vesting.vestingStart();

        elapsed = bound(elapsed, 0, 365 days + 730 days);
        vm.warp(start + elapsed);

        uint256 vested = vesting.vestedAmount();

        if (elapsed <= 365 days) {
            assertEq(vested, 0, "vested before cliff");
        } else if (elapsed >= 365 days + 730 days) {
            assertEq(vested, amount, "vested after full duration");
        } else {
            // В окне линейности: vested ≈ amount * (elapsed - cliff) / duration
            uint256 expected = amount * (elapsed - 365 days) / 730 days;
            assertEq(vested, expected, "linear mismatch");
        }
    }
}
