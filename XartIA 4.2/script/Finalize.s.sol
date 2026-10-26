// SPDX-License-Identifier: AGPL-3.0
pragma solidity 0.8.24;

import {Script, console2} from "forge-std/Script.sol";

import {IXartIAFactory} from "../contracts/factory/IXartIAFactory.sol";

/// @title Finalize — передача ownership на safe, отзыв всех ролей у Factory
/// @notice Читает deployments/<network>.json. Предварительно валидирует safe:
///         != address(0), != factory, code.length > 0.
/// @dev После finalize у Factory нет ни одной роли; единственный owner — safe.
contract Finalize is Script {
    function run() external {
        string memory network = vm.envOr("NETWORK", string("amoy"));
        string memory depJson = vm.readFile(string.concat("deployments/", network, ".json"));

        address factory = vm.parseJsonAddress(depJson, ".factory");
        address safe = vm.parseJsonAddress(depJson, ".safe");

        // Pre-flight validation (явные ошибки до отправки транзакции)
        require(safe != address(0), "Finalize: safe is zero");
        require(safe != factory, "Finalize: safe is factory");
        require(safe.code.length > 0, "Finalize: safe is EOA");

        console2.log("=== Finalize ===");
        console2.log("network: ", network);
        console2.log("factory: ", factory);
        console2.log("safe:    ", safe);

        vm.startBroadcast();
        IXartIAFactory(factory).finalize(safe);
        vm.stopBroadcast();

        console2.log("finalize complete");
    }
}
