// SPDX-License-Identifier: AGPL-3.0
pragma solidity 0.8.24;

interface IPoolState {
    function initializePoolPrice(uint256 initialPrice_18) external;
    function pool() external view returns (uint256);
    function poolPrice() external view returns (uint256);
    function setPool(uint256 newPool) external;
    function setPoolPrice(uint256 newPrice_18) external;
}
