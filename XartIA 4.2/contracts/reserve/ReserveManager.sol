// SPDX-License-Identifier: AGPL-3.0
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

import {Roles} from "../core/Roles.sol";
import {Errors} from "../math/Errors.sol";
import {CurveMath} from "../math/CurveMath.sol";
import {Types} from "../math/Types.sol";
import {ILevels} from "../math/ILevels.sol";
import {PrecisionLib} from "../libraries/PrecisionLib.sol";
import {IReserveManager} from "./IReserveManager.sol";

/// @title ReserveManager — кастодиан USDC и учёт инварианта reserve ≥ R(S_curve)
/// @notice Физически хранит USDC (6 decimals на балансе), учётные величины — 18 decimals.
///         updateScurve и pay — только CONTROLLER_ROLE (CurveController, PoolController).
/// @dev pay() ограничен только reserve(), не freeReserve(). Политика «не трогать пол» —
///      на контроллерах. Иначе ломается redeemFromCurve в стресс-сценарии, где выплата
///      идёт из reserve, а freeReserve == 0.
contract ReserveManager is IReserveManager, AccessControl {
    using SafeERC20 for IERC20;

    address public immutable override usdc;
    address public immutable override levels;

    uint256 private _sCurve;

    constructor(address usdc_, address levels_) {
        if (usdc_ == address(0)) revert Errors.InvalidAddress();
        if (levels_ == address(0)) revert Errors.InvalidAddress();
        usdc = usdc_;
        levels = levels_;
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    // ------------------------------------------------------------------ views

    /// @inheritdoc IReserveManager
    /// @dev Возвращает баланс USDC, приведённый к 18 decimals, для сравнения с R(S).
    function reserve() public view override returns (uint256) {
        return PrecisionLib.toWei(IERC20(usdc).balanceOf(address(this)));
    }

    /// @inheritdoc IReserveManager
    /// @dev R(S_curve_stored) — 18 decimals.
    function curveBacking() public view override returns (uint256) {
        return CurveMath.R(_sCurve, ILevels(levels).all());
    }

    /// @inheritdoc IReserveManager
    function freeReserve() external view override returns (uint256) {
        uint256 r = reserve();
        uint256 cb = curveBacking();
        return r > cb ? r - cb : 0;
    }

    /// @inheritdoc IReserveManager
    function S_curve() external view override returns (uint256) {
        return _sCurve;
    }

    /// @inheritdoc IReserveManager
    function checkInvariant() external view override returns (bool) {
        return reserve() >= curveBacking();
    }

    // ------------------------------------------------------------------ mutations

    /// @inheritdoc IReserveManager
    /// @dev Записываем S, затем проверяем инвариант по новому S. Revert атомарен:
    ///      при нарушении _sCurve откатится к прежнему значению.
    function updateScurve(uint256 newScurve) external override onlyRole(Roles.CONTROLLER_ROLE) {
        _sCurve = newScurve;
        if (reserve() < curveBacking()) revert Errors.ReserveInvariantViolation();
    }

    /// @inheritdoc IReserveManager
    /// @dev amount_18 в 18 decimals. Перед safeTransfer конвертируем в 6 decimals.
    ///      Округление toUSDC — вниз; накопленная пыль (<1e-6 USDC на вызов) остаётся
    ///      в резерве и не нарушает инвариант (reserve только растёт).
    function pay(address to, uint256 amount_18) external override onlyRole(Roles.CONTROLLER_ROLE) {
        if (amount_18 > reserve()) revert Errors.InsufficientReserve();
        uint256 amount_6 = PrecisionLib.toUSDC(amount_18);
        IERC20(usdc).safeTransfer(to, amount_6);
    }
}
