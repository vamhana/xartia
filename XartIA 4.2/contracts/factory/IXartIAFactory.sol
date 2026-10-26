// SPDX-License-Identifier: AGPL-3.0
pragma solidity 0.8.24;

import {Types} from "../math/Types.sol";

interface IXartIAFactory {
    function deploy(address safe, address treasury, uint256 initialThreshold, address usdc)
        external
        returns (address curveController, address poolController, address curveMathWrapper);

    function initializeLevels(Types.Level[] memory levels) external;
    function initializePoolPrice(uint256 initialPoolPrice) external;
    function registerParams() external;
    function finalize(address safe) external;

    function token() external view returns (address);
    function levels() external view returns (address);
    function registry() external view returns (address);
    function poolState() external view returns (address);
    function reserveManager() external view returns (address);
    function vesting() external view returns (address);
    function circuitBreaker() external view returns (address);
    function curveController() external view returns (address);
    function poolController() external view returns (address);
    function governance() external view returns (address);
    function timelock() external view returns (address);
    function curveMathWrapper() external view returns (address);
    function treasury() external view returns (address);
}
