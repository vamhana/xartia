// SPDX-License-Identifier: AGPL-3.0
pragma solidity 0.8.24;

/// @title IVesting — доменный интерфейс вестинга командных токенов
/// @notice AccessControl-методы не включены — используются через IAccessControl(address).
interface IVesting {
    function addTokens(uint256 amount) external;
    function totalAdded() external view returns (uint256);
    function release() external;
    function vestedAmount() external view returns (uint256);
    function releasable() external view returns (uint256);
    function beneficiary() external view returns (address);
}
