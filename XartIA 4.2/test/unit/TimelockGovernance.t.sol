// SPDX-License-Identifier: AGPL-3.0
pragma solidity 0.8.24;

import {Roles} from "../../contracts/core/Roles.sol";
import {Constants} from "../../contracts/math/Constants.sol";
import {Errors} from "../../contracts/math/Errors.sol";
import {ParameterRegistry} from "../../contracts/core/ParameterRegistry.sol";
import {Timelock} from "../../contracts/governance/Timelock.sol";
import {Governance} from "../../contracts/governance/Governance.sol";
import {MockSafe} from "../utils/MockSafe.sol";
import {TimeHelpers} from "../utils/TimeHelpers.sol";

/// @title TimelockGovernance.t.sol — T.1.01.21
/// @notice Integration: propose → queue → execute через реальный target.
contract TimelockGovernanceTest is TimeHelpers {
    address internal target = address(0xC0DE);
    bytes4 internal setter = bytes4(keccak256("setX(uint256)"));
    bytes32 internal param = keccak256("PARAM_TEST");

    MockSafe internal safe;
    ParameterRegistry internal registry;
    Timelock internal timelock;
    Governance internal governance;
    TargetContract internal targetC;

    function setUp() public {
        safe = new MockSafe();
        registry = new ParameterRegistry();
        timelock = new Timelock();
        governance = new Governance(address(safe), address(timelock), address(registry));

        timelock.grantRole(Roles.GOVERNANCE_ROLE, address(governance));

        targetC = new TargetContract();
        registry.register(param, address(targetC), TargetContract.setX.selector, 0, 1000);
    }

    function test_full_cycle() public {
        // 1. propose через safe
        vm.prank(address(safe));
        governance.propose(param, 500);

        // 2. Ожидание timelock
        warpBy(Constants.TIMELOCK_DELAY + 1);

        // 3. execute
        vm.prank(address(safe));
        governance.execute(param);

        // 4. Сеттер сработал
        assertEq(targetC.x(), 500);
    }

    function test_cancel() public {
        vm.prank(address(safe));
        governance.propose(param, 500);

        vm.prank(address(safe));
        governance.cancel(param);

        (,,,, bool exists) = governance.getProposal(param);
        assertFalse(exists);

        // Попытка execute — NotQueued
        warpBy(Constants.TIMELOCK_DELAY + 1);
        vm.prank(address(safe));
        vm.expectRevert(Errors.NotQueued.selector);
        governance.execute(param);
    }

    function test_delay_enforced() public {
        vm.prank(address(safe));
        governance.propose(param, 500);

        // До истечения delay — DeadlineExpired
        warpBy(Constants.TIMELOCK_DELAY - 1);
        vm.prank(address(safe));
        vm.expectRevert(Errors.DeadlineExpired.selector);
        governance.execute(param);
    }

    function test_revert_unauthorized() public {
        vm.prank(address(0xBAD));
        vm.expectRevert(Errors.Unauthorized.selector);
        governance.propose(param, 500);
    }
}

/// @dev Target с сеттером для полного цикла.
contract TargetContract {
    uint256 public x;

    function setX(uint256 v) external {
        x = v;
    }
}
