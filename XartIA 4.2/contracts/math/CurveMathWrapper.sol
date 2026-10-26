// SPDX-License-Identifier: AGPL-3.0
pragma solidity 0.8.24;

import {Types} from "./Types.sol";
import {CurveMath} from "./CurveMath.sol";

/// @title CurveMathWrapper — external обёртка над internal CurveMath
/// @notice Для кросс-проверки Python ↔ Solidity (S.1.01.03 verify_math.py).
contract CurveMathWrapper {
    function P(uint256 S, Types.Level[] memory levels) external pure returns (uint256) {
        return CurveMath.P(S, levels);
    }

    function R(uint256 S, Types.Level[] memory levels) external pure returns (uint256) {
        return CurveMath.R(S, levels);
    }

    function deltaSForBuy(uint256 S, uint256 X, Types.Level[] memory levels) external pure returns (uint256) {
        return CurveMath.deltaSForBuy(S, X, levels);
    }

    function amountForRedeem(uint256 S, uint256 deltaS, Types.Level[] memory levels) external pure returns (uint256) {
        return CurveMath.amountForRedeem(S, deltaS, levels);
    }

    function getLevel(uint256 S, Types.Level[] memory levels) external pure returns (uint8) {
        return CurveMath.getLevel(S, levels);
    }
}
