// SPDX-License-Identifier: AGPL-3.0
pragma solidity 0.8.24;

/// @title ICircuitBreaker — интерфейс предохранителя
/// @notice AccessControl-методы не включены.
interface ICircuitBreaker {
    function active() external view returns (bool);
    function threshold() external view returns (uint256);
    function setThreshold(uint256) external;
    function reserveManager() external view returns (address);
}
