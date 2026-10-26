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

/// @title SlippageDeadline.t.sol — T.5.01.15
contract SlippageDeadlineTest is TestHelpers {
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
        mintUSDC(reserveMgr, 10_000_000e6); // disable CB
    }

    function test_slippage_buyFromCurve() public {
        vm.prank(user);
        vm.expectRevert(Errors.SlippageExceeded.selector);
        ICurveController(curveCtrl).buyFromCurve(1000e6, type(uint256).max, 0);
    }

    function test_slippage_redeemFromCurve() public {
        vm.prank(user);
        uint256 tokens = ICurveController(curveCtrl).buyFromCurve(1000e6, 0, 0);
        warpBy(1);

        vm.prank(user);
        vm.expectRevert(Errors.SlippageExceeded.selector);
        ICurveController(curveCtrl).redeemFromCurve(tokens, type(uint256).max, 0);
    }

    function test_slippage_buyFromPool() public {
        vm.prank(user);
        vm.expectRevert(Errors.SlippageExceeded.selector);
        IPoolController(poolCtrl).buyFromPool(1000e6, type(uint256).max, 0);
    }

    function test_slippage_sellToPool() public {
        vm.prank(user);
        ICurveController(curveCtrl).buyFromCurve(1000e6, 0, 0);
        warpBy(1);
        uint256 bal = IXartIAToken(token).balanceOf(user);

        vm.prank(user);
        vm.expectRevert(Errors.SlippageExceeded.selector);
        IPoolController(poolCtrl).sellToPool(bal / 50, type(uint256).max, 0);
    }

    function test_deadline_zero_means_no_limit() public {
        vm.prank(user);
        ICurveController(curveCtrl).buyFromCurve(1000e6, 0, 0);
    }

    function test_deadline_expired() public {
        vm.warp(1000);
        uint256 past = block.timestamp - 1;
        vm.prank(user);
        vm.expectRevert(Errors.DeadlineExpired.selector);
        ICurveController(curveCtrl).buyFromCurve(1000e6, 0, past);
    }

    function test_minOut_zero_means_no_slippage() public {
        // minOut = 0 — проверка пропускается
        vm.prank(user);
        ICurveController(curveCtrl).buyFromCurve(1000e6, 0, 0);
    }
}
