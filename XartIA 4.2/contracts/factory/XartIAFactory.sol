// SPDX-License-Identifier: AGPL-3.0
pragma solidity 0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";

import {Roles} from "../core/Roles.sol";
import {Constants} from "../math/Constants.sol";
import {Errors} from "../math/Errors.sol";
import {Types} from "../math/Types.sol";
import {CurveMath} from "../math/CurveMath.sol";
import {ILevels} from "../math/ILevels.sol";
import {IPoolState} from "../math/IPoolState.sol";
import {IOwnable} from "../core/IOwnable.sol";
import {IParameterRegistry} from "../core/IParameterRegistry.sol";
import {ParameterRegistry} from "../core/ParameterRegistry.sol";
import {Levels} from "../math/Levels.sol";
import {PoolState} from "../math/PoolState.sol";
import {CurveMathWrapper} from "../math/CurveMathWrapper.sol";
import {XartIAToken} from "../token/XartIAToken.sol";
import {ReserveManager} from "../reserve/ReserveManager.sol";
import {IReserveManager} from "../reserve/IReserveManager.sol";
import {Vesting} from "../vesting/Vesting.sol";
import {CircuitBreaker} from "../safety/CircuitBreaker.sol";
import {Timelock} from "../governance/Timelock.sol";
import {Governance} from "../governance/Governance.sol";
import {CurveController} from "../controllers/CurveController.sol";
import {ICurveController} from "../controllers/ICurveController.sol";
import {PoolController} from "../controllers/PoolController.sol";
import {IPoolController} from "../controllers/IPoolController.sol";
import {ICircuitBreaker} from "../safety/ICircuitBreaker.sol";
import {Events} from "../events/Events.sol";
import {IXartIAFactory} from "./IXartIAFactory.sol";

/// @title XartIAFactory — деплой всей системы + bootstrap параметров + передача прав на safe
/// @notice deploy → initializeLevels → initializePoolPrice → registerParams → finalize.
///         После finalize у Factory нет ни одной роли; owner(safe) у Levels, ParameterRegistry,
///         PoolState, CurveController и самой Factory.
/// @dev Step-номера в комментариях соответствуют C.8.01.01.
contract XartIAFactory is IXartIAFactory, Ownable, Events {
    address public override token;
    address public override levels;
    address public override registry;
    address public override poolState;
    address public override reserveManager;
    address public override vesting;
    address public override circuitBreaker;
    address public override curveController;
    address public override poolController;
    address public override governance;
    address public override timelock;
    address public override curveMathWrapper;
    address public override treasury;

    constructor() Ownable(msg.sender) {}

    // ------------------------------------------------------------------ deploy

    function deploy(address safe, address treasury_, uint256 initialThreshold, address usdc)
        external
        override
        onlyOwner
        returns (address curveController_, address poolController_, address curveMathWrapper_)
    {
        // (0–0d) валидация аргументов
        if (safe == address(0)) revert Errors.InvalidAddress();
        if (safe == address(this)) revert Errors.InvalidAddress();
        if (safe.code.length == 0) revert Errors.InvalidAddress();
        if (usdc == address(0)) revert Errors.InvalidAddress();
        if (initialThreshold < 50 || initialThreshold > 2000) revert Errors.OutOfBounds();
        // (0e–0g) валидация treasury
        if (treasury_ == address(0)) revert Errors.InvalidAddress();
        if (treasury_ == address(this)) revert Errors.InvalidAddress();
        if (treasury_.code.length == 0) revert Errors.InvalidAddress();

        // (1–8) базовые контракты
        token = address(new XartIAToken());
        levels = address(new Levels());
        registry = address(new ParameterRegistry());
        poolState = address(new PoolState());
        reserveManager = address(new ReserveManager(usdc, levels));
        vesting = address(new Vesting(safe, token));
        circuitBreaker = address(new CircuitBreaker(initialThreshold, reserveManager));
        curveMathWrapper = address(new CurveMathWrapper());

        // (9–10) контроллеры
        curveController = address(
            new CurveController(reserveManager, vesting, circuitBreaker, poolState, token, levels, usdc, treasury_)
        );
        poolController = address(
            new PoolController(
                curveController, reserveManager, circuitBreaker, poolState, token, levels, usdc, treasury_
            )
        );
        // (10a) связка
        ICurveController(curveController).setPoolController(poolController);

        // (11–12) governance
        timelock = address(new Timelock());
        governance = address(new Governance(safe, timelock, registry));

        treasury = treasury_;

        // (13–22) роли: token / reserveManager / poolState
        IAccessControl(token).grantRole(Roles.MINTER_ROLE, curveController);
        IAccessControl(token).grantRole(Roles.BURNER_ROLE, curveController);
        // DEFAULT_ADMIN_ROLE НЕ выдаётся Safe: после finalize админа нет — роли неизменяемы.

        IAccessControl(reserveManager).grantRole(Roles.CONTROLLER_ROLE, curveController);
        IAccessControl(reserveManager).grantRole(Roles.CONTROLLER_ROLE, poolController);

        IAccessControl(poolState).grantRole(Roles.POOL_WRITER_ROLE, poolController);
        IAccessControl(poolState).grantRole(Roles.PRICE_WRITER_ROLE, curveController);
        IAccessControl(poolState).grantRole(Roles.PRICE_WRITER_ROLE, poolController);

        // (23b–27) CurveController роли
        IAccessControl(curveController).grantRole(Roles.GOVERNANCE_ROLE, timelock);
        IAccessControl(curveController).grantRole(Roles.GOVERNANCE_ROLE, address(this));
        IAccessControl(curveController).grantRole(Roles.PAUSER_ROLE, safe);

        // (28b–31) PoolController роли
        IAccessControl(poolController).grantRole(Roles.GOVERNANCE_ROLE, timelock);
        IAccessControl(poolController).grantRole(Roles.GOVERNANCE_ROLE, address(this));
        IAccessControl(poolController).grantRole(Roles.PAUSER_ROLE, safe);

        // (32–33) Vesting
        IAccessControl(vesting).grantRole(Roles.MINTER_ROLE, curveController);

        // (34b) CircuitBreaker
        IAccessControl(circuitBreaker).grantRole(Roles.GOVERNANCE_ROLE, timelock);

        // (37–38) Timelock
        IAccessControl(timelock).grantRole(Roles.GOVERNANCE_ROLE, governance);

        // (39) Governance

        // (40–46) начальные параметры
        ICurveController(curveController).setBuyFee(50);
        ICurveController(curveController).setRedeemFee(50);
        ICurveController(curveController).setEarlySellFee(0);
        ICurveController(curveController).setEarlySellPeriod(0);
        ICurveController(curveController).setMaxPurchasePct(1000);
        ICurveController(curveController).setMinimalPurchase(1e6);
        ICurveController(curveController).setSellTeamFee(10);
        IPoolController(poolController).setMaxSellPctPerDay(500);

        // (47) событие
        emit Deploy(address(this), token, curveController, poolController, safe, treasury_, curveMathWrapper);

        return (curveController, poolController, curveMathWrapper);
    }

    // ------------------------------------------------------------------ initialize

    function initializeLevels(Types.Level[] memory newLevels) external override onlyOwner {
        if (IOwnable(levels).owner() != address(this)) revert Errors.NotOwner();
        ILevels(levels).init(newLevels);
        emit Initialize(address(this), newLevels.length);
    }

    function initializePoolPrice(uint256 initialPoolPrice_18) external override onlyOwner {
        if (IOwnable(poolState).owner() != address(this)) revert Errors.NotOwner();
        if (initialPoolPrice_18 == 0) revert Errors.InvalidAmount();
        if (ILevels(levels).length() == 0) revert Errors.InvalidParam();
        if (IReserveManager(reserveManager).S_curve() != 0) revert Errors.InvalidParam();

        uint256 pS0 = CurveMath.P(0, ILevels(levels).all());
        if (pS0 == 0) revert Errors.InvalidParam();

        uint256 lower = (pS0 * Constants.BASIS_POINTS) / (Constants.BASIS_POINTS + Constants.MAX_GAP);
        uint256 upper = (pS0 * (Constants.BASIS_POINTS + Constants.MAX_GAP)) / Constants.BASIS_POINTS;
        if (initialPoolPrice_18 < lower) revert Errors.OutOfBounds();
        if (initialPoolPrice_18 > upper) revert Errors.OutOfBounds();

        IPoolState(poolState).initializePoolPrice(initialPoolPrice_18);
    }

    function registerParams() external override onlyOwner {
        if (IOwnable(registry).owner() != address(this)) revert Errors.NotOwner();
        IParameterRegistry r = IParameterRegistry(registry);
        r.register(Constants.PARAM_BUY_FEE, curveController, ICurveController.setBuyFee.selector, 0, 200);
        r.register(Constants.PARAM_REDEEM_FEE, curveController, ICurveController.setRedeemFee.selector, 0, 200);
        r.register(Constants.PARAM_EARLY_SELL_FEE, curveController, ICurveController.setEarlySellFee.selector, 0, 500);
        r.register(
            Constants.PARAM_EARLY_SELL_PERIOD,
            curveController,
            ICurveController.setEarlySellPeriod.selector,
            0,
            7_776_000
        );
        r.register(
            Constants.PARAM_MAX_PURCHASE_PCT, curveController, ICurveController.setMaxPurchasePct.selector, 0, 1000
        );
        r.register(
            Constants.PARAM_MINIMAL_PURCHASE, curveController, ICurveController.setMinimalPurchase.selector, 1e6, 1e12
        );
        r.register(
            Constants.PARAM_MAX_SELL_PCT_PER_DAY, poolController, IPoolController.setMaxSellPctPerDay.selector, 0, 500
        );
        r.register(
            Constants.PARAM_CIRCUIT_BREAKER_THRESHOLD, circuitBreaker, ICircuitBreaker.setThreshold.selector, 500, 2000
        );
        r.register(Constants.PARAM_SELL_TEAM_FEE, curveController, ICurveController.setSellTeamFee.selector, 0, 50);
    }

    // ------------------------------------------------------------------ finalize

    function finalize(address safe) external override onlyOwner {
        if (safe == address(0)) revert Errors.InvalidAddress();
        if (safe == address(this)) revert Errors.InvalidAddress();
        if (safe.code.length == 0) revert Errors.InvalidAddress();

        _requirePauser(safe);

        // передача ownership
        IOwnable(levels).transferOwnership(safe);
        IOwnable(registry).transferOwnership(safe);
        IOwnable(poolState).transferOwnership(safe);
        IOwnable(curveController).transferOwnership(safe);
        super.transferOwnership(safe);

        // отзыв временного GOVERNANCE_ROLE
        IAccessControl(curveController).renounceRole(Roles.GOVERNANCE_ROLE, address(this));
        IAccessControl(poolController).renounceRole(Roles.GOVERNANCE_ROLE, address(this));

        // отзыв DEFAULT_ADMIN_ROLE во всех 9 AccessControl-контрактах
        IAccessControl(token).renounceRole(Roles.DEFAULT_ADMIN_ROLE, address(this));
        IAccessControl(curveController).renounceRole(Roles.DEFAULT_ADMIN_ROLE, address(this));
        IAccessControl(poolController).renounceRole(Roles.DEFAULT_ADMIN_ROLE, address(this));
        IAccessControl(reserveManager).renounceRole(Roles.DEFAULT_ADMIN_ROLE, address(this));
        IAccessControl(vesting).renounceRole(Roles.DEFAULT_ADMIN_ROLE, address(this));
        IAccessControl(circuitBreaker).renounceRole(Roles.DEFAULT_ADMIN_ROLE, address(this));
        IAccessControl(governance).renounceRole(Roles.DEFAULT_ADMIN_ROLE, address(this));
        IAccessControl(timelock).renounceRole(Roles.DEFAULT_ADMIN_ROLE, address(this));
        IAccessControl(poolState).renounceRole(Roles.DEFAULT_ADMIN_ROLE, address(this));

        emit Finalize(address(this), safe);
    }

    // ------------------------------------------------------------------ internal

    // Admin-проверка не используется: DEFAULT_ADMIN_ROLE никому не выдаётся.
    function _requireAdmin(address safe) internal view {
        if (!IAccessControl(token).hasRole(Roles.DEFAULT_ADMIN_ROLE, safe)) revert Errors.SafeNotAdmin();
        if (!IAccessControl(curveController).hasRole(Roles.DEFAULT_ADMIN_ROLE, safe)) revert Errors.SafeNotAdmin();
        if (!IAccessControl(poolController).hasRole(Roles.DEFAULT_ADMIN_ROLE, safe)) revert Errors.SafeNotAdmin();
        if (!IAccessControl(reserveManager).hasRole(Roles.DEFAULT_ADMIN_ROLE, safe)) revert Errors.SafeNotAdmin();
        if (!IAccessControl(vesting).hasRole(Roles.DEFAULT_ADMIN_ROLE, safe)) revert Errors.SafeNotAdmin();
        if (!IAccessControl(circuitBreaker).hasRole(Roles.DEFAULT_ADMIN_ROLE, safe)) revert Errors.SafeNotAdmin();
        if (!IAccessControl(governance).hasRole(Roles.DEFAULT_ADMIN_ROLE, safe)) revert Errors.SafeNotAdmin();
        if (!IAccessControl(timelock).hasRole(Roles.DEFAULT_ADMIN_ROLE, safe)) revert Errors.SafeNotAdmin();
        if (!IAccessControl(poolState).hasRole(Roles.DEFAULT_ADMIN_ROLE, safe)) revert Errors.SafeNotAdmin();
    }

    function _requirePauser(address safe) internal view {
        if (!IAccessControl(curveController).hasRole(Roles.PAUSER_ROLE, safe)) revert Errors.SafeNotPauser();
        if (!IAccessControl(poolController).hasRole(Roles.PAUSER_ROLE, safe)) revert Errors.SafeNotPauser();
    }
}
