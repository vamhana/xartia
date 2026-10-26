// SPDX-License-Identifier: AGPL-3.0
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";

import {CurveMath} from "../../contracts/math/CurveMath.sol";
import {Types} from "../../contracts/math/Types.sol";
import {Errors} from "../../contracts/math/Errors.sol";

import {TestHelpers} from "../utils/TestHelpers.sol";

/// @title CurveMath.t.sol — T.1.01.02
/// @notice Уровни — как в config/levels.json:
///         L0: [0, 50_000e18]   P = 2e15 (flat)
///         L1: [50_000e18, 250_000e18]  P: 2e15 → 4e15
///         L2: [250_000e18, 1_250_000e18] P: 4e15 → 8e15
contract CurveMathTest is TestHelpers {
    Types.Level[] internal lv;

    function setUp() public {
        lv = defaultLevels();
    }

    // ------------------------------------------------------------------ P

    function test_P_at_zero() public view {
        assertEq(CurveMath.P(0, lv), 2e15);
    }

    function test_P_at_level_boundaries() public view {
        assertEq(CurveMath.P(50_000e18 - 1, lv), 2e15);
        assertEq(CurveMath.P(50_000e18, lv), 2e15); // граница → L1, P_start
        assertEq(CurveMath.P(250_000e18, lv), 4e15); // граница → L2, P_start
    }

    function test_P_mid_level() public view {
        assertEq(CurveMath.P(150_000e18, lv), 3e15);
        assertEq(CurveMath.P(500_000e18, lv), 5e15);
    }

    function test_P_revert_empty_levels() public {
        Types.Level[] memory empty = new Types.Level[](0);
        vm.expectRevert(Errors.InvalidLevel.selector);
        this.exposed_P(0, empty);
    }

    // ------------------------------------------------------------------ R

    function test_R_at_zero() public view {
        assertEq(CurveMath.R(0, lv), 0);
    }

    function test_R_at_level_0_end() public view {
        // R(50_000e18) = 50_000e18 * 2e15 / 1e18 = 100e18
        assertEq(CurveMath.R(50_000e18, lv), 100e18);
    }

    function test_R_mid_level_1() public view {
        // R(150_000e18) = R(L0_end) + R_i(L1, 100_000e18)
        //                = 100e18 + (2e15*100e18/1e18 + 2e15*(100e18)^2/(2*200e18*1e18))
        //                = 100e18 + (200e18 + 50e18) = 350e18
        assertEq(CurveMath.R(150_000e18, lv), 350e18);
    }

    function test_R_revert_beyond_last_level() public {
        vm.expectRevert(Errors.OutOfBounds.selector);
        this.exposed_R(1_250_000e18 + 1, lv);
    }

    // ------------------------------------------------------------------ deltaSForBuy

    function test_deltaSForBuy_simple() public view {
        // X = 1e18 (1 USDC), P = 2e15 → ΔS = X * 1e18 / P = 500e18
        assertEq(CurveMath.deltaSForBuy(0, 1e18, lv), 500e18);
    }

    function test_deltaSForBuy_zero_X() public view {
        assertEq(CurveMath.deltaSForBuy(0, 0, lv), 0);
        assertEq(CurveMath.deltaSForBuy(10_000e18, 0, lv), 0);
    }

    function test_deltaSForBuy_exact_to_level_boundary() public view {
        // X = 100e18 (100 USDC) — ровно до конца L0
        assertEq(CurveMath.deltaSForBuy(0, 100e18, lv), 50_000e18);
    }

    function test_deltaSForBuy_crosses_level() public view {
        // X = 200e18 — переходит в L1, ΔS > 50_000e18
        uint256 deltaS = CurveMath.deltaSForBuy(0, 200e18, lv);
        assertGt(deltaS, 50_000e18);
        assertLt(deltaS, 100_000e18);
        // R(ΔS) ≤ X (округление вниз)
        assertLe(CurveMath.R(deltaS, lv), 200e18);
    }

    function test_deltaSForBuy_never_overshoots() public view {
        // Свойство: R(S + ΔS) − R(S) ≤ X. Проверяем на нескольких X.
        uint256 sStart = 30_000e18;
        uint256 rStart = CurveMath.R(sStart, lv);
        for (uint256 x = 1e18; x <= 10e18; x += 1e18) {
            uint256 d = CurveMath.deltaSForBuy(sStart, x, lv);
            assertLe(CurveMath.R(sStart + d, lv) - rStart, x);
        }
    }

    // ------------------------------------------------------------------ amountForRedeem

    function test_amountForRedeem_simple() public view {
        // S = 500e18, ΔS = 500e18 → 1 USDC
        assertEq(CurveMath.amountForRedeem(500e18, 500e18, lv), 1e18);
    }

    function test_amountForRedeem_zero() public view {
        assertEq(CurveMath.amountForRedeem(500e18, 0, lv), 0);
    }

    function test_amountForRedeem_revert_deltaS_gt_S() public {
        vm.expectRevert(Errors.InvalidAmount.selector);
        this.exposed_amountForRedeem(500e18, 500e18 + 1, lv);
    }

    // ------------------------------------------------------------------ getLevel

    function test_getLevel() public view {
        assertEq(CurveMath.getLevel(0, lv), 0);
        assertEq(CurveMath.getLevel(50_000e18 - 1, lv), 0);
        assertEq(CurveMath.getLevel(50_000e18, lv), 1); // полуинтервал
        assertEq(CurveMath.getLevel(250_000e18 - 1, lv), 1);
        assertEq(CurveMath.getLevel(250_000e18, lv), 2);
        assertEq(CurveMath.getLevel(1_250_000e18, lv), 2); // последний
    }

    // ------------------------------------------------------------------ exposed (для vm.expectRevert)

    function exposed_P(uint256 S, Types.Level[] memory levels) external pure returns (uint256) {
        return CurveMath.P(S, levels);
    }

    function exposed_R(uint256 S, Types.Level[] memory levels) external pure returns (uint256) {
        return CurveMath.R(S, levels);
    }

    function exposed_amountForRedeem(uint256 S, uint256 dS, Types.Level[] memory levels)
        external
        pure
        returns (uint256)
    {
        return CurveMath.amountForRedeem(S, dS, levels);
    }
}
