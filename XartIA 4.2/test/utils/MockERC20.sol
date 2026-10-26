// SPDX-License-Identifier: AGPL-3.0
pragma solidity 0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IXartIAToken} from "../../contracts/token/IXartIAToken.sol";

/// @title MockERC20 — общий ERC20-мок, реализующий IXartIAToken
/// @notice Игнорирует роли: grantRole — no-op, mint/burnFrom доступны всем.
///         НЕ использовать в тестах AccessControl — там нужен реальный XartIAToken.
contract MockERC20 is ERC20, IXartIAToken {
    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) {}

    function mint(address to, uint256 amount) external override {
        _mint(to, amount);
    }

    function burnFrom(address from, uint256 amount) external override {
        _burn(from, amount);
    }

    function grantRole(bytes32, address) external pure override {
        // no-op: мок игнорирует роли
    }
}
