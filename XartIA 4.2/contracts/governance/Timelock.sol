// SPDX-License-Identifier: AGPL-3.0
pragma solidity 0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

import {Roles} from "../core/Roles.sol";
import {Constants} from "../math/Constants.sol";
import {Errors} from "../math/Errors.sol";
import {Events} from "../events/Events.sol";
import {ITimelock} from "./ITimelock.sol";

/// @title Timelock — отложенное исполнение governance-решений
/// @notice Задержка TIMELOCK_DELAY = 7 days. queue/execute/cancel — только GOVERNANCE_ROLE
///         (выдаётся Governance-контракту в Factory.deploy). target должен быть контрактом
///         (code.length > 0) — и при queue, и при execute.
/// @dev execute вызывает target низкоуровневым call'ом с (setter, value). Ошибки target'а
///      теряются — наружу отдаётся CallFailed. Это осознанно: Timelock не интерпретирует
///      чужие revert'ы, а индексирует факт провала через событие Executed (не эмитится
///      при CallFailed — revert до эмиссии).
contract Timelock is ITimelock, AccessControl, Events {
    struct Entry {
        uint256 value;
        address target;
        bytes4 setter;
        uint256 executeAfter;
        bool exists;
    }

    mapping(bytes32 => Entry) private _entries;

    constructor() {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    /// @inheritdoc ITimelock
    function queue(bytes32 param, uint256 value, address target, bytes4 setter)
        external
        override
        onlyRole(Roles.GOVERNANCE_ROLE)
    {
        if (target.code.length == 0) revert Errors.InvalidParam();
        if (setter == bytes4(0)) revert Errors.InvalidParam();
        if (_entries[param].exists) revert Errors.AlreadyQueued();

        uint256 executeAfter = block.timestamp + Constants.TIMELOCK_DELAY;
        _entries[param] =
            Entry({value: value, target: target, setter: setter, executeAfter: executeAfter, exists: true});
        emit Queued(param, value, executeAfter);
    }

    /// @inheritdoc ITimelock
    function execute(bytes32 param) external override onlyRole(Roles.GOVERNANCE_ROLE) {
        Entry memory e = _entries[param];
        if (!e.exists) revert Errors.NotQueued();
        if (block.timestamp < e.executeAfter) revert Errors.DeadlineExpired();
        if (e.target.code.length == 0) revert Errors.InvalidParam();

        (bool success,) = e.target.call(abi.encodeWithSelector(e.setter, e.value));
        if (!success) revert Errors.CallFailed();

        delete _entries[param];
        emit Executed(param, e.value);
    }

    /// @inheritdoc ITimelock
    function cancel(bytes32 param) external override onlyRole(Roles.GOVERNANCE_ROLE) {
        if (!_entries[param].exists) revert Errors.NotQueued();
        delete _entries[param];
        emit Cancelled(param);
    }

    /// @inheritdoc ITimelock
    function get(bytes32 param)
        external
        view
        override
        returns (uint256 value, address target, bytes4 setter, uint256 executeAfter, bool exists)
    {
        Entry memory e = _entries[param];
        return (e.value, e.target, e.setter, e.executeAfter, e.exists);
    }

    /// @inheritdoc ITimelock
    function delay() external pure override returns (uint256) {
        return Constants.TIMELOCK_DELAY;
    }
}
