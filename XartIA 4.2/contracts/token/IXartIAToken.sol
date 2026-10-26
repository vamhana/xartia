// SPDX-License-Identifier: AGPL-3.0
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title IXartIAToken — расширение IERC20 для внутренних интеграций и моков
/// @notice burn(address,uint256) удалён. mint/burnFrom доступны только через роли.
interface IXartIAToken is IERC20 {
    function mint(address to, uint256 amount) external;
    function burnFrom(address from, uint256 amount) external;
    function grantRole(bytes32 role, address account) external;
}
