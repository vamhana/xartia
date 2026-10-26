// SPDX-License-Identifier: AGPL-3.0
pragma solidity 0.8.24;

/// @title Roles — единый реестр ролей AccessControl
/// @notice Роли выдаются Factory при деплое. НЕТ ролей CURVE_CONTROLLER_ROLE/POOL_CONTROLLER_ROLE;
///         CONTROLLER_ROLE покрывает оба контроллера в контексте ReserveManager.
library Roles {
    bytes32 internal constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 internal constant BURNER_ROLE = keccak256("BURNER_ROLE");
    bytes32 internal constant CONTROLLER_ROLE = keccak256("CONTROLLER_ROLE");
    bytes32 internal constant POOL_WRITER_ROLE = keccak256("POOL_WRITER_ROLE");
    bytes32 internal constant PRICE_WRITER_ROLE = keccak256("PRICE_WRITER_ROLE");
    bytes32 internal constant POOL_CALLER_ROLE = keccak256("POOL_CALLER_ROLE"); // legacy, не используется в CurveController
    bytes32 internal constant GOVERNANCE_ROLE = keccak256("GOVERNANCE_ROLE");
    bytes32 internal constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    bytes32 internal constant DEFAULT_ADMIN_ROLE = 0x00;
}
