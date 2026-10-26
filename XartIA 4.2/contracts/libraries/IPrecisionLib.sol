// SPDX-License-Identifier: AGPL-3.0
pragma solidity 0.8.24;

/// @title IPrecisionLib — интерфейс конвертации 18↔6 decimals
/// @notice Используется в моках тестов (T.1.01.15).
interface IPrecisionLib {
    function toUSDC(uint256 amount18) external pure returns (uint256);
    function fromUSDC(uint256 amount6) external pure returns (uint256);
    function toWei(uint256 amount6) external pure returns (uint256);
    function fromWei(uint256 amount18) external pure returns (uint256);
}
