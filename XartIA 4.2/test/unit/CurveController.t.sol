// SPDX-License-Identifier: AGPL-3.0
pragma solidity 0.8.24;

import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";

import {Roles} from "../../contracts/core/Roles.sol";
import {Errors} from "../../contracts/math/Errors.sol";
import {Constants} from "../../contracts/math/Constants.sol";
import {IPoolState} from "../../contracts/math/IPoolState.sol";
import {Types} from "../../contracts/math/Types.sol";
import {CurveMath} from "../../contracts/math/CurveMath.sol";
import {IXartIAToken} from "../../contracts/token/IXartIAToken.sol";
import {IReserveManager} from "../../contracts/reserve/IReserveManager.sol";
import {IVesting} from "../../contracts/vesting/IVesting.sol";
import {ICircuitBreaker} from "../../contracts/safety/ICircuitBreaker.sol";
import {ICurveController} from "../../contracts/controllers/ICurveController.sol";
import {IXartIAFactory} from "../../contracts/factory/IXartIAFactory.sol";
import {Events} from "../../contracts/events/Events.sol";
import {MockUSDC} from "../utils/MockUSDC.sol";
import {TestHelpers} from "../utils/TestHelpers.sol";

/// @title CurveController.t.sol — T.1.01.03
contract CurveControllerTest is TestHelpers {
    address internal factory;
    address internal token;
    address internal curveCtrl;
    address internal poolCtrl;
    address internal reserveMgr;
    address internal poolState;
    address internal vesting;
    address internal cb;
    address internal usdc;
    address internal treasury;

    address internal user = address(0xA11CE);
    address internal user2 = address(0xB0B);
    address internal buyer = address(0xCAFE);

    function setUp() public {
        factory = deployFullSystem();
        IXartIAFactory f = IXartIAFactory(factory);
        token = f.token();
        curveCtrl = f.curveController();
        poolCtrl = f.poolController();
        reserveMgr = f.reserveManager();
        poolState = f.poolState();
        vesting = f.vesting();
        cb = f.circuitBreaker();
        usdc = f.token() != address(0) ? mockUSDC() : mockUSDC(); // alias
        treasury = f.treasury();

        // user одобрил USDC и XRT curveController'у
        mintUSDC(user, 10_000_000e6);
        mintUSDC(user2, 10_000_000e6);
        approveAll(user, curveCtrl);
        approveAll(user2, curveCtrl);
        vm.prank(user);
        IXartIAToken(token).approve(curveCtrl, type(uint256).max);
        vm.prank(user2);
        IXartIAToken(token).approve(curveCtrl, type(uint256).max);
    }

    // ------------------------------------------------------------------ buyFromCurve

    function test_buyFromCurve() public {
        uint256 x6 = 1000e6;
        uint256 balBefore = IXartIAToken(token).balanceOf(user);

        vm.prank(user);
        uint256 tokens = curveCtrl_buy(x6);

        assertGt(tokens, 0);
        assertEq(IXartIAToken(token).balanceOf(user), balBefore + tokens);
        assertGt(IReserveManager(reserveMgr).S_curve(), 0);
    }

    function test_buyFromCurve_buyFee() public {
        uint256 x6 = 1000e6;
        vm.prank(user);
        uint256 tokens = curveCtrl_buy(x6);

        // X_18 = 1000e18, fee = 5e18, X_net = 995e18
        // deltaS = 995e18 * 1e18 / 2e15 = 497_500e18
        // teamTokens = 2487.5e18, userTokens = 495_012.5e18
        uint256 expectedDelta = CurveMath.deltaSForBuy(0, 995e18, _levels());
        uint256 expectedTeam = (expectedDelta * Constants.TEAM_PERCENT) / Constants.BASIS_POINTS;
        assertApproxEqAbs(tokens, expectedDelta - expectedTeam, 1e15);

        // reserve = X_18, curveBacking = R(ΔS) = X_net
        assertEq(IReserveManager(reserveMgr).reserve(), 1000e18);
        assertEq(IReserveManager(reserveMgr).curveBacking(), 995e18);
    }

    function test_buyFromCurve_minOut() public {
        vm.prank(user);
        vm.expectRevert(Errors.SlippageExceeded.selector);
        ICurveController(curveCtrl).buyFromCurve(1000e6, type(uint256).max, 0);
    }

    function test_buyFromCurve_minOut_zero() public {
        vm.prank(user);
        uint256 tokens = ICurveController(curveCtrl).buyFromCurve(1000e6, 0, 0);
        assertGt(tokens, 0);
    }

    function test_buyFromCurve_maxPurchasePct() public {
        // Первая покупка (genesis) — без лимита
        vm.prank(user);
        curveCtrl_buy(1000e6); // ~497k XRT

        // Вторая покупка 5% от S_curve — граница. 5.001% — revert.
        // S_curve ≈ 497_500e18, 5% ≈ 24_875e18 XRT → X_6 ≈ 50e6
        vm.prank(user2);
        vm.expectRevert(Errors.MaxPurchaseExceeded.selector);
        ICurveController(curveCtrl).buyFromCurve(200e6, 0, 0);
    }

    function test_buyFromCurve_genesis_no_maxPct() public {
        // S_curve == 0 — maxPurchasePct не применяется
        assertEq(IReserveManager(reserveMgr).S_curve(), 0);
        vm.prank(user);
        uint256 tokens = ICurveController(curveCtrl).buyFromCurve(5_000e6, 0, 0);
        assertGt(tokens, 50_000e18);
    }

    function test_buyFromCurve_effectiveMinimalX6_enforced() public {
        // minimalPurchase = 1e6 (1 USDC), buyFee = 50 (0.5%) → effective = 1_005_026
        vm.prank(user);
        vm.expectRevert(Errors.MinimalPurchaseNotMet.selector);
        ICurveController(curveCtrl).buyFromCurve(1_000_000, 0, 0); // 1 USDC < 1.005026 USDC

        vm.prank(user);
        ICurveController(curveCtrl).buyFromCurve(1_005_026, 0, 0);
    }

    function test_buyFromCurve_maxBalance() public {
        // maxBalance уровня == S_end, поэтому лимит не срабатывает в пределах supply.
        // Проверяем, что покупка за пределы supply ревертит OutOfBounds.
        vm.prank(user);
        vm.expectRevert(Errors.OutOfBounds.selector);
        ICurveController(curveCtrl).buyFromCurve(1_000_000e6, 0, 0);
    }

    function test_buyFromCurve_teamTokens_order() public {
        vm.prank(user);
        uint256 tokens = curveCtrl_buy(1000e6);

        // teamTokens = 0.5% от deltaS = 0.5% от (tokens / 0.995) ≈ tokens * 50 / 9950
        uint256 teamTokens = IVesting(vesting).totalAdded();
        assertEq(IXartIAToken(token).balanceOf(vesting), teamTokens);
        assertEq(teamTokens, (tokens * Constants.TEAM_PERCENT) / (Constants.BASIS_POINTS - Constants.TEAM_PERCENT));
    }

    function test_buyFromCurve_revert_not_initialized() public {
        _mockPoolPriceZero();

        vm.prank(user);
        vm.expectRevert(Errors.NotInitialized.selector);
        ICurveController(curveCtrl).buyFromCurve(1000e6, 0, 0);
    }

    function test_buyFromCurve_raises_poolPrice_floor() public {
        vm.prank(user);
        curveCtrl_buy(6_000e6);

        uint256 newS = IReserveManager(reserveMgr).S_curve();
        Types.Level[] memory lv = _levels();
        uint256 pNewS = CurveMath.P(newS, lv);
        uint256 floor = (pNewS * Constants.BASIS_POINTS) / (Constants.BASIS_POINTS + Constants.MAX_GAP);
        uint256 cur = IPoolState(poolState).poolPrice();
        assertGe(cur, floor);
    }

    // ------------------------------------------------------------------ redeemFromCurve

    function test_redeemFromCurve() public {
        uint256 tokens = _seedUser();
        uint256 before = MockUSDC(usdc).balanceOf(user);
        uint256 reserveBefore = IReserveManager(reserveMgr).reserve();

        vm.prank(user);
        uint256 out = ICurveController(curveCtrl).redeemFromCurve(tokens, 0, 0);

        assertGt(out, 0);
        assertEq(MockUSDC(usdc).balanceOf(user), before + out / 1e12); // out — 18 dec
        assertLt(IReserveManager(reserveMgr).reserve(), reserveBefore);
        assertEq(IXartIAToken(token).balanceOf(user), 0);
    }

    function test_redeemFromCurve_redeemFee() public {
        uint256 tokens = _seedUser();
        uint256 amountExpected = CurveMath.amountForRedeem(IReserveManager(reserveMgr).S_curve(), tokens, _levels());
        uint256 feeExpected = (amountExpected * 50) / Constants.BASIS_POINTS;

        vm.prank(user);
        uint256 out = ICurveController(curveCtrl).redeemFromCurve(tokens, 0, 0);

        // user_amount = amount − redeemFee − earlyFee(0) − sellTeamFee(10 bp)
        uint256 sellTeamFeeExpected = (amountExpected * 10) / Constants.BASIS_POINTS;
        assertEq(out, amountExpected - feeExpected - sellTeamFeeExpected);
    }

    function test_redeemFromCurve_earlySellFee() public {
        // Включаем earlySellFee: 100 bp (1%), period = 1 days
        vm.prank(factory);
        ICurveController(curveCtrl).setEarlySellFee(100);
        vm.prank(factory);
        ICurveController(curveCtrl).setEarlySellPeriod(1 days);

        uint256 tokens = _seedUser();
        uint256 amountExpected = CurveMath.amountForRedeem(IReserveManager(reserveMgr).S_curve(), tokens, _levels());
        uint256 earlyFeeExpected = (amountExpected * 100) / Constants.BASIS_POINTS;

        // Сразу продажа (в earlySellPeriod)
        vm.prank(user);
        uint256 out = ICurveController(curveCtrl).redeemFromCurve(tokens, 0, 0);

        uint256 redeemFee = (amountExpected * 50) / Constants.BASIS_POINTS;
        uint256 sellTeamFee = (amountExpected * 10) / Constants.BASIS_POINTS;
        assertEq(out, amountExpected - redeemFee - earlyFeeExpected - sellTeamFee);
    }

    function test_redeemFromCurve_revert_not_initialized() public {
        _mockPoolPriceZero();

        vm.prank(user);
        vm.expectRevert(Errors.NotInitialized.selector);
        ICurveController(curveCtrl).redeemFromCurve(1e18, 0, 0);
    }

    function test_redeemFromCurve_applies_ceiling_and_floor() public {
        // Сначала существенно поднимаем poolPrice через большую покупку
        vm.prank(user);
        curveCtrl_buy(6_000e6);

        vm.prank(user2);
        ICurveController(curveCtrl).buyFromCurve(100e6, 0, 0);
        warpBy(1);
        uint256 tokens = IXartIAToken(token).balanceOf(user2);
        vm.prank(user2);
        ICurveController(curveCtrl).redeemFromCurve(tokens, 0, 0);

        uint256 newS = IReserveManager(reserveMgr).S_curve();
        uint256 pNewS = CurveMath.P(newS, _levels());
        uint256 floor = (pNewS * Constants.BASIS_POINTS) / (Constants.BASIS_POINTS + Constants.MAX_GAP);
        uint256 ceiling = (pNewS * (Constants.BASIS_POINTS + Constants.MAX_GAP)) / Constants.BASIS_POINTS;
        uint256 cur = IPoolState(poolState).poolPrice();
        assertGe(cur, floor);
        assertLe(cur, ceiling);
    }

    // ------------------------------------------------------------------ sellTeamFee в redeem

    function test_redeemFromCurve_sellTeamFee() public {
        uint256 tokens = _seedUser();
        uint256 amountExpected = CurveMath.amountForRedeem(IReserveManager(reserveMgr).S_curve(), tokens, _levels());
        uint256 sellTeamFee = (amountExpected * 10) / Constants.BASIS_POINTS;
        uint256 treasuryBefore = MockUSDC(usdc).balanceOf(treasury);

        vm.prank(user);
        ICurveController(curveCtrl).redeemFromCurve(tokens, 0, 0);

        // treasury получил toUSDC(sellTeamFee)
        assertEq(MockUSDC(usdc).balanceOf(treasury), treasuryBefore + sellTeamFee / 1e12);
    }

    function test_redeemFromCurve_sellTeamFee_zero() public {
        vm.prank(factory);
        ICurveController(curveCtrl).setSellTeamFee(0);

        uint256 tokens = _seedUser();
        uint256 treasuryBefore = MockUSDC(usdc).balanceOf(treasury);

        vm.prank(user);
        ICurveController(curveCtrl).redeemFromCurve(tokens, 0, 0);

        assertEq(MockUSDC(usdc).balanceOf(treasury), treasuryBefore);
    }

    function test_redeemFromCurve_sellTeamFee_treasury_balance() public {
        vm.prank(factory);
        ICurveController(curveCtrl).setSellTeamFee(20); // 0.2%

        uint256 tokens = _seedUser();
        uint256 amountExpected = CurveMath.amountForRedeem(IReserveManager(reserveMgr).S_curve(), tokens, _levels());
        uint256 sellTeamFee = (amountExpected * 20) / Constants.BASIS_POINTS;
        uint256 treasuryBefore = MockUSDC(usdc).balanceOf(treasury);

        vm.prank(user);
        ICurveController(curveCtrl).redeemFromCurve(tokens, 0, 0);

        assertEq(MockUSDC(usdc).balanceOf(treasury), treasuryBefore + sellTeamFee / 1e12);
    }

    function test_redeemFromCurve_sellTeamFee_max_bound() public {
        vm.prank(factory);
        ICurveController(curveCtrl).setSellTeamFee(50);

        vm.prank(factory);
        vm.expectRevert(Errors.OutOfBounds.selector);
        ICurveController(curveCtrl).setSellTeamFee(51);
    }

    function test_redeemFromCurve_sellTeamFee_with_earlySellFee() public {
        vm.prank(factory);
        ICurveController(curveCtrl).setEarlySellFee(100);
        vm.prank(factory);
        ICurveController(curveCtrl).setEarlySellPeriod(1 days);

        uint256 tokens = _seedUser();
        uint256 amountExpected = CurveMath.amountForRedeem(IReserveManager(reserveMgr).S_curve(), tokens, _levels());
        uint256 fee_ = (amountExpected * 50) / Constants.BASIS_POINTS;
        uint256 early_ = (amountExpected * 100) / Constants.BASIS_POINTS;
        uint256 team_ = (amountExpected * 10) / Constants.BASIS_POINTS;
        uint256 expectedUser = amountExpected - fee_ - early_ - team_;

        vm.prank(user);
        uint256 out = ICurveController(curveCtrl).redeemFromCurve(tokens, 0, 0);
        assertEq(out, expectedUser);
    }

    function test_redeemFromCurve_fee_decomposition() public {
        uint256 tokens = _seedUser();
        uint256 amount = CurveMath.amountForRedeem(IReserveManager(reserveMgr).S_curve(), tokens, _levels());
        uint256 reserveBefore = IReserveManager(reserveMgr).reserve();
        uint256 treasuryBefore = MockUSDC(usdc).balanceOf(treasury);

        vm.prank(user);
        ICurveController(curveCtrl).redeemFromCurve(tokens, 0, 0);

        uint256 reserveAfter = IReserveManager(reserveMgr).reserve();
        uint256 treasuryAfter = MockUSDC(usdc).balanceOf(treasury);

        // reserve_new = reserve_old − (amount − redeemFee − earlyFee(0))
        uint256 fee_ = (amount * 50) / Constants.BASIS_POINTS;
        assertApproxEqAbs(reserveBefore - reserveAfter, amount - fee_, 2e12); // округление до 6 dec

        // treasury += sellTeamFee
        uint256 team_ = (amount * 10) / Constants.BASIS_POINTS;
        assertEq(treasuryAfter - treasuryBefore, team_ / 1e12);
    }

    function test_redeemFromCurve_reserve_invariant_with_sellTeamFee() public {
        uint256 tokens = _seedUser();
        vm.prank(user);
        ICurveController(curveCtrl).redeemFromCurve(tokens, 0, 0);

        assertGe(IReserveManager(reserveMgr).reserve(), IReserveManager(reserveMgr).curveBacking());
    }

    // ------------------------------------------------------------------ setSellTeamFee

    function test_setSellTeamFee() public {
        vm.prank(factory);
        ICurveController(curveCtrl).setSellTeamFee(20);
        assertEq(ICurveController(curveCtrl).sellTeamFee(), 20);
    }

    function test_setSellTeamFee_bounds() public {
        vm.prank(factory);
        ICurveController(curveCtrl).setSellTeamFee(0);
        assertEq(ICurveController(curveCtrl).sellTeamFee(), 0);

        vm.prank(factory);
        ICurveController(curveCtrl).setSellTeamFee(50);
        assertEq(ICurveController(curveCtrl).sellTeamFee(), 50);

        vm.prank(factory);
        vm.expectRevert(Errors.OutOfBounds.selector);
        ICurveController(curveCtrl).setSellTeamFee(51);
    }

    function test_setSellTeamFee_emit() public {
        vm.expectEmit(false, false, false, true);
        emit Events.SellTeamFeeUpdated(10, 20);

        vm.prank(factory);
        ICurveController(curveCtrl).setSellTeamFee(20);
    }

    function test_setSellTeamFee_revert_unauthorized() public {
        vm.prank(user);
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, user, Roles.GOVERNANCE_ROLE
            )
        );
        ICurveController(curveCtrl).setSellTeamFee(20);
    }

    // ------------------------------------------------------------------ buyFromCurveFor

    function test_buyFromCurveFor() public {
        _fundPoolController(1000e6);
        uint256 balBefore = IXartIAToken(token).balanceOf(buyer);

        vm.prank(poolCtrl);
        uint256 tokens = ICurveController(curveCtrl).buyFromCurveFor(buyer, 995e18, 0, 0);

        assertGt(tokens, 0);
        assertEq(IXartIAToken(token).balanceOf(buyer), balBefore + tokens);
    }

    function test_buyFromCurveFor_minOut() public {
        _fundPoolController(1000e6);

        vm.prank(poolCtrl);
        vm.expectRevert(Errors.SlippageExceeded.selector);
        ICurveController(curveCtrl).buyFromCurveFor(buyer, 995e18, type(uint256).max, 0);
    }

    function test_buyFromCurveFor_no_minimalPurchase() public {
        // buyFromCurveFor НЕ проверяет minimalPurchase (по спеке — это делает PoolController)
        _fundPoolController(1e6); // 1 USDC на poolController

        vm.prank(poolCtrl);
        uint256 tokens = ICurveController(curveCtrl).buyFromCurveFor(buyer, 0.5e18, 0, 0);
        assertGt(tokens, 0);
    }

    function test_buyFromCurveFor_buyEvent_usdcIn() public {
        _fundPoolController(1000e6);

        vm.expectEmit(true, false, false, false);
        emit Events.Buy(buyer, 0, 0, 0, 0, 0, 0, 0); // значение полей не проверяем, только buyer

        vm.prank(poolCtrl);
        ICurveController(curveCtrl).buyFromCurveFor(buyer, 995e18, 0, 0);
    }

    function test_buyFromCurveFor_revert_not_initialized() public {
        _mockPoolPriceZero();
        _fundPoolController(1000e6);

        vm.prank(poolCtrl);
        vm.expectRevert(Errors.NotInitialized.selector);
        ICurveController(curveCtrl).buyFromCurveFor(buyer, 995e18, 0, 0);
    }

    function test_buyFromCurveFor_raises_poolPrice_floor() public {
        _fundPoolController(6_000e6);

        vm.prank(poolCtrl);
        ICurveController(curveCtrl).buyFromCurveFor(buyer, 5_970e18, 0, 0);

        uint256 newS = IReserveManager(reserveMgr).S_curve();
        uint256 pNewS = CurveMath.P(newS, _levels());
        uint256 floor = (pNewS * Constants.BASIS_POINTS) / (Constants.BASIS_POINTS + Constants.MAX_GAP);
        assertGe(IPoolState(poolState).poolPrice(), floor);
    }

    function test_buyFromCurveFor_pulls_usdc() public {
        _fundPoolController(1000e6);
        uint256 rmBefore = IReserveManager(reserveMgr).reserve();

        vm.prank(poolCtrl);
        ICurveController(curveCtrl).buyFromCurveFor(buyer, 995e18, 0, 0);

        // ReserveManager получил 995 USDC (нормализовано = 995e18)
        assertEq(IReserveManager(reserveMgr).reserve(), rmBefore + 995e18);
    }

    function test_buyFromCurveFor_revert_no_approve() public {
        _fundPoolControllerNoApprove(1000e6);

        vm.prank(poolCtrl);
        vm.expectRevert();
        ICurveController(curveCtrl).buyFromCurveFor(buyer, 995e18, 0, 0);
    }

    function test_buyFromCurveFor_revert_unauthorized_sender() public {
        vm.prank(user);
        vm.expectRevert(Errors.Unauthorized.selector);
        ICurveController(curveCtrl).buyFromCurveFor(buyer, 995e18, 0, 0);
    }

    function test_buyFromCurveFor_revert_max_curve_for_exceeded() public {
        // Первая покупка на кривой через public buyFromCurve → freeReserve = fee = 0.5 USDC
        vm.prank(user);
        curveCtrl_buy(1000e6); // freeReserve ≈ 5e18
        uint256 freeR = IReserveManager(reserveMgr).freeReserve();
        uint256 limit = (freeR * Constants.MAX_CURVE_FOR_PCT) / Constants.BASIS_POINTS;

        _fundPoolController(6_000e6);

        vm.prank(poolCtrl);
        vm.expectRevert(Errors.MaxCurveForExceeded.selector);
        ICurveController(curveCtrl).buyFromCurveFor(buyer, limit + 1e18, 0, 0);
    }

    function test_buyFromCurveFor_genesis_no_max_curve_for() public {
        // S_curve == 0 — лимит не применяется
        _fundPoolController(6_000e6);

        vm.prank(poolCtrl);
        uint256 tokens = ICurveController(curveCtrl).buyFromCurveFor(buyer, 5_970e18, 0, 0);
        assertGt(tokens, 50_000e18);
    }

    function test_buyFromCurveFor_rounding_invariant_holds() public {
        _fundPoolController(1000e6);

        vm.prank(poolCtrl);
        ICurveController(curveCtrl).buyFromCurveFor(buyer, 995e18 + 1, 0, 0);

        // После нормализации X_18 = 995e18 (пыль отброшена)
        assertGe(IReserveManager(reserveMgr).reserve(), IReserveManager(reserveMgr).curveBacking());
    }

    function test_buyFromCurveFor_limit_applies_to_normalized_X18() public {
        vm.prank(user);
        curveCtrl_buy(1000e6);
        uint256 freeR = IReserveManager(reserveMgr).freeReserve();
        uint256 limit = (freeR * Constants.MAX_CURVE_FOR_PCT) / Constants.BASIS_POINTS;

        _fundPoolController(6_000e6);

        // limit + 1 (1 wei 18-dec) нормализуется до limit → проходит
        vm.prank(poolCtrl);
        ICurveController(curveCtrl).buyFromCurveFor(buyer, limit + 1, 0, 0);
    }

    function test_buyFromCurveFor_limit_epsilon_bypass_blocked() public {
        vm.prank(user);
        curveCtrl_buy(1000e6);
        uint256 freeR = IReserveManager(reserveMgr).freeReserve();
        uint256 limit = (freeR * Constants.MAX_CURVE_FOR_PCT) / Constants.BASIS_POINTS;
        // limit + 1 wei-6 (1e12 в 18-dec) после нормализации остаётся больше limit
        uint256 tooMuch = limit + 1e12;

        _fundPoolController(6_000e6);

        vm.prank(poolCtrl);
        vm.expectRevert(Errors.MaxCurveForExceeded.selector);
        ICurveController(curveCtrl).buyFromCurveFor(buyer, tooMuch, 0, 0);
    }

    // ------------------------------------------------------------------ setPoolController

    function test_setPoolController_one_time() public {
        // Factory.deploy уже вызвал setPoolController. Повторный вызов — revert.
        vm.prank(factory);
        vm.expectRevert(Errors.AlreadyInitialized.selector);
        ICurveController(curveCtrl).setPoolController(address(0xDEAD));
    }

    // ------------------------------------------------------------------ setLastBuyTime

    function test_setLastBuyTime_revert_unauthorized() public {
        vm.prank(user);
        vm.expectRevert(Errors.Unauthorized.selector);
        ICurveController(curveCtrl).setLastBuyTime(user, block.timestamp);
    }

    // ------------------------------------------------------------------ effectiveMinimalX6

    function test_effectiveMinimalX6_default() public view {
        // minimalPurchase = 1e6, buyFee = 50 → ceil(1e6 * 10000 / 9950) = 1005026
        assertEq(ICurveController(curveCtrl).effectiveMinimalX6(), 1_005_026);
    }

    function test_effectiveMinimalX6_zero_fee() public {
        vm.prank(factory);
        ICurveController(curveCtrl).setBuyFee(0);
        assertEq(ICurveController(curveCtrl).effectiveMinimalX6(), 1e6);
    }

    function test_effectiveMinimalX6_max_fee() public {
        vm.prank(factory);
        ICurveController(curveCtrl).setBuyFee(200);
        // ceil(1e6 * 10000 / 9800) = ceil(1_020_408.16) = 1_020_409
        assertEq(ICurveController(curveCtrl).effectiveMinimalX6(), 1_020_409);
    }

    function test_effectiveMinimalX6_monotonic() public {
        uint256 prev = ICurveController(curveCtrl).effectiveMinimalX6();
        vm.prank(factory);
        ICurveController(curveCtrl).setBuyFee(100);
        uint256 next = ICurveController(curveCtrl).effectiveMinimalX6();
        assertGt(next, prev);
    }

    // ------------------------------------------------------------------ proxy views

    function test_S_curve_proxy() public {
        vm.prank(user);
        curveCtrl_buy(1000e6);
        assertEq(ICurveController(curveCtrl).S_curve(), IReserveManager(reserveMgr).S_curve());
    }

    function test_reserve_proxy() public {
        vm.prank(user);
        curveCtrl_buy(1000e6);
        assertEq(ICurveController(curveCtrl).reserve(), IReserveManager(reserveMgr).reserve());
    }

    // ------------------------------------------------------------------ helpers

    function curveCtrl_buy(uint256 x6) internal returns (uint256) {
        return ICurveController(curveCtrl).buyFromCurve(x6, 0, 0);
    }

    function _seedUser() internal returns (uint256) {
        vm.prank(user);
        curveCtrl_buy(1000e6);
        // warp past earlySellPeriod (default 0, но подстрахуемся)
        warpBy(1);
        return IXartIAToken(token).balanceOf(user);
    }

    function _seedUser2() internal returns (uint256) {
        vm.prank(user2);
        ICurveController(curveCtrl).buyFromCurve(1000e6, 0, 0);
        warpBy(1);
        return IXartIAToken(token).balanceOf(user2);
    }

    function _fundPoolController(uint256 x6) internal {
        mintUSDC(poolCtrl, x6);
        vm.prank(poolCtrl);
        MockUSDC(usdc).approve(curveCtrl, x6);
    }

    function _fundPoolControllerNoApprove(uint256 x6) internal {
        mintUSDC(poolCtrl, x6);
    }

    function _mockPoolPriceZero() internal {
        vm.mockCall(poolState, abi.encodeWithSelector(IPoolState.poolPrice.selector), abi.encode(uint256(0)));
    }

    function _levels() internal view returns (Types.Level[] memory) {
        return IXartIAFactory(factory).levels() != address(0) ? _readLevels() : _emptyLevels();
    }

    function _readLevels() internal view returns (Types.Level[] memory lv) {
        address levelsAddr = IXartIAFactory(factory).levels();
        (bool ok, bytes memory data) = levelsAddr.staticcall(abi.encodeWithSignature("all()"));
        require(ok, "levels.all() failed");
        lv = abi.decode(data, (Types.Level[]));
    }

    function _emptyLevels() internal pure returns (Types.Level[] memory) {
        return new Types.Level[](0);
    }

    function _setMaxBalance(uint256 idx, uint256 value) internal {
        address levelsAddr = IXartIAFactory(factory).levels();
        bytes32 elemBase = keccak256(abi.encode(uint256(0)));
        bytes32 slot = bytes32(uint256(elemBase) + idx * 5 + 4);
        vm.store(levelsAddr, slot, bytes32(value));
    }
}
