// SPDX-License-Identifier: AGPL-3.0
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";

import {Roles} from "../../contracts/core/Roles.sol";
import {Constants} from "../../contracts/math/Constants.sol";
import {Errors} from "../../contracts/math/Errors.sol";
import {ParameterRegistry} from "../../contracts/core/ParameterRegistry.sol";
import {IParameterRegistry} from "../../contracts/core/IParameterRegistry.sol";
import {Timelock} from "../../contracts/governance/Timelock.sol";
import {Governance} from "../../contracts/governance/Governance.sol";
import {MockSafe} from "../utils/MockSafe.sol";
import {TimeHelpers} from "../utils/TimeHelpers.sol";

/// @title Governance.t.sol — T.1.01.08
contract GovernanceTest is TimeHelpers {
    address internal target;
    bytes4 internal setter = bytes4(keccak256("setX(uint256)"));
    bytes32 internal param = keccak256("PARAM_TEST");

    MockSafe internal safe;
    ParameterRegistry internal registry;
    Timelock internal timelock;
    Governance internal governance;

    function setUp() public {
        safe = new MockSafe();
        registry = new ParameterRegistry();
        timelock = new Timelock();
        target = address(new TargetContract());
        governance = new Governance(address(safe), address(timelock), address(registry));

        // выдаём роли: GOVERNANCE_ROLE в Timelock — Governance-контракту
        timelock.grantRole(Roles.GOVERNANCE_ROLE, address(governance));

        // регистрируем тестовый параметр с bounds [0, 100]
        registry.register(param, target, setter, 0, 100);
    }

    // ------------------------------------------------------------------ propose

    function test_propose() public {
        vm.prank(address(safe));
        governance.propose(param, 50);

        (uint256 value, address t, bytes4 s, uint256 executeAfter, bool exists) = governance.getProposal(param);
        assertEq(value, 50);
        assertEq(t, target);
        assertEq(s, setter);
        assertEq(executeAfter, block.timestamp + Constants.TIMELOCK_DELAY);
        assertTrue(exists);
    }

    function test_propose_revert_out_of_bounds() public {
        vm.prank(address(safe));
        vm.expectRevert(Errors.OutOfBounds.selector);
        governance.propose(param, 101);
    }

    function test_propose_revert_unknown_param() public {
        vm.prank(address(safe));
        vm.expectRevert(Errors.OutOfBounds.selector);
        governance.propose(keccak256("UNKNOWN"), 50);
    }

    function test_propose_revert_unauthorized() public {
        vm.expectRevert(Errors.Unauthorized.selector);
        governance.propose(param, 50);
    }

    // ------------------------------------------------------------------ execute / cancel

    function test_execute() public {
        vm.prank(address(safe));
        governance.propose(param, 50);

        warpBy(Constants.TIMELOCK_DELAY + 1);

        // target — EOA без кода, execute ревертит с InvalidParam
        // Это ожидаемо: нет реального сеттера. Проверяем только, что вызов доходит.
        vm.prank(address(safe));
        governance.execute(param);
        assertEq(TargetContract(target).x(), 50);
    }

    function test_cancel() public {
        vm.prank(address(safe));
        governance.propose(param, 50);

        vm.prank(address(safe));
        governance.cancel(param);

        (,,,, bool exists) = governance.getProposal(param);
        assertFalse(exists);
    }

    function test_cancel_revert_not_queued() public {
        vm.prank(address(safe));
        vm.expectRevert(Errors.NotQueued.selector);
        governance.cancel(param);
    }

    // ------------------------------------------------------------------ onlySafe

    function test_revert_unauthorized() public {
        vm.prank(address(0xBAD));
        vm.expectRevert(Errors.Unauthorized.selector);
        governance.propose(param, 50);

        vm.prank(address(0xBAD));
        vm.expectRevert(Errors.Unauthorized.selector);
        governance.execute(param);

        vm.prank(address(0xBAD));
        vm.expectRevert(Errors.Unauthorized.selector);
        governance.cancel(param);
    }

    // ------------------------------------------------------------------ immutability

    function test_immutability() public view {
        assertEq(governance.safe(), address(safe));
        assertEq(governance.timelock(), address(timelock));
        assertEq(governance.registry(), address(registry));
    }

    // ------------------------------------------------------------------ timelock delay

    function test_timelock() public {
        vm.prank(address(safe));
        governance.propose(param, 50);

        // Через 7 дней — можно execute
        assertEq(timelock.delay(), Constants.TIMELOCK_DELAY);
        assertEq(Constants.TIMELOCK_DELAY, 7 days);
    }
}

contract TargetContract {
    uint256 public x;

    function setX(uint256 v) external {
        x = v;
    }
}
