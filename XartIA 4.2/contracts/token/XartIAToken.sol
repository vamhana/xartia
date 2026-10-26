// SPDX-License-Identifier: AGPL-3.0
pragma solidity 0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Roles} from "../core/Roles.sol";

/// @title XartIAToken — ERC-20 «XartIA» / «XRT», 18 decimals
/// @notice mint — MINTER_ROLE. burnFrom — BURNER_ROLE + allowance от from.
///         burn / self-burn удалены: единственный путь сжигания — burnFrom
///         с явным разрешением пользователя.
/// @dev События Mint/Burn дополняют стандартный Transfer — для индексатора и аудита.
contract XartIAToken is ERC20, AccessControl {
    event Mint(address indexed to, uint256 amount);
    event Burn(address indexed from, uint256 amount);

    constructor() ERC20("XartIA", "XRT") {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }

    function mint(address to, uint256 amount) external onlyRole(Roles.MINTER_ROLE) {
        _mint(to, amount);
        emit Mint(to, amount);
    }

    function burnFrom(address from, uint256 amount) external onlyRole(Roles.BURNER_ROLE) {
        _spendAllowance(from, msg.sender, amount);
        _burn(from, amount);
        emit Burn(from, amount);
    }
}
