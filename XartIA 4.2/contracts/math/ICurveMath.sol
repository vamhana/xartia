// SPDX-License-Identifier: AGPL-3.0
pragma solidity 0.8.24;

import {Types} from "./Types.sol";

/// @title ICurveMath — интерфейс математики bonding curve
/// @notice Используется в моках и для внешних интеграций. Реализация — internal-библиотека
///         CurveMath, развёртывается через CurveMathWrapper (C.2.01.13).
interface ICurveMath {
    function P(uint256 S, Types.Level[] memory levels) external pure returns (uint256);
    function R(uint256 S, Types.Level[] memory levels) external pure returns (uint256);
    function deltaSForBuy(uint256 S, uint256 X, Types.Level[] memory levels) external pure returns (uint256);
    function amountForRedeem(uint256 S, uint256 deltaS, Types.Level[] memory levels) external pure returns (uint256);
    function getLevel(uint256 S, Types.Level[] memory levels) external pure returns (uint8);
}
