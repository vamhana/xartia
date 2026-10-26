// SPDX-License-Identifier: AGPL-3.0
pragma solidity 0.8.24;

import {CurveMath} from "../../contracts/math/CurveMath.sol";
import {Types} from "../../contracts/math/Types.sol";

/// @title ErrorsWrapper — external-обёртки над internal-функциями математики
/// @notice Используется ТОЛЬКО для тестирования MathOverflow. CallFailed тестируется
///         через Timelock + CallFailTarget, не здесь.
contract ErrorsWrapper {
    function call_P(uint256 S, Types.Level[] memory levels) external pure returns (uint256) {
        return CurveMath.P(S, levels);
    }

    function call_R(uint256 S, Types.Level[] memory levels) external pure returns (uint256) {
        return CurveMath.R(S, levels);
    }

    function call_deltaSForBuy(uint256 S, uint256 X, Types.Level[] memory levels) external pure returns (uint256) {
        return CurveMath.deltaSForBuy(S, X, levels);
    }
}
