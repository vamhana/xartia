// SPDX-License-Identifier: AGPL-3.0
pragma solidity 0.8.24;

import {Script, console2} from "forge-std/Script.sol";

import {XartIAToken} from "../contracts/token/XartIAToken.sol";

/// @title DeployToken — изолированный деплой только XartIAToken
/// @notice Используется в unit-тестах и для раздельного деплоя. НЕ деплоит систему целиком —
///         для полного деплоя используйте script/Deploy.s.sol (D.1.01.01).
/// @dev В изолированном токене нет фабрики: DEFAULT_ADMIN_ROLE выдаётся деплойеру
///      в конструкторе XartIAToken. Для полноценной системы роли выдаются через
///      XartIAFactory.deploy().
contract DeployToken is Script {
    /// @notice Развёртывает XartIAToken в broadcast-режиме.
    /// @return token Адрес развёрнутого токена.
    function run() external returns (address token) {
        vm.startBroadcast();
        XartIAToken t = new XartIAToken();
        vm.stopBroadcast();

        token = address(t);
        console2.log("=== DeployToken ===");
        console2.log("XartIAToken deployed at:", token);
        console2.log("  name:    ", t.name());
        console2.log("  symbol:  ", t.symbol());
        console2.log("  decimals:", t.decimals());
        console2.log("  supply:  ", t.totalSupply());
    }
}
