// SPDX-License-Identifier: AGPL-3.0
pragma solidity 0.8.24;
import {Errors} from "../../contracts/math/Errors.sol";

import {Types} from "../../contracts/math/Types.sol";
import {CurveMath} from "../../contracts/math/CurveMath.sol";
import {ILevels} from "../../contracts/math/ILevels.sol";
import {IReserveManager} from "../../contracts/reserve/IReserveManager.sol";
import {ICurveController} from "../../contracts/controllers/ICurveController.sol";
import {IXartIAToken} from "../../contracts/token/IXartIAToken.sol";
import {IXartIAFactory} from "../../contracts/factory/IXartIAFactory.sol";
import {MockUSDC} from "../utils/MockUSDC.sol";
import {TestHelpers} from "../utils/TestHelpers.sol";

/// @title LevelTransition.t.sol — T.4.01.02
contract LevelTransitionTest is TestHelpers {
    address internal factory;
    address internal usdc;
    address internal curveCtrl;
    address internal reserveMgr;
    address internal levelsAddr;
    address internal token;

    address internal user = address(0xA11CE);

    function setUp() public {
        setUpBase();
        usdc = mockUSDC();
        factory = deployFullSystem();
        IXartIAFactory f = IXartIAFactory(factory);
        curveCtrl = f.curveController();
        reserveMgr = f.reserveManager();
        levelsAddr = f.levels();
        token = f.token();

        mintUSDC(user, 10_000_000_000_000e6); // очень много USDC для L2→L3
        vm.prank(user);
        MockUSDC(usdc).approve(curveCtrl, type(uint256).max);
        vm.prank(user);
        IXartIAToken(token).approve(curveCtrl, type(uint256).max);
        mintUSDC(reserveMgr, 100_000_000_000e6);
    }

    function test_levelTransition_0_to_1() public {
        _checkTransition(50_000e18);
    }

    function test_levelTransition_1_to_2() public {
        _checkTransition(250_000e18);
    }

    /// @notice Уровня 3 нет: таблица состоит из 3 уровней (0..1.25M).
    ///         Покупка за последней границей должна ревертить OutOfBounds.
    function test_beyond_last_level_reverts() public {
        vm.prank(user);
        vm.expectRevert(Errors.OutOfBounds.selector);
        ICurveController(curveCtrl).buyFromCurve(1_000_000e6, 0, 0);
    }

    // ------------------------------------------------------------------ internal

    function _checkTransition(uint256 boundaryS) internal {
        uint256 sBefore = IReserveManager(reserveMgr).S_curve();
        if (sBefore >= boundaryS) return;

        // Приближаемся к 99.9% границы
        uint256 rTarget = _R(boundaryS * 999 / 1000);
        uint256 rCurrent = _R(sBefore);
        uint256 rNeeded = rTarget > rCurrent ? rTarget - rCurrent : 0;
        if (rNeeded > 0) {
            uint256 x18 = (rNeeded * 10_000) / 9_950;
            if (x18 / 1e12 < 1_100_000) x18 = 1_100_000 * 1e12; // минимум с комиссией
            vm.prank(user);
            ICurveController(curveCtrl).buyFromCurve(x18 / 1e12, 0, 0);
        }

        uint256 s1 = IReserveManager(reserveMgr).S_curve();
        assertLt(s1, boundaryS, "not below boundary");
        uint256 p1 = _calcP(s1);

        // Пересекаем границу (+0.2% от boundary)
        uint256 rAfter = _R(boundaryS + boundaryS / 500);
        uint256 rS1 = _R(s1);
        uint256 x18Next = ((rAfter - rS1) * 10_000) / 9_950;
        if (x18Next / 1e12 < 1_100_000) x18Next = 1_100_000 * 1e12;
        vm.prank(user);
        ICurveController(curveCtrl).buyFromCurve(x18Next / 1e12, 0, 0);

        uint256 s2 = IReserveManager(reserveMgr).S_curve();
        assertGt(s2, boundaryS, "did not cross boundary");
        uint256 p2 = _calcP(s2);

        // P(S) непрерывна на границе: разница пропорциональна ΔS, а не скачок
        uint256 diff = p2 > p1 ? p2 - p1 : p1 - p2;
        assertLt(diff, 1e15, "P discontinuity at boundary"); // 1e15 = 0.001 USDC/XRT

        // Инвариант
        assertGe(IReserveManager(reserveMgr).reserve(), IReserveManager(reserveMgr).curveBacking());
    }

    function _R(uint256 S) internal view returns (uint256) {
        Types.Level[] memory lv = ILevels(levelsAddr).all();
        return CurveMath.R(S, lv);
    }

    function _calcP(uint256 S) internal view returns (uint256) {
        Types.Level[] memory lv = ILevels(levelsAddr).all();
        return CurveMath.P(S, lv);
    }
}
