// SPDX-License-Identifier: AGPL-3.0
pragma solidity 0.8.24;

import {Script, console2} from "forge-std/Script.sol";

import {IXartIAFactory} from "../contracts/factory/IXartIAFactory.sol";
import {Types} from "../contracts/math/Types.sol";

/// @title Initialize — initializeLevels + initializePoolPrice + registerParams
/// @notice Читает deployments/<network>.json (адрес factory) и config/<network>.toml (p0),
///         config/levels.json (таблица уровней). p0 из конфига в 6-dec конвертируется в 18-dec.
/// @dev p0_initial_pool_price_6dec — цена в 6 decimals (USDC). Умножаем на 1e12 для 18-dec.
contract Initialize is Script {
    function run() external {
        string memory network = vm.envOr("NETWORK", string("amoy"));

        string memory depJson = vm.readFile(string.concat("deployments/", network, ".json"));
        address factory = vm.parseJsonAddress(depJson, ".factory");

        string memory cfgToml = vm.readFile(string.concat("config/", network, ".toml"));
        uint256 p0_6 = vm.parseTomlUint(cfgToml, ".p0_initial_pool_price_6dec");
        uint256 p0_18 = p0_6 * 1e12;

        Types.Level[] memory levels = _readLevels("config/levels.json");

        console2.log("=== Initialize ===");
        console2.log("network:  ", network);
        console2.log("factory:  ", factory);
        console2.log("p0 (6d):  ", p0_6);
        console2.log("p0 (18d): ", p0_18);
        console2.log("levels:   ", levels.length);

        vm.startBroadcast();
        IXartIAFactory(factory).initializeLevels(levels);
        IXartIAFactory(factory).initializePoolPrice(p0_18);
        IXartIAFactory(factory).registerParams();
        vm.stopBroadcast();

        console2.log("initialize complete");
    }

    // ------------------------------------------------------------------ internal

    function _readLevels(string memory path) internal view returns (Types.Level[] memory levels) {
        string memory json = vm.readFile(path);
        uint256 count = vm.parseJsonUint(json, ".count");
        levels = new Types.Level[](count);
        for (uint256 i = 0; i < count; i++) {
            string memory prefix = string.concat(".levels[", vm.toString(i), "]");
            levels[i] = Types.Level({
                S_start: vm.parseJsonUint(json, string.concat(prefix, ".S_start")),
                S_end: vm.parseJsonUint(json, string.concat(prefix, ".S_end")),
                P_start: vm.parseJsonUint(json, string.concat(prefix, ".P_start")),
                P_end: vm.parseJsonUint(json, string.concat(prefix, ".P_end")),
                maxBalance: vm.parseJsonUint(json, string.concat(prefix, ".maxBalance"))
            });
        }
    }
}
