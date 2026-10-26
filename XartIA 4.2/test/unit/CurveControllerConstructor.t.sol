// SPDX-License-Identifier: AGPL-3.0
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";

import {Errors} from "../../contracts/math/Errors.sol";
import {CurveController} from "../../contracts/controllers/CurveController.sol";

/// @title CurveControllerConstructor.t.sol — T.1.01.23
contract CurveControllerConstructorTest is Test {
    address internal rm = address(0x1);
    address internal vesting = address(0x2);
    address internal cb = address(0x3);
    address internal ps = address(0x4);
    address internal token = address(0x5);
    address internal levels = address(0x6);
    address internal usdc = address(0x7);
    address internal treasury = address(0x8);

    function _deploy(address treasury_) internal returns (CurveController c) {
        c = new CurveController(rm, vesting, cb, ps, token, levels, usdc, treasury_);
    }

    function test_constructor_sets_reserveManager() public {
        assertEq(_deploy(treasury).reserveManager(), rm);
    }

    function test_constructor_sets_vesting() public {
        assertEq(_deploy(treasury).vesting(), vesting);
    }

    function test_constructor_sets_circuitBreaker() public {
        assertEq(_deploy(treasury).circuitBreaker(), cb);
    }

    function test_constructor_sets_poolState() public {
        assertEq(_deploy(treasury).poolState(), ps);
    }

    function test_constructor_sets_token() public {
        assertEq(_deploy(treasury).token(), token);
    }

    function test_constructor_sets_levels() public {
        assertEq(_deploy(treasury).levels(), levels);
    }

    function test_constructor_sets_usdc() public {
        assertEq(_deploy(treasury).usdc(), usdc);
    }

    function test_constructor_sets_treasury() public {
        assertEq(_deploy(treasury).treasury(), treasury);
    }

    function test_constructor_revert_treasury_zero() public {
        vm.expectRevert(Errors.InvalidAddress.selector);
        _deploy(address(0));
    }
}
