// SPDX-License-Identifier: AGPL-3.0
pragma solidity 0.8.24;

import {InvariantBaseExt} from "./InvariantBaseExt.sol";

/// @title InvariantPoolPrice.t.sol — T.3.01.05
/// @notice Монотонность poolPrice при sellToPool: ghost_lastSellPriceAfter ≥ ghost_lastSellPriceBefore.
/// @dev Проверяется только после успешного sellToPool. Если последняя операция была не sellToPool —
///      ghosts содержат значения с прошлой sellToPool, проверка тоже проходит (свойство stateless).
contract InvariantPoolPriceTest is InvariantBaseExt {
    function setUp() public {
        setUpInvariantExt();
    }

    function invariant_poolPrice_monotonic() public view {
        if (handler.ghost_lastSellPriceBefore() == 0) return; // sellToPool ещё не было
        assertGe(
            handler.ghost_lastSellPriceAfter(),
            handler.ghost_lastSellPriceBefore(),
            "poolPrice not monotonic on sellToPool"
        );
    }
}
