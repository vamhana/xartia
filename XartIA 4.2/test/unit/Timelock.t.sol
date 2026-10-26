// SPDX-License-Identifier: AGPL-3.0
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";

import {Roles} from "../../contracts/core/Roles.sol";
import {Constants} from "../../contracts/math/Constants.sol";
import {Errors} from "../../contracts/math/Errors.sol";
import {Timelock} from "../../contracts/governance/Timelock.sol";
import {Events} from "../../contracts/events/Events.sol";
import {CallFailTarget} from "../utils/CallFailTarget.sol";
import {TimeHelpers} from "../utils/TimeHelpers.sol";

/// @title Timelock.t.sol — T.1.01.12
contract TimelockTest is TimeHelpers {
    address internal gov = address(0x60F);
    bytes32 internal param = keccak256("PARAM_TEST");
    bytes4 internal setter = bytes4(keccak256("setX(uint256)"));

    Timelock internal timelock;
    SimpleTarget internal target;
    CallFailTarget internal failTarget;

    function setUp() public {
        timelock = new Timelock();
        timelock.grantRole(Roles.GOVERNANCE_ROLE, gov);

        target = new SimpleTarget();
        failTarget = new CallFailTarget();
    }

    // ------------------------------------------------------------------ queue

    function test_queue() public {
        vm.prank(gov);
        timelock.queue(param, 50, address(target), SimpleTarget.setX.selector);

        (uint256 value, address t, bytes4 s, uint256 executeAfter, bool exists) = timelock.get(param);
        assertEq(value, 50);
        assertEq(t, address(target));
        assertEq(s, SimpleTarget.setX.selector);
        assertEq(executeAfter, block.timestamp + Constants.TIMELOCK_DELAY);
        assertTrue(exists);
    }

    function test_queue_emit() public {
        uint256 expected = block.timestamp + Constants.TIMELOCK_DELAY;
        vm.expectEmit(true, false, false, true);
        emit Events.Queued(param, 50, expected);

        vm.prank(gov);
        timelock.queue(param, 50, address(target), SimpleTarget.setX.selector);
    }

    function test_queue_revert_already_queued() public {
        vm.prank(gov);
        timelock.queue(param, 50, address(target), SimpleTarget.setX.selector);

        vm.prank(gov);
        vm.expectRevert(Errors.AlreadyQueued.selector);
        timelock.queue(param, 60, address(target), SimpleTarget.setX.selector);
    }

    function test_queue_revert_target_no_code() public {
        address eoa = address(0xE0A);
        vm.prank(gov);
        vm.expectRevert(Errors.InvalidParam.selector);
        timelock.queue(param, 50, eoa, SimpleTarget.setX.selector);
    }

    function test_queue_revert_zero_setter() public {
        vm.prank(gov);
        vm.expectRevert(Errors.InvalidParam.selector);
        timelock.queue(param, 50, address(target), bytes4(0));
    }

    function test_queue_revert_unauthorized() public {
        vm.prank(address(0xBAD));
        vm.expectRevert();
        timelock.queue(param, 50, address(target), SimpleTarget.setX.selector);
    }

    // ------------------------------------------------------------------ execute

    function test_execute() public {
        vm.prank(gov);
        timelock.queue(param, 50, address(target), SimpleTarget.setX.selector);

        warpBy(Constants.TIMELOCK_DELAY + 1);

        vm.prank(gov);
        timelock.execute(param);

        assertEq(target.x(), 50);
    }

    function test_execute_clears_entry() public {
        vm.prank(gov);
        timelock.queue(param, 50, address(target), SimpleTarget.setX.selector);
        warpBy(Constants.TIMELOCK_DELAY + 1);
        vm.prank(gov);
        timelock.execute(param);

        (,,,, bool exists) = timelock.get(param);
        assertFalse(exists);
    }

    function test_execute_revert_not_queued() public {
        vm.prank(gov);
        vm.expectRevert(Errors.NotQueued.selector);
        timelock.execute(param);
    }

    function test_execute_revert_deadline() public {
        vm.prank(gov);
        timelock.queue(param, 50, address(target), SimpleTarget.setX.selector);

        // Не прошло 7 дней
        warpBy(Constants.TIMELOCK_DELAY - 1);

        vm.prank(gov);
        vm.expectRevert(Errors.DeadlineExpired.selector);
        timelock.execute(param);
    }

    function test_execute_revert_call_failed() public {
        vm.prank(gov);
        timelock.queue(param, 50, address(failTarget), CallFailTarget.failSetter.selector);

        warpBy(Constants.TIMELOCK_DELAY + 1);

        vm.prank(gov);
        vm.expectRevert(Errors.CallFailed.selector);
        timelock.execute(param);
    }

    function test_execute_revert_target_no_code() public {
        vm.prank(gov);
        timelock.queue(param, 50, address(target), SimpleTarget.setX.selector);

        // Симулируем потерю кода у target (selfdestruct на старых цепочках / vm.etch)
        vm.etch(address(target), "");

        warpBy(Constants.TIMELOCK_DELAY + 1);

        vm.prank(gov);
        vm.expectRevert(Errors.InvalidParam.selector);
        timelock.execute(param);
    }

    // ------------------------------------------------------------------ cancel

    function test_cancel() public {
        vm.prank(gov);
        timelock.queue(param, 50, address(target), SimpleTarget.setX.selector);

        vm.prank(gov);
        timelock.cancel(param);

        (,,,, bool exists) = timelock.get(param);
        assertFalse(exists);
    }

    function test_cancel_clears_entry() public {
        test_cancel();
    }

    function test_cancel_revert_not_queued() public {
        vm.prank(gov);
        vm.expectRevert(Errors.NotQueued.selector);
        timelock.cancel(param);
    }

    // ------------------------------------------------------------------ delay / repeat

    function test_delay() public view {
        assertEq(timelock.delay(), Constants.TIMELOCK_DELAY);
        assertEq(Constants.TIMELOCK_DELAY, 7 days);
    }

    function test_queue_after_execute() public {
        vm.prank(gov);
        timelock.queue(param, 50, address(target), SimpleTarget.setX.selector);
        warpBy(Constants.TIMELOCK_DELAY + 1);
        vm.prank(gov);
        timelock.execute(param);

        // После execute можно queue снова
        vm.prank(gov);
        timelock.queue(param, 60, address(target), SimpleTarget.setX.selector);

        (,,,, bool exists) = timelock.get(param);
        assertTrue(exists);
    }
}

/// @dev Простой target с сеттером — используется в queue/execute.
contract SimpleTarget {
    uint256 public x;

    function setX(uint256 v) external {
        x = v;
    }
}
