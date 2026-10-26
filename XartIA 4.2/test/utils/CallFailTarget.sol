// SPDX-License-Identifier: AGPL-3.0
pragma solidity 0.8.24;

/// @title CallFailTarget — target, чей setter всегда revert'ит
/// @notice Используется в test_execute_revert_call_failed (Timelock): low-level call
///         возвращает success = false, Timelock ревертит CallFailed.
contract CallFailTarget {
    function failSetter(uint256) external pure {
        revert("always fail");
    }
}
