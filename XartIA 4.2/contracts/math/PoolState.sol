// SPDX-License-Identifier: AGPL-3.0
pragma solidity 0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Roles} from "../core/Roles.sol";
import {Errors} from "./Errors.sol";
import {IPoolState} from "./IPoolState.sol";
import {Events} from "../events/Events.sol";

/// @title PoolState — общее состояние пула
/// @notice Dual-authority: Ownable для initializePoolPrice (одноразово), AccessControl —
///         для регулярных обновлений setPool (POOL_WRITER_ROLE) и setPoolPrice (PRICE_WRITER_ROLE).
///         Все величины — 18 decimals. poolPrice = 18-dec USDC per 1 XRT.
/// @dev setPoolPrice не проверяет newPrice_18 > 0 — по спеке ответственность на контроллерах.
///      После инициализации poolPrice == 0 заблокировал бы торговлю (NotInitialized),
///      поэтому контроллеры обязаны писать значения > 0 (это проверяется их тестами).
contract PoolState is IPoolState, Ownable, AccessControl, Events {
    uint256 public pool;
    uint256 public poolPrice;

    constructor() Ownable(msg.sender) {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    function initializePoolPrice(uint256 initialPrice_18) external override onlyOwner {
        if (initialPrice_18 == 0) revert Errors.InvalidAmount();
        if (poolPrice != 0) revert Errors.AlreadyInitialized();
        poolPrice = initialPrice_18;
        emit PoolPriceInitialized(initialPrice_18);
    }

    function setPool(uint256 newPool) external override onlyRole(Roles.POOL_WRITER_ROLE) {
        pool = newPool;
    }

    function setPoolPrice(uint256 newPrice_18) external override onlyRole(Roles.PRICE_WRITER_ROLE) {
        uint256 old = poolPrice;
        poolPrice = newPrice_18;
        emit PoolPriceUpdated(old, newPrice_18);
    }
}
