// SPDX-License-Identifier: AGPL-3.0
pragma solidity 0.8.24;

/// @title ITimelock — интерфейс отложенного исполнения
interface ITimelock {
    function queue(bytes32 param, uint256 value, address target, bytes4 setter) external;
    function execute(bytes32 param) external;
    function cancel(bytes32 param) external;
    function get(bytes32 param)
        external
        view
        returns (uint256 value, address target, bytes4 setter, uint256 executeAfter, bool exists);
    function delay() external pure returns (uint256);
}
