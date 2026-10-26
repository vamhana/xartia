// SPDX-License-Identifier: AGPL-3.0
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";

import {MathLib} from "../../contracts/libraries/MathLib.sol";

/// @title MathLib.t.sol — T.1.01.14
contract MathLibTest is Test {
    function test_mulDiv() public pure {
        assertEq(MathLib.mulDiv(10, 20, 5), 40);
        assertEq(MathLib.mulDiv(10, 20, 3), 66); // 66.67 → 66 (вниз)
        assertEq(MathLib.mulDiv(0, 20, 5), 0);
        assertEq(MathLib.mulDiv(10, 0, 5), 0);
    }

    function test_mulDiv_overflow_safe() public pure {
        // 512-bit промежуточное значение не переполняет uint256
        assertEq(MathLib.mulDiv(type(uint256).max, 2, 2), type(uint256).max);
        assertEq(MathLib.mulDiv(type(uint256).max, 10, 10), type(uint256).max);
    }

    function test_mulDivUp() public pure {
        assertEq(MathLib.mulDivUp(10, 20, 5), 40);
        assertEq(MathLib.mulDivUp(10, 20, 3), 67); // ceil(66.67)
        assertEq(MathLib.mulDivUp(1, 1, 2), 1);
        assertEq(MathLib.mulDivUp(0, 20, 5), 0);
    }

    function test_sqrt() public pure {
        assertEq(MathLib.sqrt(0), 0);
        assertEq(MathLib.sqrt(1), 1);
        assertEq(MathLib.sqrt(4), 2);
        assertEq(MathLib.sqrt(9), 3);
        assertEq(MathLib.sqrt(10), 3); // floor
        assertEq(MathLib.sqrt(15), 3);
        assertEq(MathLib.sqrt(16), 4);
        assertEq(MathLib.sqrt(1e36), 1e18);
        assertEq(MathLib.sqrt(1e18), 1e9);
    }

    function test_min_max() public pure {
        assertEq(MathLib.min(3, 5), 3);
        assertEq(MathLib.min(5, 3), 3);
        assertEq(MathLib.min(3, 3), 3);
        assertEq(MathLib.max(3, 5), 5);
        assertEq(MathLib.max(5, 3), 5);
        assertEq(MathLib.max(3, 3), 3);
    }

    function test_abs() public pure {
        assertEq(MathLib.abs(0), 0);
        assertEq(MathLib.abs(5), 5);
        assertEq(MathLib.abs(-5), 5);
    }
}
