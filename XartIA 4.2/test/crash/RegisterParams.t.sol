// SPDX-License-Identifier: AGPL-3.0
pragma solidity 0.8.24;

import {Errors} from "../../contracts/math/Errors.sol";
import {Constants} from "../../contracts/math/Constants.sol";
import {IParameterRegistry} from "../../contracts/core/IParameterRegistry.sol";
import {IXartIAFactory} from "../../contracts/factory/IXartIAFactory.sol";
import {XartIAFactory} from "../../contracts/factory/XartIAFactory.sol";
import {TestHelpers} from "../utils/TestHelpers.sol";

/// @title RegisterParams.t.sol — T.5.01.17
contract RegisterParamsTest is TestHelpers {
    XartIAFactory internal f;
    address internal safe;
    address internal treasury;
    address internal usdc;

    function setUp() public {
        setUpBase();
        safe = mockSafe();
        treasury = mockTreasury();
        usdc = mockUSDC();
        f = new XartIAFactory();
        f.deploy(safe, treasury, 1000, usdc);
        f.initializeLevels(defaultLevels());
        f.initializePoolPrice(P0_INITIAL);
        f.registerParams();
    }

    function test_register_all() public view {
        IParameterRegistry r = IParameterRegistry(f.registry());
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
            assertTrue(r.get(ids[i]).exists, "param not registered");
        }
    }

    function test_bounds() public view {
        IParameterRegistry r = IParameterRegistry(f.registry());

        assertEq(r.get(Constants.PARAM_BUY_FEE).min, 0);
        assertEq(r.get(Constants.PARAM_BUY_FEE).max, 200);

        assertEq(r.get(Constants.PARAM_REDEEM_FEE).min, 0);
        assertEq(r.get(Constants.PARAM_REDEEM_FEE).max, 200);

        assertEq(r.get(Constants.PARAM_EARLY_SELL_FEE).min, 0);
        assertEq(r.get(Constants.PARAM_EARLY_SELL_FEE).max, 500);

        assertEq(r.get(Constants.PARAM_EARLY_SELL_PERIOD).min, 0);
        assertEq(r.get(Constants.PARAM_EARLY_SELL_PERIOD).max, 7_776_000);

        assertEq(r.get(Constants.PARAM_MAX_PURCHASE_PCT).min, 0);
        assertEq(r.get(Constants.PARAM_MAX_PURCHASE_PCT).max, 1000);

        assertEq(r.get(Constants.PARAM_MINIMAL_PURCHASE).min, 1e6);
        assertEq(r.get(Constants.PARAM_MINIMAL_PURCHASE).max, 1e12);

        assertEq(r.get(Constants.PARAM_MAX_SELL_PCT_PER_DAY).min, 0);
        assertEq(r.get(Constants.PARAM_MAX_SELL_PCT_PER_DAY).max, 500);

        assertEq(r.get(Constants.PARAM_CIRCUIT_BREAKER_THRESHOLD).min, 500);
        assertEq(r.get(Constants.PARAM_CIRCUIT_BREAKER_THRESHOLD).max, 2000);

        assertEq(r.get(Constants.PARAM_SELL_TEAM_FEE).min, 0);
        assertEq(r.get(Constants.PARAM_SELL_TEAM_FEE).max, 50);
    }

    function test_revert_duplicate() public {
        // Повторный registerParams — AlreadyInitialized
        vm.expectRevert(Errors.AlreadyInitialized.selector);
        f.registerParams();
    }
}
