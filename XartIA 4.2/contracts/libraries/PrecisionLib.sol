// SPDX-License-Identifier: AGPL-3.0
pragma solidity 0.8.24;

/// @title PrecisionLib — конвертация 18↔6 decimals (XartIA ↔ USDC)
/// @notice toUSDC == fromWei; fromUSDC == toWei. Разные имена — для читаемости в контексте.
library PrecisionLib {
    uint256 private constant SCALE = 1e12;

    function toUSDC(uint256 amount18) internal pure returns (uint256) {
        return amount18 / SCALE;
    }

    function fromUSDC(uint256 amount6) internal pure returns (uint256) {
        return amount6 * SCALE;
    }

    function toWei(uint256 amount6) internal pure returns (uint256) {
        return amount6 * SCALE;
    }

    function fromWei(uint256 amount18) internal pure returns (uint256) {
        return amount18 / SCALE;
    }
}
