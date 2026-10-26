// SPDX-License-Identifier: AGPL-3.0
pragma solidity 0.8.24;

/// @title IGovernance — интерфейс управления параметрами через Safe + Timelock
/// @notice AccessControl-методы не включены.
interface IGovernance {
    function propose(bytes32 param, uint256 value) external;
    function execute(bytes32 param) external;
    function cancel(bytes32 param) external;
    function getProposal(bytes32 param)
        external
        view
        returns (uint256 value, address target, bytes4 setter, uint256 executeAfter, bool exists);
    function safe() external view returns (address);
}
