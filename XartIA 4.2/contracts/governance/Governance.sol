// SPDX-License-Identifier: AGPL-3.0
pragma solidity 0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

import {Errors} from "../math/Errors.sol";
import {IParameterRegistry} from "../core/IParameterRegistry.sol";
import {ITimelock} from "./ITimelock.sol";
import {IGovernance} from "./IGovernance.sol";

/// @title Governance — единственный вход для Safe Multisig в Timelock
/// @notice Все мутации — onlySafe. propose проверяет bounds через ParameterRegistry,
///         затем ставит задачу в Timelock (target и setter берутся из реестра).
///         Governance не зависит от целевых контрактов — только от реестра и Timelock.
/// @dev AccessControl наследуется только для хранения DEFAULT_ADMIN_ROLE.
///      GOVERNANCE_ROLE здесь не используется — все вызовы onlySafe.
contract Governance is IGovernance, AccessControl {
    address public immutable override safe;
    address public immutable timelock;
    address public immutable registry;

    modifier onlySafe() {
        if (msg.sender != safe) revert Errors.Unauthorized();
        _;
    }

    constructor(address safe_, address timelock_, address registry_) {
        if (safe_ == address(0)) revert Errors.InvalidAddress();
        if (timelock_ == address(0)) revert Errors.InvalidAddress();
        if (registry_ == address(0)) revert Errors.InvalidAddress();
        safe = safe_;
        timelock = timelock_;
        registry = registry_;
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    /// @inheritdoc IGovernance
    function propose(bytes32 param, uint256 value) external override onlySafe {
        IParameterRegistry registry_ = IParameterRegistry(registry);
        if (!registry_.isValid(param, value)) revert Errors.OutOfBounds();

        IParameterRegistry.ParamInfo memory info = registry_.get(param);
        ITimelock(timelock).queue(param, value, info.target, info.setter);
    }

    /// @inheritdoc IGovernance
    function execute(bytes32 param) external override onlySafe {
        ITimelock(timelock).execute(param);
    }

    /// @inheritdoc IGovernance
    function cancel(bytes32 param) external override onlySafe {
        ITimelock(timelock).cancel(param);
    }

    /// @inheritdoc IGovernance
    function getProposal(bytes32 param)
        external
        view
        override
        returns (uint256 value, address target, bytes4 setter, uint256 executeAfter, bool exists)
    {
        return ITimelock(timelock).get(param);
    }
}
