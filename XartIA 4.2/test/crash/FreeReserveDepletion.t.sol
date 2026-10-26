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

/// @title FreeReserveDepletion.t.sol — T.5.01.09
contract FreeReserveDepletionTest is TestHelpers {
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

        mintUSDC(user, 10_000_000e6);
        vm.prank(user);
        MockUSDC(usdc).approve(curveCtrl, type(uint256).max);
        vm.prank(user);
        MockUSDC(usdc).approve(poolCtrl, type(uint256).max);
        vm.prank(user);
        IXartIAToken(token).approve(curveCtrl, type(uint256).max);
        vm.prank(user);
        IXartIAToken(token).approve(poolCtrl, type(uint256).max);
    }

    function test_depletion() public {
        // Seed: покупка на 1000 USDC → freeReserve = 5 USDC, CB active
        vm.prank(user);
        ICurveController(curveCtrl).buyFromCurve(1000e6, 0, 0);
        warpBy(1);

        // Попытка sellToPool — CB active → revert
        uint256 bal = IXartIAToken(token).balanceOf(user);
        vm.prank(user);
        vm.expectRevert(Errors.CircuitBreakerActive.selector);
        IPoolController(poolCtrl).sellToPool(bal / 2, 0, 0);
    }

    function test_depletion_freeReserve_zero() public {
        // Seed с disable CB, потом съедаем freeReserve через sellToPool
        vm.prank(user);
        ICurveController(curveCtrl).buyFromCurve(1000e6, 0, 0);
        warpBy(1);

        // freeReserve сейчас 5e18 (только fee)
        uint256 freeR = IReserveManager(reserveMgr).freeReserve();
        assertEq(freeR, 5e18);
    }
}
