// SPDX-License-Identifier: AGPL-3.0
pragma solidity 0.8.24;

import {Script, console2} from "forge-std/Script.sol";

/// @title Verify — выводит адреса и конструктор-аргументы для forge verify-contract
/// @notice Сам verification — CLI-команда (`forge verify-contract`), недоступная из cheatcodes.
///         Скрипт печатает список команд, которые нужно запустить через scripts/shell/verify.sh.
contract Verify is Script {
    function run() external view {
        string memory network = vm.envOr("NETWORK", string("amoy"));
        string memory json = vm.readFile(string.concat("deployments/", network, ".json"));

        string memory apiKey = vm.envOr("POLYGONSCAN_API_KEY", string(""));
        require(bytes(apiKey).length > 0, "Verify: POLYGONSCAN_API_KEY not set");

        console2.log("=== Verify addresses (network:", network, ") ===");
        console2.log("token:             ", vm.parseJsonAddress(json, ".token"));
        console2.log("levels:            ", vm.parseJsonAddress(json, ".levels"));
        console2.log("registry:          ", vm.parseJsonAddress(json, ".registry"));
        console2.log("poolState:         ", vm.parseJsonAddress(json, ".poolState"));
        console2.log("reserveManager:    ", vm.parseJsonAddress(json, ".reserveManager"));
        console2.log("vesting:           ", vm.parseJsonAddress(json, ".vesting"));
        console2.log("circuitBreaker:    ", vm.parseJsonAddress(json, ".circuitBreaker"));
        console2.log("governance:        ", vm.parseJsonAddress(json, ".governance"));
        console2.log("timelock:          ", vm.parseJsonAddress(json, ".timelock"));
        console2.log("factory:           ", vm.parseJsonAddress(json, ".factory"));
        console2.log("curveController:   ", vm.parseJsonAddress(json, ".curveController"));
        console2.log("poolController:    ", vm.parseJsonAddress(json, ".poolController"));
        console2.log("curveMathWrapper:  ", vm.parseJsonAddress(json, ".curveMathWrapper"));
        console2.log("");
        console2.log("See scripts/shell/verify.sh for the actual forge verify-contract calls.");
    }
}
