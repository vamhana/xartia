// SPDX-License-Identifier: AGPL-3.0
pragma solidity 0.8.24;

interface IParameterRegistry {
    struct ParamInfo {
        address target;
        bytes4 setter;
        uint256 min;
        uint256 max;
        bool exists;
    }

    function register(bytes32 param, address target, bytes4 setter, uint256 min, uint256 max) external;
    function get(bytes32 param) external view returns (ParamInfo memory);
    function isValid(bytes32 param, uint256 value) external view returns (bool);
}
