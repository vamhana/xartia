// SPDX-License-Identifier: AGPL-3.0
pragma solidity 0.8.24;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @title MathLib — математические утилиты
/// @notice mulDiv / mulDivUp — 512-битная арифметика (OZ); sqrt — Babylonian.
library MathLib {
    function mulDiv(uint256 a, uint256 b, uint256 c) internal pure returns (uint256) {
        return Math.mulDiv(a, b, c);
    }

    function mulDivUp(uint256 a, uint256 b, uint256 c) internal pure returns (uint256) {
        return Math.mulDiv(a, b, c, Math.Rounding.Ceil);
    }

    /// @dev Babylonian sqrt. Для x = 0 / 1 возвращает x.
    function sqrt(uint256 x) internal pure returns (uint256) {
        if (x == 0) return 0;
        uint256 z = (x + 1) / 2;
        uint256 y = x;
        while (z < y) {
            y = z;
            z = (x / z + z) / 2;
        }
        return y;
    }

    function min(uint256 a, uint256 b) internal pure returns (uint256) {
        return a < b ? a : b;
    }

    function max(uint256 a, uint256 b) internal pure returns (uint256) {
        return a > b ? a : b;
    }

    /// @dev Не защищён от type(int256).min. По спецификации не используется с этим значением.
    function abs(int256 x) internal pure returns (uint256) {
        unchecked {
            return x >= 0 ? uint256(x) : uint256(-x);
        }
    }
}
