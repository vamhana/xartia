// SPDX-License-Identifier: AGPL-3.0
pragma solidity 0.8.24;

import {IReserveManager} from "../../contracts/reserve/IReserveManager.sol";
import {IXartIAFactory} from "../../contracts/factory/IXartIAFactory.sol";
import {InvariantBaseExt} from "./InvariantBaseExt.sol";

/// @title InvariantReserve.t.sol — T.3.01.01
/// @notice Инвариант: reserve ≥ R(S_curve) после любой операции.
contract InvariantReserveTest is InvariantBaseExt {
    function setUp() public {
        setUpInvariantExt();
    }

    function invariant_reserve() public view {
        IReserveManager rm = IReserveManager(IXartIAFactory(factory).reserveManager());
        assertGe(rm.reserve(), rm.curveBacking(), "reserve < curveBacking");
    }
}
