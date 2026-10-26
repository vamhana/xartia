// SPDX-License-Identifier: AGPL-3.0
pragma solidity 0.8.24;

import {Script, console2} from "forge-std/Script.sol";

import {XartIAFactory} from "../contracts/factory/XartIAFactory.sol";
import {IXartIAFactory} from "../contracts/factory/IXartIAFactory.sol";

/// @title Deploy — деплой Factory и всех контрактов системы
/// @notice Читает config/<network>.toml, вызывает factory.deploy(), пишет deployments/<network>.json.
///         NETWORK env var: amoy (default) | polygon.
/// @dev Порядок запуска: Deploy → Initialize → Finalize.
contract Deploy is Script {
    struct Config {
        string rpcUrl;
        uint256 chainId;
        address usdc;
        address safe;
        address treasury;
        uint256 initialThreshold;
        uint256 p0InitialPoolPrice6Dec;
    }

    function run()
        external
        returns (address factory, address curveController, address poolController, address curveMathWrapper)
    {
        string memory network = vm.envOr("NETWORK", string("amoy"));
        string memory cfgPath = string.concat("config/", network, ".toml");
        string memory toml = vm.readFile(cfgPath);

        Config memory cfg = _parseConfig(toml);
        if (cfg.treasury == address(0)) cfg.treasury = cfg.safe;

        console2.log("=== Deploy ===");
        console2.log("network:   ", network);
        console2.log("chainId:   ", cfg.chainId);
        console2.log("usdc:      ", cfg.usdc);
        console2.log("safe:      ", cfg.safe);
        console2.log("treasury:  ", cfg.treasury);
        console2.log("threshold: ", cfg.initialThreshold);

        vm.startBroadcast();
        XartIAFactory f = new XartIAFactory();
        (curveController, poolController, curveMathWrapper) =
            f.deploy(cfg.safe, cfg.treasury, cfg.initialThreshold, cfg.usdc);
        vm.stopBroadcast();

        factory = address(f);

        _writeDeployment(network, cfg, factory, curveController, poolController, curveMathWrapper);

        console2.log("");
        console2.log("factory:           ", factory);
        console2.log("curveController:   ", curveController);
        console2.log("poolController:    ", poolController);
        console2.log("curveMathWrapper:  ", curveMathWrapper);
    }

    // ------------------------------------------------------------------ internal

    function _parseConfig(string memory toml) internal view returns (Config memory c) {
        c.rpcUrl = vm.parseTomlString(toml, ".rpc_url");
        c.chainId = vm.parseTomlUint(toml, ".chain_id");
        c.usdc = vm.parseTomlAddress(toml, ".usdc");
        c.safe = vm.parseTomlAddress(toml, ".safe");
        c.initialThreshold = vm.parseTomlUint(toml, ".initial_threshold");
        c.p0InitialPoolPrice6Dec = vm.parseTomlUint(toml, ".p0_initial_pool_price_6dec");

        if (vm.keyExistsToml(toml, ".treasury")) {
            c.treasury = vm.parseTomlAddress(toml, ".treasury");
        } else {
            c.treasury = address(0);
        }
    }

    function _writeDeployment(
        string memory network,
        Config memory cfg,
        address factory,
        address curveController,
        address poolController,
        address curveMathWrapper
    ) internal {
        IXartIAFactory f = IXartIAFactory(factory);
        string memory obj = "deployment";
        vm.serializeUint(obj, "chainId", cfg.chainId);
        vm.serializeAddress(obj, "factory", factory);
        vm.serializeAddress(obj, "token", f.token());
        vm.serializeAddress(obj, "levels", f.levels());
        vm.serializeAddress(obj, "registry", f.registry());
        vm.serializeAddress(obj, "poolState", f.poolState());
        vm.serializeAddress(obj, "reserveManager", f.reserveManager());
        vm.serializeAddress(obj, "vesting", f.vesting());
        vm.serializeAddress(obj, "circuitBreaker", f.circuitBreaker());
        vm.serializeAddress(obj, "governance", f.governance());
        vm.serializeAddress(obj, "timelock", f.timelock());
        vm.serializeAddress(obj, "safe", cfg.safe);
        vm.serializeAddress(obj, "treasury", cfg.treasury);
        vm.serializeAddress(obj, "usdc", cfg.usdc);
        vm.serializeAddress(obj, "curveController", curveController);
        vm.serializeAddress(obj, "poolController", poolController);
        string memory finalJson = vm.serializeAddress(obj, "curveMathWrapper", curveMathWrapper);

        string memory path = string.concat("deployments/", network, ".json");
        vm.writeJson(finalJson, path);
        console2.log("deployment written to", path);
    }
}
