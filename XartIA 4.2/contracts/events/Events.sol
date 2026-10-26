// SPDX-License-Identifier: AGPL-3.0
pragma solidity 0.8.24;

/// @title Events — единый источник событий протокола
/// @notice Abstract contract. Контракты наследуют его и эмитят события по месту.
///         Paused/Unpaused — из OpenZeppelin Pausable, здесь не дублируются.
abstract contract Events {
    // --- trade ---
    event Buy(
        address indexed buyer,
        uint256 usdcIn,
        uint256 tokensOut,
        uint256 fee,
        uint256 teamTokens,
        uint256 newScurve,
        uint256 newReserve,
        uint256 newLevel
    );
    event BuyFromPool(
        address indexed buyer,
        uint256 usdcIn,
        uint256 tokensFromPool,
        uint256 tokensFromCurve,
        uint256 fee,
        uint256 newPool,
        uint256 newPoolPrice,
        uint256 newScurve,
        uint256 newReserve
    );
    event SellToPool(
        address indexed seller,
        uint256 tokensIn,
        uint256 usdcOut,
        uint256 fee,
        uint256 sellTeamFee,
        uint256 newPool,
        uint256 newPoolPrice,
        uint256 newReserve
    );
    event Redeem(
        address indexed seller,
        uint256 tokensIn,
        uint256 usdcOut,
        uint256 fee,
        uint256 earlyFee,
        uint256 sellTeamFee,
        uint256 newScurve,
        uint256 newReserve,
        uint256 newLevel
    );

    // --- pool / levels ---
    event PoolPriceInitialized(uint256 initialPrice);
    event PoolPriceUpdated(uint256 oldPrice, uint256 newPrice);
    event LevelChanged(uint256 oldLevel, uint256 newLevel);

    // --- protocol revenue ---
    event TeamFee(address indexed vesting, uint256 amount);

    // --- safety ---
    event CircuitBreakerTriggered(uint256 freeReserve, uint256 reserve);
    event ThresholdUpdated(uint256 oldThreshold, uint256 newThreshold);

    // --- params ---
    event BuyFeeUpdated(uint256 oldFee, uint256 newFee);
    event RedeemFeeUpdated(uint256 oldFee, uint256 newFee);
    event EarlySellFeeUpdated(uint256 oldFee, uint256 newFee);
    event EarlySellPeriodUpdated(uint256 oldPeriod, uint256 newPeriod);
    event MaxPurchasePctUpdated(uint256 oldPct, uint256 newPct);
    event MinimalPurchaseUpdated(uint256 oldMin, uint256 newMin);
    event MaxSellPctPerDayUpdated(uint256 oldPct, uint256 newPct);
    event SellTeamFeeUpdated(uint256 oldFee, uint256 newFee);

    // --- governance / timelock ---
    event Queued(bytes32 indexed param, uint256 value, uint256 executeAfter);
    event Executed(bytes32 indexed param, uint256 value);
    event Cancelled(bytes32 indexed param);

    // --- lifecycle ---
    event Deploy(
        address indexed factory,
        address token,
        address curveController,
        address poolController,
        address safe,
        address treasury,
        address curveMathWrapper
    );
    event Initialize(address indexed factory, uint256 levelCount);
    event Finalize(address indexed factory, address indexed safe);
}
