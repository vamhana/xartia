// SPDX-License-Identifier: AGPL-3.0
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";

import {PrecisionLib} from "../../contracts/libraries/PrecisionLib.sol";

/// @title PrecisionLib.t.sol — T.1.01.15
contract PrecisionLibTest is Test {
    function test_toUSDC() public pure {
        assertEq(PrecisionLib.toUSDC(1e18), 1e6);
        assertEq(PrecisionLib.toUSDC(1e12), 1);
        assertEq(PrecisionLib.toUSDC(1e6), 0); // 1e6 wei = 1e-12 USDC, округление вниз
    }

    function test_fromUSDC() public pure {
        assertEq(PrecisionLib.fromUSDC(1e6), 1e18);
        assertEq(PrecisionLib.fromUSDC(1), 1e12);
    }

    function test_toWei_equals_fromUSDC() public pure {
        assertEq(PrecisionLib.toWei(1e6), PrecisionLib.fromUSDC(1e6));
        assertEq(PrecisionLib.toWei(1), 1e12);
    }

    function test_fromWei_equals_toUSDC() public pure {
        assertEq(PrecisionLib.fromWei(1e18), PrecisionLib.toUSDC(1e18));
    }

    function test_precision_loss() public pure {
        // < 1 wei-6 округляется вниз
        assertEq(PrecisionLib.toUSDC(1e12 - 1), 0);
        // Round-trip теряет младшие биты
        uint256 amount = 1e12 - 1;
        assertEq(PrecisionLib.fromUSDC(PrecisionLib.toUSDC(amount)), 0);
    }

    function test_roundtrip_exact() public pure {
        // Мультипликативные значения проходят без потерь
        uint256 amount_6 = 1_000_000e6; // 1e12 — 1M USDC в 6-dec
        assertEq(PrecisionLib.toUSDC(PrecisionLib.fromUSDC(amount_6)), amount_6);
    }
}
