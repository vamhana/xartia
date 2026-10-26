// SPDX-License-Identifier: AGPL-3.0
pragma solidity 0.8.24;

/// @title IReserveManager — интерфейс менеджера резерва
/// @notice Все учётные величины (reserve, curveBacking, freeReserve) — 18 decimals.
///         AccessControl-методы не включены — используются через IAccessControl(address).
interface IReserveManager {
    function updateScurve(uint256 newScurve) external;
    function pay(address to, uint256 amount_18) external;
    function reserve() external view returns (uint256);
    function curveBacking() external view returns (uint256);
    function freeReserve() external view returns (uint256);
    function S_curve() external view returns (uint256);
    function checkInvariant() external view returns (bool);
    function usdc() external view returns (address);
    function levels() external view returns (address);
}
