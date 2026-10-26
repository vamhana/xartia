// SPDX-License-Identifier: AGPL-3.0
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
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
import {ICircuitBreaker} from "../safety/ICircuitBreaker.sol";
import {PrecisionLib} from "../libraries/PrecisionLib.sol";
import {Events} from "../events/Events.sol";
import {ICurveController} from "./ICurveController.sol";
import {IPoolController} from "./IPoolController.sol";

/// @title PoolController — внутренний пул XRT/USDC
/// @notice buyFromPool — каскад: сначала из пула, остаток через buyFromCurveFor.
///         sellToPool — продажа в пул с обновлением poolPrice по коридору.
///         Все внутренние вычисления — 18 decimals; наружу уходит 6-dec.
/// @dev Инвариант balanceOf(PoolController) == 0 между транзакциями (sweep-dust шаг 14b).
///      sellTeamFee читается из CurveController — single source of truth.
contract PoolController is IPoolController, AccessControl, ReentrancyGuard, Pausable, Events {
    using SafeERC20 for IERC20;

    // ------------------------------------------------------------------ immutables

    address public immutable curveController;
    address public immutable reserveManager;
    address public immutable circuitBreaker;
    address public immutable poolState;
    address public immutable token;
    address public immutable levels;
    address public immutable usdc;
    address public immutable override treasury;

    // ------------------------------------------------------------------ storage

    uint256 public override maxSellPctPerDay;
    mapping(address => uint256) public dailySold;
    mapping(address => uint256) public lastResetDay;

    uint256 private constant MAX_MAX_SELL_PCT = 500;

    constructor(
        address curveController_,
        address reserveManager_,
        address circuitBreaker_,
        address poolState_,
        address token_,
        address levels_,
        address usdc_,
        address treasury_
    ) {
        if (treasury_ == address(0)) revert Errors.InvalidAddress();
        curveController = curveController_;
        reserveManager = reserveManager_;
        circuitBreaker = circuitBreaker_;
        poolState = poolState_;
        token = token_;
        levels = levels_;
        usdc = usdc_;
        treasury = treasury_;
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    // ------------------------------------------------------------------ admin

    function setMaxSellPctPerDay(uint256 newPct) external override onlyRole(Roles.GOVERNANCE_ROLE) {
        if (newPct > MAX_MAX_SELL_PCT) revert Errors.OutOfBounds();
        uint256 old = maxSellPctPerDay;
        maxSellPctPerDay = newPct;
        emit MaxSellPctPerDayUpdated(old, newPct);
    }

    function pause() external override onlyRole(Roles.PAUSER_ROLE) {
        _pause();
    }

    function unpause() external override onlyRole(Roles.GOVERNANCE_ROLE) {
        _unpause();
    }

    // ------------------------------------------------------------------ views

    function pool() external view returns (uint256) {
        return IPoolState(poolState).pool();
    }

    function poolPrice() external view override returns (uint256) {
        return IPoolState(poolState).poolPrice();
    }

    function effectiveMinimalX6() external view override returns (uint256) {
        return ICurveController(curveController).effectiveMinimalX6();
    }

    // ------------------------------------------------------------------ trade

    function buyFromPool(uint256 X_6, uint256 minTokensOut, uint256 deadline)
        external
        override
        nonReentrant
        whenNotPaused
        returns (uint256 userTokens)
    {
        if (deadline != 0 && block.timestamp > deadline) revert Errors.DeadlineExpired();
        if (IPoolState(poolState).poolPrice() == 0) revert Errors.NotInitialized();

        uint256 X_18 = PrecisionLib.fromUSDC(X_6);
        if (X_6 < ICurveController(curveController).effectiveMinimalX6()) {
            revert Errors.MinimalPurchaseNotMet();
        }

        uint256 fee_18 = (X_18 * ICurveController(curveController).buyFee()) / Constants.BASIS_POINTS;
        uint256 X_net_18 = X_18 - fee_18;

        uint256 tokensNeeded = (X_net_18 * Constants.PRECISION) / IPoolState(poolState).poolPrice();
        uint256 tokens_from_pool = _min(IPoolState(poolState).pool(), tokensNeeded);
        uint256 X_pool_used_18 = (tokens_from_pool * IPoolState(poolState).poolPrice()) / Constants.PRECISION;
        uint256 X_remaining_18 = X_net_18 - X_pool_used_18;

        IERC20(usdc).safeTransferFrom(msg.sender, address(this), X_6);
        IERC20(usdc).safeTransfer(reserveManager, PrecisionLib.toUSDC(fee_18));

        uint256 tokens_from_curve = 0;

        if (tokens_from_pool > 0) {
            IPoolState(poolState).setPool(IPoolState(poolState).pool() - tokens_from_pool);

            if (X_remaining_18 == 0) {
                uint8 levelCur = ILevels(levels).getLevel(IReserveManager(reserveManager).S_curve());
                if (
                    IXartIAToken(token).balanceOf(msg.sender) + tokens_from_pool
                        > ILevels(levels).getMaxBalance(levelCur)
                ) revert Errors.MaxBalanceExceeded();
            }

            IERC20(usdc).safeTransfer(reserveManager, PrecisionLib.toUSDC(X_pool_used_18));
            IERC20(token).safeTransfer(msg.sender, tokens_from_pool);
        }

        if (PrecisionLib.toUSDC(X_remaining_18) > 0) {
            uint256 X_remaining_6 = PrecisionLib.toUSDC(X_remaining_18);
            IERC20(usdc).forceApprove(curveController, X_remaining_6);

            uint256 minOut_curve = minTokensOut > tokens_from_pool ? minTokensOut - tokens_from_pool : 0;
            tokens_from_curve =
                ICurveController(curveController).buyFromCurveFor(msg.sender, X_remaining_18, minOut_curve, deadline);

            IERC20(usdc).forceApprove(curveController, 0);
        }

        ICurveController(curveController).setLastBuyTime(msg.sender, block.timestamp);

        uint256 leftover_6 = IERC20(usdc).balanceOf(address(this));
        if (leftover_6 > 0) {
            IERC20(usdc).safeTransfer(reserveManager, leftover_6);
        }

        userTokens = tokens_from_pool + tokens_from_curve;
        emit BuyFromPool(
            msg.sender,
            X_18,
            tokens_from_pool,
            tokens_from_curve,
            fee_18,
            IPoolState(poolState).pool(),
            IPoolState(poolState).poolPrice(),
            IReserveManager(reserveManager).S_curve(),
            IReserveManager(reserveManager).reserve()
        );
    }

    function sellToPool(uint256 deltaP, uint256 minUsdcOut_6, uint256 deadline)
        external
        override
        nonReentrant
        whenNotPaused
        returns (uint256 userAmount)
    {
        if (deltaP == 0) revert Errors.InvalidAmount();
        if (deadline != 0 && block.timestamp > deadline) revert Errors.DeadlineExpired();
        if (IPoolState(poolState).poolPrice() == 0) revert Errors.NotInitialized();
        if (ICircuitBreaker(circuitBreaker).active()) revert Errors.CircuitBreakerActive();

        IERC20(token).safeTransferFrom(msg.sender, address(this), deltaP);

        uint256 day = block.timestamp / 1 days;
        if (lastResetDay[msg.sender] != day) {
            dailySold[msg.sender] = 0;
            lastResetDay[msg.sender] = day;
        }

        uint256 sCurve = IReserveManager(reserveManager).S_curve();
        if (dailySold[msg.sender] + deltaP > (maxSellPctPerDay * sCurve) / Constants.BASIS_POINTS) {
            revert Errors.MaxSellPerDayExceeded();
        }

        uint256 amount_gross_18 = (deltaP * IPoolState(poolState).poolPrice()) / Constants.PRECISION;
        uint256 fee_18 = (amount_gross_18 * ICurveController(curveController).redeemFee()) / Constants.BASIS_POINTS;
        uint256 sell_team_fee_18 =
            (amount_gross_18 * ICurveController(curveController).sellTeamFee()) / Constants.BASIS_POINTS;
        uint256 amount_user_18 = amount_gross_18 - fee_18 - sell_team_fee_18;

        if (amount_user_18 + sell_team_fee_18 > IReserveManager(reserveManager).freeReserve()) {
            revert Errors.InsufficientFreeReserve();
        }
        if (minUsdcOut_6 != 0 && PrecisionLib.toUSDC(amount_user_18) < minUsdcOut_6) {
            revert Errors.SlippageExceeded();
        }

        bool wasActive = ICircuitBreaker(circuitBreaker).active();
        dailySold[msg.sender] += deltaP;

        IReserveManager(reserveManager).pay(msg.sender, amount_user_18);
        if (sell_team_fee_18 > 0) {
            IReserveManager(reserveManager).pay(treasury, sell_team_fee_18);
        }

        IPoolState(poolState).setPool(IPoolState(poolState).pool() + deltaP);

        Types.Level[] memory levelsArr = ILevels(levels).all();
        uint256 pS = CurveMath.P(sCurve, levelsArr);
        uint256 q_bp = _min((deltaP * Constants.BASIS_POINTS) / (sCurve > 0 ? sCurve : 1), Constants.MAX_SOLD_PCT);
        uint256 mult_bp = Constants.BASIS_POINTS + (Constants.K * q_bp) / Constants.BASIS_POINTS;
        uint256 newPrice = (IPoolState(poolState).poolPrice() * mult_bp) / Constants.BASIS_POINTS;
        uint256 ceiling = (pS * (Constants.BASIS_POINTS + Constants.MAX_GAP)) / Constants.BASIS_POINTS;
        if (newPrice > ceiling) newPrice = ceiling;
        IPoolState(poolState).setPoolPrice(newPrice);

        userAmount = amount_user_18;
        emit SellToPool(
            msg.sender,
            deltaP,
            amount_user_18,
            fee_18,
            sell_team_fee_18,
            IPoolState(poolState).pool(),
            newPrice,
            IReserveManager(reserveManager).reserve()
        );

        if (!wasActive && ICircuitBreaker(circuitBreaker).active()) {
            emit CircuitBreakerTriggered(
                IReserveManager(reserveManager).freeReserve(), IReserveManager(reserveManager).reserve()
            );
        }
    }

    // ------------------------------------------------------------------ internal

    function _min(uint256 a, uint256 b) private pure returns (uint256) {
        return a < b ? a : b;
    }
}
