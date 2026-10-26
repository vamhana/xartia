// SPDX-License-Identifier: AGPL-3.0
pragma solidity 0.8.24;

/// @title Constants — глобальные константы и ids параметров для ParameterRegistry
library Constants {
    // --- precision ---
    uint256 internal constant PRECISION = 1e18;
    uint256 internal constant USDC_PRECISION = 1e6;
    uint256 internal constant BASIS_POINTS = 10_000;

    // --- curve ---
    uint8 internal constant MAX_LEVELS = 10;
    uint256 internal constant TEAM_PERCENT = 50; // 0.5% от ΔS → Vesting
    uint256 internal constant MAX_GAP = 1000; // ±10% коридор poolPrice
    uint256 internal constant MAX_SOLD_PCT = 100; // 1% — кэп q в sellToPool
    uint256 internal constant K = 15_000; // 1.5 — множитель q в sellToPool
    uint256 internal constant MAX_CURVE_FOR_PCT = 2000; // 20% freeReserve — лимит buyFromCurveFor

    // --- governance ---
    uint256 internal constant TIMELOCK_DELAY = 7 days;

    // --- parameter ids ---
    bytes32 internal constant PARAM_BUY_FEE = keccak256("PARAM_BUY_FEE");
    bytes32 internal constant PARAM_REDEEM_FEE = keccak256("PARAM_REDEEM_FEE");
    bytes32 internal constant PARAM_EARLY_SELL_FEE = keccak256("PARAM_EARLY_SELL_FEE");
    bytes32 internal constant PARAM_EARLY_SELL_PERIOD = keccak256("PARAM_EARLY_SELL_PERIOD");
    bytes32 internal constant PARAM_MAX_PURCHASE_PCT = keccak256("PARAM_MAX_PURCHASE_PCT");
    bytes32 internal constant PARAM_MINIMAL_PURCHASE = keccak256("PARAM_MINIMAL_PURCHASE");
    bytes32 internal constant PARAM_MAX_SELL_PCT_PER_DAY = keccak256("PARAM_MAX_SELL_PCT_PER_DAY");
    bytes32 internal constant PARAM_CIRCUIT_BREAKER_THRESHOLD = keccak256("PARAM_CIRCUIT_BREAKER_THRESHOLD");
    bytes32 internal constant PARAM_SELL_TEAM_FEE = keccak256("PARAM_SELL_TEAM_FEE");
}
