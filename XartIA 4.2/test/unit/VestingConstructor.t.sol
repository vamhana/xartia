// SPDX-License-Identifier: AGPL-3.0
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";

import {Errors} from "../../contracts/math/Errors.sol";
import {Vesting, VESTING_CLIFF, VESTING_DURATION} from "../../contracts/vesting/Vesting.sol";

/// @title VestingConstructor.t.sol — T.1.01.25
contract VestingConstructorTest is Test {
    address internal safe = address(0x5AFE);
    address internal token = address(0x70CE);

    function test_constructor_sets_beneficiary() public {
        Vesting v = new Vesting(safe, token);
        assertEq(v.beneficiary(), safe);
    }

    function test_constructor_sets_token() public {
        Vesting v = new Vesting(safe, token);
        assertEq(v.token(), token);
    }

    function test_constructor_sets_cliff() public {
        Vesting v = new Vesting(safe, token);
        assertEq(v.vestingCliff(), 365 days);
        assertEq(VESTING_CLIFF, 365 days);
    }

    function test_constructor_sets_duration() public {
        Vesting v = new Vesting(safe, token);
        assertEq(v.vestingDuration(), 730 days);
        assertEq(VESTING_DURATION, 730 days);
    }

    function test_constructor_revert_safe_zero() public {
        vm.expectRevert(Errors.InvalidAddress.selector);
        new Vesting(address(0), token);
    }

    function test_constructor_revert_token_zero() public {
        vm.expectRevert(Errors.InvalidAddress.selector);
        new Vesting(safe, address(0));
    }
}
