// SPDX-License-Identifier: AGPL-3.0
pragma solidity 0.8.24;

import {Types} from "./Types.sol";
import {MathLib} from "../libraries/MathLib.sol";

/// @title LevelMath — атомарные расчёты уровня bonding curve
/// @notice Все функции internal pure. Единицы: S, P, R — 18-dec.
library LevelMath {
    uint256 private constant SCALE = 1e18;

    function a(Types.Level memory level) internal pure returns (uint256) {
        return level.P_start;
    }

    /// @dev (P_end − P_start)/(S_end − S_start) целочисленно. Для типовых параметров
    ///      (P ~ 1e15, S_end ~ 1e22+) даёт 0 — не используется в P_i/R_i (там mulDiv).
    function b(Types.Level memory level) internal pure returns (uint256) {
        if (level.S_end == level.S_start) return 0;
        return (level.P_end - level.P_start) / (level.S_end - level.S_start);
    }

    function P_i(uint256 S, Types.Level memory level) internal pure returns (uint256) {
        uint256 D = level.S_end - level.S_start;
        if (D == 0) return level.P_start;
        if (S <= level.S_start) return level.P_start;
        if (S >= level.S_end) return level.P_end;
        uint256 d = S - level.S_start;
        return level.P_start + MathLib.mulDiv(level.P_end - level.P_start, d, D);
    }

    /// @dev R_i(S) — интеграл от P_start до S (не от S_start, а накопленный внутри уровня от его начала).
    ///      R_i(S_start) = 0, R_i(S_end) = площадь трапеции.
    function R_i(uint256 S, Types.Level memory level) internal pure returns (uint256) {
        uint256 D = level.S_end - level.S_start;
        if (D == 0) return 0;
        if (S <= level.S_start) return 0;
        uint256 capped = S > level.S_end ? level.S_end : S;
        uint256 d = capped - level.S_start;

        uint256 linearPart = MathLib.mulDiv(level.P_start, d, SCALE);
        uint256 quadPart = MathLib.mulDiv(level.P_end - level.P_start, d * d, 2 * D * SCALE);
        return linearPart + quadPart;
    }

    /// @dev Полуинтервал [S_start, S_end). Для getLevel граница S_end_i относится к уровню i+1.
    function inBounds(uint256 S, Types.Level memory level) internal pure returns (bool) {
        return S >= level.S_start && S < level.S_end;
    }
}
