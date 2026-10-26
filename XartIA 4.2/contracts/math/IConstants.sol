// SPDX-License-Identifier: AGPL-3.0
pragma solidity 0.8.24;

/// @title IConstants — view-доступ к константам протокола
/// @notice Не обязательно для использования, полезно для внешних интеграций и frontend.
interface IConstants {
    function PRECISION() external pure returns (uint256);
    function USDC_PRECISION() external pure returns (uint256);
    function BASIS_POINTS() external pure returns (uint256);
    function MAX_LEVELS() external pure returns (uint8);
    function TIMELOCK_DELAY() external pure returns (uint256);
}
