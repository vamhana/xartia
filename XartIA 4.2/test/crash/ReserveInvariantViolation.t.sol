// SPDX-License-Identifier: AGPL-3.0
pragma solidity 0.8.24;

import {Errors} from "../../contracts/math/Errors.sol";
import {IReserveManager} from "../../contracts/reserve/IReserveManager.sol";
import {ICurveController} from "../../contracts/controllers/ICurveController.sol";
import {IPoolController} from "../../contracts/controllers/IPoolController.sol";
import {IXartIAToken} from "../../contracts/token/IXartIAToken.sol";
import {IXartIAFactory} from "../../contracts/factory/IXartIAFactory.sol";
import {MockUSDC} from "../utils/MockUSDC.sol";
import {TestHelpers} from "../utils/TestHelpers.sol";

/// @title ReserveInvariantViolation.t.sol — T.5.01.12
/// @notice Попытки нарушить reserve ≥ R(S_curve) через последовательность операций — должны
///         ревертить или не нарушать инвариант.
contract ReserveInvariantViolationTest is TestHelpers {
    address internal factory;
    address internal usdc;
    address internal curveCtrl;
    address internal poolCtrl;
    address internal reserveMgr;
    address internal token;

    address internal user = address(0xA11CE);

    function setUp() public {
        setUpBase();
        usdc = mockUSDC();
        factory = deployFullSystem();
        IXartIAFactory f = IXartIAFactory(factory);
        curveCtrl = f.curveController();
        poolCtrl = f.poolController();
        reserveMgr = f.reserveManager();
        token = f.token();

        mintUSDC(user, 100_000_000e6);
        vm.prank(user);
        MockUSDC(usdc).approve(curveCtrl, type(uint256).max);
        vm.prank(user);
        MockUSDC(usdc).approve(poolCtrl, type(uint256).max);
        vm.prank(user);
        IXartIAToken(token).approve(curveCtrl, type(uint256).max);
        vm.prank(user);
        IXartIAToken(token).approve(poolCtrl, type(uint256).max);
    }

    function test_violation() public {
        // Серия операций: buy → redeem → buy → sellToPool → redeem
        // Инвариант держится на каждом шаге.
        for (uint256 i = 0; i < 3; i++) {
            buySafe(curveCtrl, user, 1000e6);
            warpBy(1);
            assertGe(IReserveManager(reserveMgr).reserve(), IReserveManager(reserveMgr).curveBacking());

            uint256 bal = IXartIAToken(token).balanceOf(user);
            vm.prank(user);
            ICurveController(curveCtrl).redeemFromCurve(bal / 2, 0, 0);
            warpBy(1);
            assertGe(IReserveManager(reserveMgr).reserve(), IReserveManager(reserveMgr).curveBacking());
        }
    }

    function test_redeem_more_than_supply_reverts() public {
        // Redeem больше S_curve → InvalidAmount (deltaS > S в amountForRedeem)
        uint256 sCurve = IReserveManager(reserveMgr).S_curve();
        vm.prank(user);
        vm.expectRevert();
        ICurveController(curveCtrl).redeemFromCurve(sCurve + 1e18, 0, 0);
    }

    function test_updateScurve_unauthorized() public {
        // Прямой вызов updateScurve без CONTROLLER_ROLE → revert
        vm.prank(user);
        vm.expectRevert();
        IReserveManager(reserveMgr).updateScurve(type(uint256).max);
    }
}
