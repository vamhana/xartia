// SPDX-License-Identifier: AGPL-3.0
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";

import {LevelMath} from "../../contracts/math/LevelMath.sol";
import {Types} from "../../contracts/math/Types.sol";

/// @title LevelMath.t.sol — T.1.01.09
/// @notice Уровень [0, 100e18] с P от 1e18 до 2e18. Slope = 1e16/token.
contract LevelMathTest is Test {
    Types.Level internal L0;
    Types.Level internal Lb;

    function setUp() public {
        // Рабочий уровень: S=[0, 100e18], P=[1e18, 2e18]
        L0 = Types.Level({S_start: 0, S_end: 100e18, P_start: 1e18, P_end: 2e18, maxBalance: 100e18});
        // Уровень для проверки b(): S_end=1e18, deltaP=1e18 → b = 1
        Lb = Types.Level({S_start: 0, S_end: 1e18, P_start: 1e18, P_end: 2e18, maxBalance: 1e18});
    }

    function test_a() public view {
        assertEq(LevelMath.a(L0), 1e18);
        assertEq(LevelMath.a(Lb), 1e18);
    }

    function test_b() public view {
        // (P_end - P_start) / (S_end - S_start) = 1e18 / 1e18 = 1
        assertEq(LevelMath.b(Lb), 1);
        // L0: 1e18 / 100e18 = 0 (целочисленное деление)
        assertEq(LevelMath.b(L0), 0);
    }

    function test_P_i_at_start() public view {
        assertEq(LevelMath.P_i(0, L0), 1e18);
        assertEq(LevelMath.P_i(0, Lb), 1e18);
    }

    function test_P_i_at_end() public view {
        assertEq(LevelMath.P_i(100e18, L0), 2e18);
        assertEq(LevelMath.P_i(1e18, Lb), 2e18);
        // S > S_end — клампится к P_end
        assertEq(LevelMath.P_i(200e18, L0), 2e18);
    }

    function test_P_i_mid() public view {
        // 50% длины → средняя цена
        assertEq(LevelMath.P_i(50e18, L0), 1.5e18);
        assertEq(LevelMath.P_i(25e18, L0), 1.25e18);
    }

    function test_P_i_before_start() public view {
        // S < S_start — клампится к P_start
        Types.Level memory shifted =
            Types.Level({S_start: 10e18, S_end: 20e18, P_start: 1e18, P_end: 2e18, maxBalance: 10e18});
        assertEq(LevelMath.P_i(5e18, shifted), 1e18);
    }

    function test_R_i_at_start() public pure {
        Types.Level memory l = Types.Level(0, 100e18, 1e18, 2e18, 100e18);
        assertEq(LevelMath.R_i(0, l), 0);
    }

    function test_R_i_at_end() public pure {
        // Площадь трапеции: (P_start + P_end)/2 * D = 1.5e18 * 100e18 = 150e18
        Types.Level memory l = Types.Level(0, 100e18, 1e18, 2e18, 100e18);
        assertEq(LevelMath.R_i(100e18, l), 150e18);
    }

    function test_R_i_mid() public pure {
        // R_i(50e18): linearPart = 1e18 * 50e18 / 1e18 = 50e18
        //             quadPart = 1e18 * (50e18)^2 / (2*100e18*1e18) = 12.5e18
        //             sum = 62.5e18
        Types.Level memory l = Types.Level(0, 100e18, 1e18, 2e18, 100e18);
        assertEq(LevelMath.R_i(50e18, l), 62.5e18);
    }

    function test_R_i_clamped() public pure {
        Types.Level memory l = Types.Level(0, 100e18, 1e18, 2e18, 100e18);
        assertEq(LevelMath.R_i(200e18, l), 150e18);
        assertEq(LevelMath.R_i(0, l), 0);
    }

    function test_R_i_constant_price() public pure {
        // P_start == P_end: R_i(d) = P * d / 1e18
        Types.Level memory l = Types.Level(0, 1000e18, 2e15, 2e15, 1000e18);
        assertEq(LevelMath.R_i(500e18, l), 1e18); // 500 * 0.002 = 1 USDC
        assertEq(LevelMath.R_i(1000e18, l), 2e18);
    }

    function test_inBounds() public pure {
        Types.Level memory l = Types.Level(10e18, 20e18, 1e18, 2e18, 10e18);
        assertFalse(LevelMath.inBounds(0, l));
        assertFalse(LevelMath.inBounds(10e18 - 1, l));
        assertTrue(LevelMath.inBounds(10e18, l)); // S_start включён
        assertTrue(LevelMath.inBounds(15e18, l));
        assertTrue(LevelMath.inBounds(20e18 - 1, l));
        assertFalse(LevelMath.inBounds(20e18, l)); // S_end исключён (полуинтервал)
        assertFalse(LevelMath.inBounds(25e18, l));
    }
}
