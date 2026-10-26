// SPDX-License-Identifier: AGPL-3.0
pragma solidity 0.8.24;

interface IPoolController {
    function buyFromPool(uint256 X_6, uint256 minTokensOut, uint256 deadline) external returns (uint256);
    function sellToPool(uint256 deltaP, uint256 minUsdcOut_6, uint256 deadline) external returns (uint256);
    function poolPrice() external view returns (uint256);
    function effectiveMinimalX6() external view returns (uint256);
    function treasury() external view returns (address);
    function maxSellPctPerDay() external view returns (uint256);
    function setMaxSellPctPerDay(uint256) external;
    function pause() external;
    function unpause() external;
}
