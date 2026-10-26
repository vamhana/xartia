// SPDX-License-Identifier: AGPL-3.0
pragma solidity 0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

import {Roles} from "../core/Roles.sol";
import {Constants} from "../math/Constants.sol";
import {Errors} from "../math/Errors.sol";
import {IReserveManager} from "../reserve/IReserveManager.sol";
import {Events} from "../events/Events.sol";
import {ICircuitBreaker} from "./ICircuitBreaker.sol";

/// @title CircuitBreaker — предохранитель по доле свободного резерва
/// @notice active() = freeReserve / reserve < threshold, в bp.
///         При reserve == 0 (до первого депозита) возвращает false — деление на ноль
///         невозможно и семантически «нет резерва — нет срабатывания».
///         Срабатывание блокирует sellToPool, но не redeemFromCurve/buyFromCurve.
/// @dev threshold ∈ [500, 2000] bp (5%–20%). Проверяется и в конструкторе, и в сеттере.
///      setThreshold — только GOVERNANCE_ROLE (Timelock). Выдаётся в Factory.deploy (шаг 34b).
contract CircuitBreaker is ICircuitBreaker, AccessControl, Events {
    uint256 public override threshold;
    address public immutable override reserveManager;

    uint256 private constant MIN_THRESHOLD = 50;
    uint256 private constant MAX_THRESHOLD = 2000;

    constructor(uint256 initialThreshold, address reserveManager_) {
        if (initialThreshold < MIN_THRESHOLD || initialThreshold > MAX_THRESHOLD) {
            revert Errors.OutOfBounds();
        }
        if (reserveManager_ == address(0)) revert Errors.InvalidAddress();
        threshold = initialThreshold;
        reserveManager = reserveManager_;
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        emit ThresholdUpdated(0, initialThreshold);
    }

    /// @inheritdoc ICircuitBreaker
    /// @dev reserve и freeReserve — 18 decimals, поэтому множитель BASIS_POINTS корректен.
    function active() public view override returns (bool) {
        uint256 r = IReserveManager(reserveManager).reserve();
        if (r == 0) return false;
        uint256 fr = IReserveManager(reserveManager).freeReserve();
        return (fr * Constants.BASIS_POINTS) / r < threshold;
    }

    /// @inheritdoc ICircuitBreaker
    function setThreshold(uint256 newThreshold) external override onlyRole(Roles.GOVERNANCE_ROLE) {
        if (newThreshold < MIN_THRESHOLD || newThreshold > MAX_THRESHOLD) {
            revert Errors.OutOfBounds();
        }
        uint256 old = threshold;
        threshold = newThreshold;
        emit ThresholdUpdated(old, newThreshold);
    }
}
