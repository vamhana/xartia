// SPDX-License-Identifier: AGPL-3.0
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";

import {Roles} from "../../contracts/core/Roles.sol";
import {Constants} from "../../contracts/math/Constants.sol";
import {Errors} from "../../contracts/math/Errors.sol";
import {IReserveManager} from "../../contracts/reserve/IReserveManager.sol";
import {CircuitBreaker} from "../../contracts/safety/CircuitBreaker.sol";

/// @title FuzzCircuitBreaker.t.sol — T.2.01.07
contract FuzzCircuitBreakerTest is Test {
    address internal rmMock = address(0xDEAD);
    address internal timelock = address(0x71E);

    CircuitBreaker internal cb;

    function setUp() public {
        cb = new CircuitBreaker(1000, rmMock);
        cb.grantRole(Roles.GOVERNANCE_ROLE, timelock);
    }

    /// @notice active() == (fr * BP / r < threshold), при r > 0. При r == 0 → false.
    function testFuzz_active(uint256 r, uint256 fr) public {
        r = bound(r, 0, 1_000_000e18);
        fr = bound(fr, 0, r);

        vm.mockCall(rmMock, abi.encodeWithSelector(IReserveManager.reserve.selector), abi.encode(r));
        vm.mockCall(rmMock, abi.encodeWithSelector(IReserveManager.freeReserve.selector), abi.encode(fr));

        bool expected;
        if (r == 0) {
            expected = false;
        } else {
            expected = (fr * Constants.BASIS_POINTS) / r < 1000;
        }

        assertEq(cb.active(), expected, "active mismatch");
    }

    function testFuzz_setThreshold(uint256 t) public {
        t = bound(t, 50, 2000);

        vm.prank(timelock);
        cb.setThreshold(t);
        assertEq(cb.threshold(), t);
    }

    function testFuzz_setThreshold_outOfBounds(uint256 t) public {
        // Всё, что вне [50, 2000] — revert
        vm.assume(t < 50 || t > 2000);

        vm.prank(timelock);
        vm.expectRevert(Errors.OutOfBounds.selector);
        cb.setThreshold(t);
    }
}
