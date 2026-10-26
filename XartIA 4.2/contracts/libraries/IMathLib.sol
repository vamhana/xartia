// SPDX-License-Identifier: AGPL-3.0
pragma solidity 0.8.24;

/// @title IMathLib — интерфейс математических утилит
/// @notice Используется в моках тестов (T.1.01.14).
interface IMathLib {
    function mulDiv(uint256 a, uint256 b, uint256 c) external pure returns (uint256);
    function mulDivUp(uint256 a, uint256 b, uint256 c) external pure returns (uint256);
    function sqrt(uint256 x) external pure returns (uint256);
    function min(uint256 a, uint256 b) external pure returns (uint256);
    function max(uint256 a, uint256 b) external pure returns (uint256);
    function abs(int256 x) external pure returns (uint256);
}
