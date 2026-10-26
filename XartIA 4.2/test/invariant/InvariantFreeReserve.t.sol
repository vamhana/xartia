// SPDX-License-Identifier: AGPL-3.0
pragma solidity 0.8.24;

import {IReserveManager} from "../../contracts/reserve/IReserveManager.sol";
import {IXartIAFactory} from "../../contracts/factory/IXartIAFactory.sol";
import {InvariantBaseExt} from "./InvariantBaseExt.sol";

/// @title InvariantFreeReserve.t.sol — T.3.01.04
/// @notice freeReserve ≥ 0 (защищено от underflow в ReserveManager.freeReserve()).
contract InvariantFreeReserveTest is InvariantBaseExt {
    function setUp() public {
        setUpInvariantExt();
    }

    function invariant_freeReserve() public view {
        IReserveManager rm = IReserveManager(IXartIAFactory(factory).reserveManager());
        uint256 fr = rm.freeReserve();
        // Проверка: fr + curveBacking == reserve (или fr == 0, если reserve < curveBacking — но инвариант reserve держится)
        assertEq(fr + rm.curveBacking(), rm.reserve(), "freeReserve accounting broken");
    }
}
