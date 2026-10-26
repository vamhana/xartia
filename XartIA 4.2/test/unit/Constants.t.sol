// SPDX-License-Identifier: AGPL-3.0
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";

import {Constants} from "../../contracts/math/Constants.sol";

/// @title Constants.t.sol — T.1.01.10
/// @notice Проверка значений и immutability констант.
contract ConstantsTest is Test {
    function test_values() public pure {
        assertEq(Constants.PRECISION, 1e18);
        assertEq(Constants.USDC_PRECISION, 1e6);
        assertEq(Constants.BASIS_POINTS, 10_000);
        assertEq(Constants.MAX_LEVELS, 10);
        assertEq(Constants.TEAM_PERCENT, 50);
        assertEq(Constants.MAX_GAP, 1000);
        assertEq(Constants.MAX_SOLD_PCT, 100);
        assertEq(Constants.K, 15_000);
        assertEq(Constants.MAX_CURVE_FOR_PCT, 2000);
        assertEq(Constants.TIMELOCK_DELAY, 7 days);
    }

    function test_param_ids_distinct() public pure {
        bytes32[9] memory ids = [
            Constants.PARAM_BUY_FEE,
            Constants.PARAM_REDEEM_FEE,
            Constants.PARAM_EARLY_SELL_FEE,
            Constants.PARAM_EARLY_SELL_PERIOD,
            Constants.PARAM_MAX_PURCHASE_PCT,
            Constants.PARAM_MINIMAL_PURCHASE,
            Constants.PARAM_MAX_SELL_PCT_PER_DAY,
            Constants.PARAM_CIRCUIT_BREAKER_THRESHOLD,
            Constants.PARAM_SELL_TEAM_FEE
        ];
        for (uint256 i = 0; i < ids.length; i++) {
            assertTrue(ids[i] != bytes32(0), "param id is zero");
            for (uint256 j = i + 1; j < ids.length; j++) {
                assertTrue(ids[i] != ids[j], "duplicate param id");
            }
        }
    }
}
