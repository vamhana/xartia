// SPDX-License-Identifier: AGPL-3.0
pragma solidity 0.8.24;

import {Types} from "./Types.sol";

interface ILevels {
    function init(Types.Level[] memory newLevels) external;
    function getLevel(uint256 S) external view returns (uint8);
    function getBounds(uint8 levelIndex) external view returns (uint256, uint256);
    function getMaxBalance(uint8 levelIndex) external view returns (uint256);
    function all() external view returns (Types.Level[] memory);
    function length() external view returns (uint256);
}
