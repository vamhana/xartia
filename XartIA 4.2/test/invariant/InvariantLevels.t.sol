// SPDX-License-Identifier: AGPL-3.0
pragma solidity 0.8.24;

import {Types} from "../../contracts/math/Types.sol";
import {CurveMath} from "../../contracts/math/CurveMath.sol";
import {ILevels} from "../../contracts/math/ILevels.sol";
import {IXartIAFactory} from "../../contracts/factory/IXartIAFactory.sol";
import {InvariantBaseExt} from "./InvariantBaseExt.sol";

/// @title InvariantLevels.t.sol — T.3.01.06
/// @notice Непрерывность P(S) на границах уровней: |P(S_end_i) − P(S_start_{i+1})| < ε.
/// @dev Уровни иммутабельны после init() — invariant тривиально держится, но проверяет
///      начальную конфигурацию и защищает от регрессий в init().
contract InvariantLevelsTest is InvariantBaseExt {
    uint256 internal constant EPS = 1e6; // 1e-12 от P (в 18-dec)

    function setUp() public {
        setUpInvariantExt();
    }

    function invariant_level_continuity() public view {
        Types.Level[] memory lv = ILevels(IXartIAFactory(factory).levels()).all();
        for (uint256 i = 1; i < lv.length; i++) {
            uint256 pEndPrev = CurveMath.P(lv[i - 1].S_end, lv);
            uint256 pStartCur = lv[i].P_start;
            uint256 diff = pEndPrev > pStartCur ? pEndPrev - pStartCur : pStartCur - pEndPrev;
            assertLt(diff, EPS, "level price discontinuity");
        }
    }
}
