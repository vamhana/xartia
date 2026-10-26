// SPDX-License-Identifier: AGPL-3.0
pragma solidity 0.8.24;

/// @title IErrors — схема кастомных ошибок для frontend
/// @notice Синхронизирован с C.2.01.04 Errors. Используется для декодирования revert-данных.
interface IErrors {
    error InvalidAmount();
    error InvalidLevel();
    error InvalidAddress();
    error InvalidParam();
    error OutOfBounds();
    error ReserveInvariantViolation();
    error InsufficientFreeReserve();
    error InsufficientReserve();
    error InsufficientVestingBalance();
    error CircuitBreakerActive();
    error MathOverflow();
    error Unauthorized();
    error NotOwner();
    error SafeNotAdmin();
    error SafeNotPauser();
    error MaxBalanceExceeded();
    error MaxPurchaseExceeded();
    error MaxSellPerDayExceeded();
    error MinimalPurchaseNotMet();
    error DeadlineExpired();
    error SlippageExceeded();
    error AlreadyInitialized();
    error NotQueued();
    error AlreadyQueued();
    error CallFailed();
    error NotInitialized();
    error MaxCurveForExceeded();
}
