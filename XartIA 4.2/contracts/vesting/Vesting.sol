// SPDX-License-Identifier: AGPL-3.0
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

import {Roles} from "../core/Roles.sol";
import {Errors} from "../math/Errors.sol";
import {IVesting} from "./IVesting.sol";

// Module-level constants: не принимаются в конструкторе. Расписание фиксировано протоколом.
uint256 constant VESTING_CLIFF = 365 days;
uint256 constant VESTING_DURATION = 730 days;

/// @title Vesting — единственный токенный канал дохода команды
/// @notice teamTokens (0.5% от ΔS на покупках) минтится в этот контракт.
///         USDC-доход команды идёт отдельно — через sellTeamFee в treasury
///         (см. CurveController, PoolController). Vesting НЕ получает USDC.
///         Treasury НЕ получает токены.
/// @dev Схема: [start, start+CLIFF] — 0 vested; [start+CLIFF, start+CLIFF+DURATION] —
///      линейно totalAdded → 0. Если addTokens вызывается после начала расписания,
///      новые токены подпадают под то же расписание (vestingStart фиксируется навсегда).
contract Vesting is IVesting, AccessControl {
    using SafeERC20 for IERC20;

    address public immutable override beneficiary;
    address public immutable token;

    uint256 public vestingStart;
    uint256 public totalAdded;
    uint256 public totalReleased;

    constructor(address safe, address token_) {
        if (safe == address(0)) revert Errors.InvalidAddress();
        if (token_ == address(0)) revert Errors.InvalidAddress();
        beneficiary = safe;
        token = token_;
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    // ------------------------------------------------------------------ mutations

    /// @inheritdoc IVesting
    /// @dev Порядок шагов — как в спеке: сначала фиксируем старт, затем проверяем
    ///      баланс, затем увеличиваем totalAdded. Проверка баланса защищает от
    ///      рассинхрона между обещанным (totalAdded) и фактически заминченным.
    function addTokens(uint256 amount) external override onlyRole(Roles.MINTER_ROLE) {
        if (amount == 0) revert Errors.InvalidAmount();
        if (totalAdded == 0) vestingStart = block.timestamp;
        if (IERC20(token).balanceOf(address(this)) < totalAdded + amount - totalReleased) {
            revert Errors.InsufficientVestingBalance();
        }
        totalAdded += amount;
    }

    /// @inheritdoc IVesting
    function release() external override {
        uint256 amount = releasable();
        if (amount == 0) revert Errors.InvalidAmount();
        totalReleased += amount;
        IERC20(token).safeTransfer(beneficiary, amount);
    }

    // ------------------------------------------------------------------ views

    /// @inheritdoc IVesting
    function vestedAmount() public view override returns (uint256) {
        if (totalAdded == 0) return 0;
        if (block.timestamp < vestingStart + VESTING_CLIFF) return 0;
        uint256 elapsed = block.timestamp - vestingStart - VESTING_CLIFF;
        if (elapsed >= VESTING_DURATION) return totalAdded;
        return totalAdded * elapsed / VESTING_DURATION;
    }

    /// @inheritdoc IVesting
    function releasable() public view override returns (uint256) {
        return vestedAmount() - totalReleased;
    }

    function vestingCliff() external view returns (uint256) {
        return VESTING_CLIFF;
    }

    function vestingDuration() external view returns (uint256) {
        return VESTING_DURATION;
    }
}
