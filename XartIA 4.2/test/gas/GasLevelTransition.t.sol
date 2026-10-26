// SPDX-License-Identifier: AGPL-3.0
pragma solidity 0.8.24;

import {Types} from "../../contracts/math/Types.sol";
import {CurveMath} from "../../contracts/math/CurveMath.sol";
import {ILevels} from "../../contracts/math/ILevels.sol";
import {IReserveManager} from "../../contracts/reserve/IReserveManager.sol";
import {ICurveController} from "../../contracts/controllers/ICurveController.sol";
import {IXartIAToken} from "../../contracts/token/IXartIAToken.sol";
import {IXartIAFactory} from "../../contracts/factory/IXartIAFactory.sol";
import {MockUSDC} from "../utils/MockUSDC.sol";
import {TestHelpers} from "../utils/TestHelpers.sol";

/// @title GasLevelTransition.t.sol — T.6.01.05
contract GasLevelTransitionTest is TestHelpers {
    address internal factory;
    address internal usdc;
    address internal curveCtrl;
    address internal reserveMgr;
    address internal levelsAddr;
    address internal token;

    address internal user = address(0xA11CE);

    uint256 internal constant GAS_LIMIT = 350_000; // via_ir

    function setUp() public {
        setUpBase();
        usdc = mockUSDC();
        factory = deployFullSystem();
        IXartIAFactory f = IXartIAFactory(factory);
        curveCtrl = f.curveController();
        reserveMgr = f.reserveManager();
        levelsAddr = f.levels();
        token = f.token();

        mintUSDC(user, 10_000_000_000e6);
        vm.prank(user);
        MockUSDC(usdc).approve(curveCtrl, type(uint256).max);
        vm.prank(user);
        IXartIAToken(token).approve(curveCtrl, type(uint256).max);
        mintUSDC(reserveMgr, 100_000_000e6);

        // Seed: приближаемся к 99.9% границы L0/L1
        uint256 sBoundary = 50_000e18;
        uint256 rTarget = _R(sBoundary * 999 / 1000);
        uint256 x18 = (rTarget * 10_000) / 9_950;
        if (x18 / 1e12 < 1_100_000) x18 = 1_100_000 * 1e12;
        vm.prank(user);
        ICurveController(curveCtrl).buyFromCurve(x18 / 1e12, 0, 0);
        warpBy(1);
    }

    function test_gas_transition() public {
        uint256 sBefore = IReserveManager(reserveMgr).S_curve();
        uint256 sTarget = 50_000e18 + 100e18;
        uint256 rTarget = _R(sTarget);
        uint256 rCurrent = _R(sBefore);
        uint256 x18 = ((rTarget - rCurrent) * 10_000) / 9_950;
        if (x18 / 1e12 < 1_100_000) x18 = 1_100_000 * 1e12;

        vm.prank(user);
        uint256 gasBefore = gasleft();
        ICurveController(curveCtrl).buyFromCurve(x18 / 1e12, 0, 0);
        uint256 gasUsed = gasBefore - gasleft();

        assertGt(IReserveManager(reserveMgr).S_curve(), 50_000e18, "boundary not crossed");

        emit log_named_uint("gas level transition", gasUsed);
        assertLe(gasUsed, GAS_LIMIT, "level transition exceeds 350k gas");
    }

    // ------------------------------------------------------------------ internal

    function _R(uint256 S) internal view returns (uint256) {
        Types.Level[] memory lv = ILevels(levelsAddr).all();
        return CurveMath.R(S, lv);
    }
}
