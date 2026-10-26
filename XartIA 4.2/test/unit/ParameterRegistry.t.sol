// SPDX-License-Identifier: AGPL-3.0
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";

import {Errors} from "../../contracts/math/Errors.sol";
import {ParameterRegistry} from "../../contracts/core/ParameterRegistry.sol";
import {IParameterRegistry} from "../../contracts/core/IParameterRegistry.sol";

/// @title ParameterRegistry.t.sol — T.1.01.19
contract ParameterRegistryTest is Test {
    ParameterRegistry internal reg;
    address internal target = address(0xC0DE);
    bytes4 internal setter = bytes4(keccak256("setSomething(uint256)"));
    bytes32 internal param = keccak256("PARAM_TEST");

    function setUp() public {
        reg = new ParameterRegistry();
    }

    function test_register() public {
        reg.register(param, target, setter, 0, 100);
        IParameterRegistry.ParamInfo memory info = reg.get(param);
        assertEq(info.target, target);
        assertEq(info.setter, setter);
        assertEq(info.min, 0);
        assertEq(info.max, 100);
        assertTrue(info.exists);
    }

    function test_get_unregistered() public view {
        IParameterRegistry.ParamInfo memory info = reg.get(param);
        assertFalse(info.exists);
    }

    function test_isValid() public {
        reg.register(param, target, setter, 10, 100);
        assertFalse(reg.isValid(param, 9));
        assertTrue(reg.isValid(param, 10));
        assertTrue(reg.isValid(param, 50));
        assertTrue(reg.isValid(param, 100));
        assertFalse(reg.isValid(param, 101));
    }

    function test_isValid_unregistered() public view {
        assertFalse(reg.isValid(param, 50));
    }

    function test_revert_unauthorized() public {
        vm.prank(address(0xBAD));
        vm.expectRevert();
        reg.register(param, target, setter, 0, 100);
    }

    function test_revert_invalid_bounds() public {
        vm.expectRevert(Errors.InvalidParam.selector);
        reg.register(param, target, setter, 100, 0); // min > max
    }

    function test_revert_zero_target() public {
        vm.expectRevert(Errors.InvalidAddress.selector);
        reg.register(param, address(0), setter, 0, 100);
    }

    function test_revert_zero_setter() public {
        vm.expectRevert(Errors.InvalidParam.selector);
        reg.register(param, target, bytes4(0), 0, 100);
    }

    function test_revert_duplicate() public {
        reg.register(param, target, setter, 0, 100);
        vm.expectRevert(Errors.AlreadyInitialized.selector);
        reg.register(param, target, setter, 0, 100);
    }
}
