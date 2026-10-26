// SPDX-License-Identifier: AGPL-3.0
pragma solidity 0.8.24;

import {Constants} from "../../contracts/math/Constants.sol";
import {Types} from "../../contracts/math/Types.sol";
import {CurveMath} from "../../contracts/math/CurveMath.sol";
import {ILevels} from "../../contracts/math/ILevels.sol";
import {IPoolState} from "../../contracts/math/IPoolState.sol";
import {IReserveManager} from "../../contracts/reserve/IReserveManager.sol";
import {IXartIAFactory} from "../../contracts/factory/IXartIAFactory.sol";
import {InvariantBaseExt} from "./InvariantBaseExt.sol";

/// @title InvariantPool.t.sol — T.3.01.03
/// @notice poolPrice в симметричном коридоре [P(S)/(1+GAP), P(S)*(1+GAP)].
contract InvariantPoolTest is InvariantBaseExt {
    function setUp() public {
        setUpInvariantExt();
    }

    function invariant_poolPrice_bounds() public view {
        IXartIAFactory f = IXartIAFactory(factory);
        uint256 price = IPoolState(f.poolState()).poolPrice();
        if (price == 0) return;

        uint256 sCurve = IReserveManager(f.reserveManager()).S_curve();
        Types.Level[] memory lv = ILevels(f.levels()).all();
        uint256 pS = CurveMath.P(sCurve, lv);

        uint256 lower = (pS * Constants.BASIS_POINTS) / (Constants.BASIS_POINTS + Constants.MAX_GAP);
        uint256 upper = (pS * (Constants.BASIS_POINTS + Constants.MAX_GAP)) / Constants.BASIS_POINTS;

        assertGe(price, lower, "poolPrice below floor");
        assertLe(price, upper, "poolPrice above ceiling");
    }
}
