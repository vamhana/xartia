// SPDX-License-Identifier: AGPL-3.0
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";

import {Types} from "../../contracts/math/Types.sol";
import {Levels} from "../../contracts/math/Levels.sol";
import {CurveMath} from "../../contracts/math/CurveMath.sol";
import {MathLib} from "../../contracts/libraries/MathLib.sol";

/// @title FuzzLevels.t.sol — T.2.01.03
contract FuzzLevelsTest is Test {
    Levels internal levels;
    Types.Level[] internal lvArr;

    function setUp() public {
        levels = new Levels();
        lvArr = new Types.Level[](3);
        lvArr[0] = Types.Level(0, 50_000e18, 2e15, 2e15, 50_000e18);
        lvArr[1] = Types.Level(50_000e18, 250_000e18, 2e15, 4e15, 250_000e18);
        lvArr[2] = Types.Level(250_000e18, 1_250_000e18, 4e15, 8e15, 1_250_000e18);
        levels.init(lvArr);
    }

    /// @notice Непрерывность: P(S) монотонно неубывающая на всей области.
    function testFuzz_boundaries(uint256 s1, uint256 s2) public view {
        s1 = bound(s1, 0, 1_250_000e18);
        s2 = bound(s2, 0, 1_250_000e18);
        if (s1 > s2) (s1, s2) = (s2, s1);

        uint256 p1 = CurveMath.P(s1, lvArr);
        uint256 p2 = CurveMath.P(s2, lvArr);
        assertLe(p1, p2, "P not monotonic");
    }

    /// @notice R(S) монотонно неубывающая.
    function testFuzz_R_monotonic(uint256 s1, uint256 s2) public view {
        s1 = bound(s1, 0, 1_250_000e18);
        s2 = bound(s2, 0, 1_250_000e18);
        if (s1 > s2) (s1, s2) = (s2, s1);

        uint256 r1 = CurveMath.R(s1, lvArr);
        uint256 r2 = CurveMath.R(s2, lvArr);
        assertLe(r1, r2, "R not monotonic");
    }

    /// @notice getLevel(S) соответствует границам.
    function testFuzz_getLevel(uint256 S) public view {
        S = bound(S, 0, 1_250_000e18);
        uint8 idx = CurveMath.getLevel(S, lvArr);

        (uint256 sStart, uint256 sEnd) = levels.getBounds(idx);
        assertGe(S, sStart);
        if (S < 1_250_000e18) {
            assertLt(S, sEnd);
        } else {
            assertLe(S, sEnd);
        }
    }
}
