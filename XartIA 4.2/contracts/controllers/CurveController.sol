// SPDX-License-Identifier: AGPL-3.0
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

import {Roles} from "../core/Roles.sol";
import {Constants} from "../math/Constants.sol";
import {Errors} from "../math/Errors.sol";
import {Types} from "../math/Types.sol";
import {CurveMath} from "../math/CurveMath.sol";
import {ILevels} from "../math/ILevels.sol";
import {IPoolState} from "../math/IPoolState.sol";
import {IXartIAToken} from "../token/IXartIAToken.sol";
import {IReserveManager} from "../reserve/IReserveManager.sol";
import {IVesting} from "../vesting/IVesting.sol";
import {ICircuitBreaker} from "../safety/ICircuitBreaker.sol";
import {PrecisionLib} from "../libraries/PrecisionLib.sol";
import {Events} from "../events/Events.sol";
import {ICurveController} from "./ICurveController.sol";

/// @title CurveController — покупка/продажа через bonding curve
/// @notice Единая семантика minOut для buy/redeem. Сеттеры — onlyRole(GOVERNANCE_ROLE).
///         pause — PAUSER_ROLE, unpause — GOVERNANCE_ROLE.
/// @dev buyFromCurveFor — pull-модель: защищён immutable poolController, тянет USDC
///      через safeTransferFrom(msg.sender, reserveManager, X_6). X_18 нормализуется.
///      MAX_CURVE_FOR_PCT применяется только при S_curve() > 0 (genesis-исключение).
contract CurveController is ICurveController, AccessControl, Ownable, ReentrancyGuard, Pausable, Events {
    using SafeERC20 for IERC20;

    // ------------------------------------------------------------------ immutables

    address public immutable reserveManager;
    address public immutable vesting;
    address public immutable circuitBreaker;
    address public immutable poolState;
    address public immutable token;
    address public immutable levels;
    address public immutable usdc;
    address public immutable override treasury;

    // ------------------------------------------------------------------ storage

    address public override poolController;

    uint256 public override buyFee;
    uint256 public override redeemFee;
    uint256 public earlySellFee;
    uint256 public earlySellPeriod;
    uint256 public override maxPurchasePct;
    uint256 public override minimalPurchase;
    uint256 public override sellTeamFee;

    mapping(address => uint256) public lastBuyTime;

    uint256 private constant MAX_BUY_FEE_BP = 200;
    uint256 private constant MAX_REDEEM_FEE_BP = 200;
    uint256 private constant MAX_EARLY_SELL_FEE_BP = 500;
    uint256 private constant MAX_EARLY_SELL_PERIOD = 7_776_000;
    uint256 private constant MAX_MAX_PURCHASE_PCT = 1000;
    uint256 private constant MIN_MINIMAL_PURCHASE = 1e6;
    uint256 private constant MAX_MINIMAL_PURCHASE = 1e12;
    uint256 private constant MAX_SELL_TEAM_FEE_BP = 50;

    constructor(
        address reserveManager_,
        address vesting_,
        address circuitBreaker_,
        address poolState_,
        address token_,
        address levels_,
        address usdc_,
        address treasury_
    ) Ownable(msg.sender) {
        if (treasury_ == address(0)) revert Errors.InvalidAddress();
        reserveManager = reserveManager_;
        vesting = vesting_;
        circuitBreaker = circuitBreaker_;
        poolState = poolState_;
        token = token_;
        levels = levels_;
        usdc = usdc_;
        treasury = treasury_;
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    // ------------------------------------------------------------------ admin

    function setPoolController(address poolController_) external override onlyOwner {
        if (poolController_ == address(0)) revert Errors.InvalidAddress();
        if (poolController != address(0)) revert Errors.AlreadyInitialized();
        poolController = poolController_;
    }

    function setSellTeamFee(uint256 newFee) external override onlyRole(Roles.GOVERNANCE_ROLE) {
        if (newFee > MAX_SELL_TEAM_FEE_BP) revert Errors.OutOfBounds();
        uint256 old = sellTeamFee;
        sellTeamFee = newFee;
        emit SellTeamFeeUpdated(old, newFee);
    }

    function setBuyFee(uint256 newFee) external onlyRole(Roles.GOVERNANCE_ROLE) {
        if (newFee > MAX_BUY_FEE_BP) revert Errors.OutOfBounds();
        uint256 old = buyFee;
        buyFee = newFee;
        emit BuyFeeUpdated(old, newFee);
    }

    function setRedeemFee(uint256 newFee) external onlyRole(Roles.GOVERNANCE_ROLE) {
        if (newFee > MAX_REDEEM_FEE_BP) revert Errors.OutOfBounds();
        uint256 old = redeemFee;
        redeemFee = newFee;
        emit RedeemFeeUpdated(old, newFee);
    }

    function setEarlySellFee(uint256 newFee) external onlyRole(Roles.GOVERNANCE_ROLE) {
        if (newFee > MAX_EARLY_SELL_FEE_BP) revert Errors.OutOfBounds();
        uint256 old = earlySellFee;
        earlySellFee = newFee;
        emit EarlySellFeeUpdated(old, newFee);
    }

    function setEarlySellPeriod(uint256 newPeriod) external onlyRole(Roles.GOVERNANCE_ROLE) {
        if (newPeriod > MAX_EARLY_SELL_PERIOD) revert Errors.OutOfBounds();
        uint256 old = earlySellPeriod;
        earlySellPeriod = newPeriod;
        emit EarlySellPeriodUpdated(old, newPeriod);
    }

    function setMaxPurchasePct(uint256 newPct) external onlyRole(Roles.GOVERNANCE_ROLE) {
        if (newPct > MAX_MAX_PURCHASE_PCT) revert Errors.OutOfBounds();
        uint256 old = maxPurchasePct;
        maxPurchasePct = newPct;
        emit MaxPurchasePctUpdated(old, newPct);
    }

    function setMinimalPurchase(uint256 newMin) external onlyRole(Roles.GOVERNANCE_ROLE) {
        if (newMin < MIN_MINIMAL_PURCHASE || newMin > MAX_MINIMAL_PURCHASE) {
            revert Errors.OutOfBounds();
        }
        uint256 old = minimalPurchase;
        minimalPurchase = newMin;
        emit MinimalPurchaseUpdated(old, newMin);
    }

    function pause() external onlyRole(Roles.PAUSER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(Roles.PAUSER_ROLE) {
        _unpause();
    }

    /// @notice Вызывается PoolController'ом при каскаде (buyFromPool → buyFromCurveFor).
    function setLastBuyTime(address user, uint256 timestamp) external override {
        if (msg.sender != poolController) revert Errors.Unauthorized();
        lastBuyTime[user] = timestamp;
    }

    // ------------------------------------------------------------------ views

    function effectiveMinimalX6() public view override returns (uint256) {
        uint256 bp = Constants.BASIS_POINTS;
        uint256 denom = bp - buyFee;
        return (minimalPurchase * bp + denom - 1) / denom;
    }

    function S_curve() external view override returns (uint256) {
        return IReserveManager(reserveManager).S_curve();
    }

    function reserve() external view override returns (uint256) {
        return IReserveManager(reserveManager).reserve();
    }

    // ------------------------------------------------------------------ trade

    function buyFromCurve(uint256 X_6, uint256 minTokensOut, uint256 deadline)
        external
        override
        nonReentrant
        whenNotPaused
        returns (uint256 userTokens)
    {
        if (IPoolState(poolState).poolPrice() == 0) revert Errors.NotInitialized();
        if (deadline != 0 && block.timestamp > deadline) revert Errors.DeadlineExpired();

        uint256 X_18 = PrecisionLib.fromUSDC(X_6);
        if (X_6 < effectiveMinimalX6()) revert Errors.MinimalPurchaseNotMet();

        uint256 fee_18 = (X_18 * buyFee) / Constants.BASIS_POINTS;
        uint256 X_net_18 = X_18 - fee_18;

        Types.Level[] memory levelsArr = ILevels(levels).all();
        uint256 sBefore = IReserveManager(reserveManager).S_curve();
        uint256 deltaS = CurveMath.deltaSForBuy(sBefore, X_net_18, levelsArr);
        if (minTokensOut != 0 && deltaS < minTokensOut) revert Errors.SlippageExceeded();
        if (sBefore > 0 && deltaS > (maxPurchasePct * sBefore) / Constants.BASIS_POINTS) {
            revert Errors.MaxPurchaseExceeded();
        }

        uint256 teamTokens = (deltaS * Constants.TEAM_PERCENT) / Constants.BASIS_POINTS;
        uint256 newS = sBefore + deltaS;
        uint8 levelOld = ILevels(levels).getLevel(sBefore);
        uint8 levelNew = ILevels(levels).getLevel(newS);
        if (IXartIAToken(token).balanceOf(msg.sender) + deltaS - teamTokens > ILevels(levels).getMaxBalance(levelNew)) {
            revert Errors.MaxBalanceExceeded();
        }

        IERC20(usdc).safeTransferFrom(msg.sender, reserveManager, X_6);

        bool wasActive = ICircuitBreaker(circuitBreaker).active();
        IXartIAToken(token).mint(msg.sender, deltaS - teamTokens);
        IXartIAToken(token).mint(vesting, teamTokens);
        IVesting(vesting).addTokens(teamTokens);
        lastBuyTime[msg.sender] = block.timestamp;
        IReserveManager(reserveManager).updateScurve(newS);
        _enforcePoolPriceFloor(newS, levelsArr);

        userTokens = deltaS - teamTokens;
        emit TeamFee(vesting, teamTokens);
        emit Buy(
            msg.sender, X_18, userTokens, fee_18, teamTokens, newS, IReserveManager(reserveManager).reserve(), levelNew
        );
        if (levelNew != levelOld) emit LevelChanged(levelOld, levelNew);
        _maybeEmitCircuitBreaker(wasActive);
    }

    function redeemFromCurve(uint256 deltaS, uint256 minUsdcOut_6, uint256 deadline)
        external
        override
        nonReentrant
        whenNotPaused
        returns (uint256 userAmount)
    {
        if (deltaS == 0) revert Errors.InvalidAmount();
        if (IPoolState(poolState).poolPrice() == 0) revert Errors.NotInitialized();
        if (deadline != 0 && block.timestamp > deadline) revert Errors.DeadlineExpired();

        IXartIAToken(token).burnFrom(msg.sender, deltaS);

        Types.Level[] memory levelsArr = ILevels(levels).all();
        uint256 sBefore = IReserveManager(reserveManager).S_curve();
        uint256 amount_18 = CurveMath.amountForRedeem(sBefore, deltaS, levelsArr);

        uint256 fee_18 = (amount_18 * redeemFee) / Constants.BASIS_POINTS;
        uint256 early_fee_18 = 0;
        if (block.timestamp < lastBuyTime[msg.sender] + earlySellPeriod) {
            early_fee_18 = (amount_18 * earlySellFee) / Constants.BASIS_POINTS;
        }
        uint256 sell_team_fee_18 = (amount_18 * sellTeamFee) / Constants.BASIS_POINTS;

        uint256 user_amount_18 = amount_18 - fee_18 - early_fee_18 - sell_team_fee_18;
        if (minUsdcOut_6 != 0 && PrecisionLib.toUSDC(user_amount_18) < minUsdcOut_6) {
            revert Errors.SlippageExceeded();
        }

        bool wasActive = ICircuitBreaker(circuitBreaker).active();
        uint256 newS = sBefore - deltaS;
        uint8 levelOld = ILevels(levels).getLevel(sBefore);
        uint8 levelNew = ILevels(levels).getLevel(newS);

        IReserveManager(reserveManager).pay(msg.sender, user_amount_18);
        if (sell_team_fee_18 > 0) {
            IReserveManager(reserveManager).pay(treasury, sell_team_fee_18);
        }
        IReserveManager(reserveManager).updateScurve(newS);

        _clampPoolPriceToCorridor(newS, levelsArr);

        userAmount = user_amount_18;
        emit Redeem(
            msg.sender,
            deltaS,
            user_amount_18,
            fee_18,
            early_fee_18,
            sell_team_fee_18,
            newS,
            IReserveManager(reserveManager).reserve(),
            levelNew
        );
        if (levelNew != levelOld) emit LevelChanged(levelOld, levelNew);
        _maybeEmitCircuitBreaker(wasActive);
    }

    /// @notice Pull-модель. Вызывается только poolController.
    function buyFromCurveFor(address buyer, uint256 X_18, uint256 minTokensOut, uint256 deadline)
        external
        override
        nonReentrant
        whenNotPaused
        returns (uint256 userTokens)
    {
        if (msg.sender != poolController) revert Errors.Unauthorized();
        if (IPoolState(poolState).poolPrice() == 0) revert Errors.NotInitialized();
        if (deadline != 0 && block.timestamp > deadline) revert Errors.DeadlineExpired();
        if (X_18 == 0) revert Errors.InvalidAmount();

        X_18 = PrecisionLib.toWei(PrecisionLib.toUSDC(X_18));

        uint256 sBefore = IReserveManager(reserveManager).S_curve();
        if (sBefore > 0) {
            if (
                X_18
                    > IReserveManager(reserveManager).freeReserve() * Constants.MAX_CURVE_FOR_PCT
                        / Constants.BASIS_POINTS
            ) revert Errors.MaxCurveForExceeded();
        }

        Types.Level[] memory levelsArr = ILevels(levels).all();
        uint256 deltaS = CurveMath.deltaSForBuy(sBefore, X_18, levelsArr);
        if (minTokensOut != 0 && deltaS < minTokensOut) revert Errors.SlippageExceeded();
        if (sBefore > 0 && deltaS > (maxPurchasePct * sBefore) / Constants.BASIS_POINTS) {
            revert Errors.MaxPurchaseExceeded();
        }

        uint256 teamTokens = (deltaS * Constants.TEAM_PERCENT) / Constants.BASIS_POINTS;
        uint256 newS = sBefore + deltaS;
        uint8 levelOld = ILevels(levels).getLevel(sBefore);
        uint8 levelNew = ILevels(levels).getLevel(newS);
        if (IXartIAToken(token).balanceOf(buyer) + deltaS - teamTokens > ILevels(levels).getMaxBalance(levelNew)) {
            revert Errors.MaxBalanceExceeded();
        }

        IERC20(usdc).safeTransferFrom(msg.sender, reserveManager, PrecisionLib.toUSDC(X_18));

        bool wasActive = ICircuitBreaker(circuitBreaker).active();
        IXartIAToken(token).mint(buyer, deltaS - teamTokens);
        IXartIAToken(token).mint(vesting, teamTokens);
        IVesting(vesting).addTokens(teamTokens);
        lastBuyTime[buyer] = block.timestamp;
        IReserveManager(reserveManager).updateScurve(newS);
        _enforcePoolPriceFloor(newS, levelsArr);

        userTokens = deltaS - teamTokens;
        emit TeamFee(vesting, teamTokens);
        emit Buy(buyer, X_18, userTokens, 0, teamTokens, newS, IReserveManager(reserveManager).reserve(), levelNew);
        if (levelNew != levelOld) emit LevelChanged(levelOld, levelNew);
        _maybeEmitCircuitBreaker(wasActive);
    }

    // ------------------------------------------------------------------ internal

    function _enforcePoolPriceFloor(uint256 newS, Types.Level[] memory levelsArr) internal {
        uint256 pNewS = CurveMath.P(newS, levelsArr);
        uint256 floor = (pNewS * Constants.BASIS_POINTS) / (Constants.BASIS_POINTS + Constants.MAX_GAP);
        uint256 cur = IPoolState(poolState).poolPrice();
        if (cur < floor) IPoolState(poolState).setPoolPrice(floor);
    }

    function _clampPoolPriceToCorridor(uint256 newS, Types.Level[] memory levelsArr) internal {
        uint256 pNewS = CurveMath.P(newS, levelsArr);
        uint256 ceiling = (pNewS * (Constants.BASIS_POINTS + Constants.MAX_GAP)) / Constants.BASIS_POINTS;
        uint256 floor = (pNewS * Constants.BASIS_POINTS) / (Constants.BASIS_POINTS + Constants.MAX_GAP);
        uint256 cur = IPoolState(poolState).poolPrice();
        if (cur > ceiling) {
            IPoolState(poolState).setPoolPrice(ceiling);
        } else if (cur < floor) {
            IPoolState(poolState).setPoolPrice(floor);
        }
    }

    function _maybeEmitCircuitBreaker(bool wasActive) internal {
        if (!wasActive && ICircuitBreaker(circuitBreaker).active()) {
            emit CircuitBreakerTriggered(
                IReserveManager(reserveManager).freeReserve(), IReserveManager(reserveManager).reserve()
            );
        }
    }
}
