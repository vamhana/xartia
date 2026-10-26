// SPDX-License-Identifier: AGPL-3.0
pragma solidity 0.8.24;

/// @title Types — общие типы для библиотек математики
/// @notice Разрывает циклическую зависимость CurveMath ↔ Levels. Только struct.
library Types {
    /// @notice Уровень bonding curve. b_i вычисляется на лету как (P_end − P_start)/(S_end − S_start).
    struct Level {
        uint256 S_start;
        uint256 S_end;
        uint256 P_start;
        uint256 P_end;
        uint256 maxBalance;
    }
}
