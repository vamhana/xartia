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

/// @title ZeroScurve.t.sol — T.5.01.14
contract ZeroScurveTest is TestHelpers {
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

    function test_buyFromCurve_zero() public {
        assertEq(IReserveManager(reserveMgr).S_curve(), 0);
        vm.prank(user);
        uint256 tokens = ICurveController(curveCtrl).buyFromCurve(1000e6, 0, 0);
        assertGt(tokens, 0);
        assertGt(IReserveManager(reserveMgr).S_curve(), 0);
    }

    function test_buyFromCurve_zero_no_maxPct() public {
        // maxPurchasePct = 500 (5%). При S=0 лимит не применяется.
        // 100k USDC даёт ΔS ≈ 49_750_000 XRT — это > 5% от 0 (но 0% = 0, любая покупка больше).
        // Проверяем, что покупка проходит.
        vm.prank(user);
        uint256 tokens = ICurveController(curveCtrl).buyFromCurve(5_000e6, 0, 0);
        assertGt(tokens, 500_000e18);
    }

    function test_buyFromCurve_zero_minimalPurchase() public {
        // minimalPurchase всё равно применяется
        vm.prank(user);
        vm.expectRevert(Errors.MinimalPurchaseNotMet.selector);
        ICurveController(curveCtrl).buyFromCurve(1, 0, 0);

        vm.prank(user);
        ICurveController(curveCtrl).buyFromCurve(1_005_026, 0, 0);
    }

    function test_redeemFromCurve_zero() public {
        // Redeem при S=0: deltaS > 0 > S → revert
        vm.prank(user);
        vm.expectRevert();
        ICurveController(curveCtrl).redeemFromCurve(1e18, 0, 0);
    }

    function test_pool_operations_zero() public {
        // buyFromPool при S=0: pool пуст, весь X идёт через каскад buyFromCurveFor
        vm.prank(user);
        uint256 tokens = IPoolController(poolCtrl).buyFromPool(100e6, 0, 0);
        assertGt(tokens, 0);
        assertGt(IReserveManager(reserveMgr).S_curve(), 0);
    }
}
