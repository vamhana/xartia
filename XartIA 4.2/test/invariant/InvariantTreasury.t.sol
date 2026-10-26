// SPDX-License-Identifier: AGPL-3.0
pragma solidity 0.8.24;

import {IXartIAFactory} from "../../contracts/factory/IXartIAFactory.sol";
import {MockUSDC} from "../utils/MockUSDC.sol";
import {InvariantBaseExt} from "./InvariantBaseExt.sol";

/// @title InvariantTreasury.t.sol — T.3.01.09
/// @notice treasury_balance монотонно неубывающий. Никакая операция протокола
///         не может уменьшить баланс treasury.
/// @dev Ghost ghost_treasuryMax обновляется в handler'е после каждой операции.
contract InvariantTreasuryTest is InvariantBaseExt {
    function setUp() public {
        setUpInvariantExt();
    }

    function invariant_treasury_monotonic() public view {
        address treasury = IXartIAFactory(factory).treasury();
        uint256 balance = MockUSDC(usdc).balanceOf(treasury);
        assertGe(balance, handler.ghost_treasuryMax(), "treasury balance decreased");
    }
}
