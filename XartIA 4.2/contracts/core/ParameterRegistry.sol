// SPDX-License-Identifier: AGPL-3.0
pragma solidity 0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Errors} from "../math/Errors.sol";
import {IParameterRegistry} from "./IParameterRegistry.sol";

/// @title ParameterRegistry — реестр управляемых параметров с bounds
/// @notice register() — onlyOwner. Владелец при деплое — XartIAFactory; после registerParams()
///         ownership передаётся Safe Multisig через finalize().
contract ParameterRegistry is IParameterRegistry, Ownable {
    mapping(bytes32 => ParamInfo) private _params;

    constructor() Ownable(msg.sender) {}

    function register(bytes32 param, address target, bytes4 setter, uint256 min, uint256 max)
        external
        override
        onlyOwner
    {
        if (target == address(0)) revert Errors.InvalidAddress();
        if (setter == bytes4(0)) revert Errors.InvalidParam();
        if (min > max) revert Errors.InvalidParam();
        if (_params[param].exists) revert Errors.AlreadyInitialized();

        _params[param] = ParamInfo(target, setter, min, max, true);
    }

    function get(bytes32 param) external view override returns (ParamInfo memory) {
        return _params[param];
    }

    function isValid(bytes32 param, uint256 value) external view override returns (bool) {
        ParamInfo memory p = _params[param];
        if (!p.exists) return false;
        return value >= p.min && value <= p.max;
    }
}
