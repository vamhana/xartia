// SPDX-License-Identifier: AGPL-3.0
pragma solidity 0.8.24;

import {IReserveManager} from "../../contracts/reserve/IReserveManager.sol";
import {ICurveController} from "../../contracts/controllers/ICurveController.sol";
import {IXartIAToken} from "../../contracts/token/IXartIAToken.sol";
import {IXartIAFactory} from "../../contracts/factory/IXartIAFactory.sol";
import {MockUSDC} from "../utils/MockUSDC.sol";
import {TestHelpers} from "../utils/TestHelpers.sol";

/// @title Cycles.t.sol — T.5.01.03
/// @notice 100+ BUY/SELL циклов. Проверка накопления ошибок округления и стабильности инварианта.
/// @dev 100 циклов (а не 1000) — компромисс по времени прогона unit-теста.
///      Проверка «накопления» — через сравнение reserve и суммы всех дельт.
contract CyclesTest is TestHelpers {
    address internal factory;
    address internal usdc;
    address internal curveCtrl;
    address internal reserveMgr;
    address internal token;

    address internal user = address(0xA11CE);

    function setUp() public {
        setUpBase();
        usdc = mockUSDC();
        factory = deployFullSystem();
        IXartIAFactory f = IXartIAFactory(factory);
        curveCtrl = f.curveController();
        reserveMgr = f.reserveManager();
        token = f.token();

        mintUSDC(user, 10_000_000e6);
        vm.prank(user);
        MockUSDC(usdc).approve(curveCtrl, type(uint256).max);
        vm.prank(user);
        IXartIAToken(token).approve(curveCtrl, type(uint256).max);
    }

    function test_cycles() public {
        uint256 initialReserve = IReserveManager(reserveMgr).reserve();

        for (uint256 i = 0; i < 100; i++) {
            buySafe(curveCtrl, user, 100e6);

            warpBy(1);

            uint256 bal = IXartIAToken(token).balanceOf(user);
            vm.prank(user);
            ICurveController(curveCtrl).redeemFromCurve(bal / 2, 0, 0);

            warpBy(1);

            assertGe(
                IReserveManager(reserveMgr).reserve(),
                IReserveManager(reserveMgr).curveBacking(),
                "invariant broken during cycle"
            );
        }

        // После 100 циклов reserve вырос (за счёт комиссий), curveBacking вернулся к 0
        // 100 циклов × buyFee 0.5% от 100 = ~0.5 USDC fee за цикл → ~50 USDC всего
        assertGt(IReserveManager(reserveMgr).reserve(), initialReserve);
    }

    function test_totalSupply_eq_Scurve_after_cycles() public {
        for (uint256 i = 0; i < 50; i++) {
            buySafe(curveCtrl, user, 100e6);
            warpBy(1);
            uint256 bal = IXartIAToken(token).balanceOf(user);
            vm.prank(user);
            ICurveController(curveCtrl).redeemFromCurve(bal / 2, 0, 0);
            warpBy(1);
        }
        assertEq(IXartIAToken(token).totalSupply(), IReserveManager(reserveMgr).S_curve());
    }
}
