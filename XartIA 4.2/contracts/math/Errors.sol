// SPDX-License-Identifier: AGPL-3.0
pragma solidity 0.8.24;

/// @title Errors — только используемые кастомные ошибки
library Errors {
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
