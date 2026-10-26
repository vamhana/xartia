// SPDX-License-Identifier: AGPL-3.0
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IReserveManager} from "../../contracts/reserve/IReserveManager.sol";
import {IXartIAFactory} from "../../contracts/factory/IXartIAFactory.sol";
import {InvariantBaseExt} from "./InvariantBaseExt.sol";

/// @title InvariantSupply.t.sol — T.3.01.02
/// @notice totalSupply(XRT) == S_curve (единственный источник истины — ReserveManager).
/// @dev Vesting и PoolController держат часть токенов, но их баланс — часть totalSupply.
contract InvariantSupplyTest is InvariantBaseExt {
    function setUp() public {
        setUpInvariantExt();
    }

    function invariant_supply() public view {
        IERC20 token = IERC20(IXartIAFactory(factory).token());
        IReserveManager rm = IReserveManager(IXartIAFactory(factory).reserveManager());
        assertEq(token.totalSupply(), rm.S_curve(), "supply != S_curve");
    }
}
