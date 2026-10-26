// SPDX-License-Identifier: AGPL-3.0
pragma solidity 0.8.24;

import {Types} from "./Types.sol";
import {LevelMath} from "./LevelMath.sol";
import {Constants} from "./Constants.sol";
import {Errors} from "./Errors.sol";
import {MathLib} from "../libraries/MathLib.sol";

/// @title CurveMath — математика bonding curve
/// @notice internal pure, инлайнится в вызывающие контракты.
library CurveMath {
    /// @notice Цена по кривой в точке S (18-dec USDC per XRT, 18-dec XRT).
    function P(uint256 S, Types.Level[] memory levels) internal pure returns (uint256) {
        uint256 n = levels.length;
        if (n == 0) revert Errors.InvalidLevel();
        uint256 i = _getLevelIndex(S, levels);
        return LevelMath.P_i(S, levels[i]);
    }

    /// @notice Интеграл P от 0 до S. R(S) — минимально необходимый резерв.
    /// @dev S > S_end_last → OutOfBounds. S == 0 → 0.
    function R(uint256 S, Types.Level[] memory levels) internal pure returns (uint256) {
        uint256 n = levels.length;
        if (n == 0) revert Errors.InvalidLevel();
        if (S == 0) return 0;
        if (S > levels[n - 1].S_end) revert Errors.OutOfBounds();

        uint256 acc = 0;
        for (uint256 i = 0; i < n; i++) {
            uint256 sStart = levels[i].S_start;
            uint256 sEnd = levels[i].S_end;
            if (S <= sStart) break;
            if (S >= sEnd) {
                acc += LevelMath.R_i(sEnd, levels[i]);
            } else {
                acc += LevelMath.R_i(S, levels[i]);
                break;
            }
        }
        return acc;
    }

    /// @notice Решение R(S + ΔS) − R(S) = X относительно ΔS.
    /// @dev Округление вниз (ΔS таков, что R(S+ΔS)−R(S) ≤ X). Если X превышает
    ///      весь оставшийся supply — возвращает ΔS до S_end_last.
    function deltaSForBuy(uint256 S, uint256 X, Types.Level[] memory levels) internal pure returns (uint256) {
        if (X == 0) return 0;
        uint256 n = levels.length;
        if (n == 0) revert Errors.InvalidLevel();

        uint256 currentS = S;
        uint256 remainingX = X;
        uint256 startLevel = _getLevelIndex(S, levels);

        for (uint256 i = startLevel; i < n; i++) {
            uint256 sEnd = levels[i].S_end;
            if (currentS >= sEnd) continue;

            uint256 capX = LevelMath.R_i(sEnd, levels[i]) - LevelMath.R_i(currentS, levels[i]);
            if (remainingX < capX) {
                uint256 d = _solveOnLevel(currentS, remainingX, levels[i]);
                return (currentS - S) + d;
            }
            remainingX -= capX;
            currentS = sEnd;
        }
        // Если X не помещается в оставшийся supply — revert, иначе пользователь
        // платит за токены, которые не получает.
        if (remainingX > 0) revert Errors.OutOfBounds();
        return currentS - S;
    }

    /// @notice R(S) − R(S − ΔS).
    function amountForRedeem(uint256 S, uint256 deltaS, Types.Level[] memory levels) internal pure returns (uint256) {
        if (deltaS == 0) return 0;
        if (deltaS > S) revert Errors.InvalidAmount();
        return R(S, levels) - R(S - deltaS, levels);
    }

    /// @notice Индекс уровня для S. S < S_end_i → i. Иначе последний.
    function getLevel(uint256 S, Types.Level[] memory levels) internal pure returns (uint8) {
        return uint8(_getLevelIndex(S, levels));
    }

    // ------------------------------------------------------------------ internal

    function _getLevelIndex(uint256 S, Types.Level[] memory levels) private pure returns (uint256) {
        uint256 n = levels.length;
        if (n == 0) revert Errors.InvalidLevel();
        for (uint256 i = 0; i < n; i++) {
            if (S < levels[i].S_end) return i;
        }
        return n - 1;
    }

    /// @dev Бинарный поиск ΔS на одном уровне с верхней оценкой upper = X·1e18/P(S).
    function _solveOnLevel(uint256 currentS, uint256 X, Types.Level memory level) private pure returns (uint256) {
        uint256 maxD = level.S_end - currentS;
        uint256 pS = LevelMath.P_i(currentS, level);
        if (pS == 0) revert Errors.MathOverflow();

        uint256 upper = MathLib.mulDiv(X, Constants.PRECISION, pS);
        if (upper > maxD) upper = maxD;
        if (upper == 0) return 0;

        uint256 rStart = LevelMath.R_i(currentS, level);
        if (LevelMath.R_i(currentS + upper, level) - rStart <= X) {
            return upper;
        }

        uint256 lo = 0;
        uint256 hi = upper - 1;
        while (lo < hi) {
            uint256 mid = (lo + hi + 1) / 2;
            if (LevelMath.R_i(currentS + mid, level) - rStart <= X) {
                lo = mid;
            } else {
                hi = mid - 1;
            }
        }
        return lo;
    }
}
