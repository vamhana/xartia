// SPDX-License-Identifier: AGPL-3.0
pragma solidity 0.8.24;

import {Errors} from "../../contracts/math/Errors.sol";
import {ICurveController} from "../../contracts/controllers/ICurveController.sol";
import {IPoolController} from "../../contracts/controllers/IPoolController.sol";
import {IXartIAToken} from "../../contracts/token/IXartIAToken.sol";
import {IXartIAFactory} from "../../contracts/factory/IXartIAFactory.sol";
import {MockUSDC} from "../utils/MockUSDC.sol";
import {TestHelpers} from "../utils/TestHelpers.sol";

/// @title MinimalPurchase.t.sol — T.5.01.07
contract MinimalPurchaseTest is TestHelpers {
    address internal factory;
    address internal usdc;
    address internal curveCtrl;
    address internal poolCtrl;

    address internal user = address(0xA11CE);

    function setUp() public {
        setUpBase();
        usdc = mockUSDC();
        factory = deployFullSystem();
        IXartIAFactory f = IXartIAFactory(factory);
        curveCtrl = f.curveController();
        poolCtrl = f.poolController();

        mintUSDC(user, 10_000_000e6);
        vm.prank(user);
        MockUSDC(usdc).approve(curveCtrl, type(uint256).max);
        vm.prank(user);
        MockUSDC(usdc).approve(poolCtrl, type(uint256).max);
    }

    function test_minimalPurchase_curve() public {
        // minimalPurchase = 1e6 (1 USDC). effective = ceil(1e6 * 10000 / 9950) = 1_005_026
        vm.prank(user);
        vm.expectRevert(Errors.MinimalPurchaseNotMet.selector);
        ICurveController(curveCtrl).buyFromCurve(1_005_025, 0, 0);

        vm.prank(user);
        ICurveController(curveCtrl).buyFromCurve(1_005_026, 0, 0);
    }

    function test_minimalPurchase_pool() public {
        vm.prank(user);
        vm.expectRevert(Errors.MinimalPurchaseNotMet.selector);
        IPoolController(poolCtrl).buyFromPool(1_000_000, 0, 0);
    }
}
