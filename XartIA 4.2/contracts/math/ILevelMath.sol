// SPDX-License-Identifier: AGPL-3.0
pragma solidity 0.8.24;

import {Types} from "./Types.sol";

/// @title ILevelMath — интерфейс атомарных расчётов уровня
interface ILevelMath {
    function a(Types.Level memory level) external pure returns (uint256);
    function b(Types.Level memory level) external pure returns (uint256);
    function P_i(uint256 S, Types.Level memory level) external pure returns (uint256);
    function R_i(uint256 S, Types.Level memory level) external pure returns (uint256);
    function inBounds(uint256 S, Types.Level memory level) external pure returns (bool);
}
