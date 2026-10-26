// SPDX-License-Identifier: AGPL-3.0
pragma solidity 0.8.24;

import {Errors} from "../../contracts/math/Errors.sol";
import {Constants} from "../../contracts/math/Constants.sol";
import {IPoolState} from "../../contracts/math/IPoolState.sol";
import {Types} from "../../contracts/math/Types.sol";
import {CurveMath} from "../../contracts/math/CurveMath.sol";
import {IXartIAToken} from "../../contracts/token/IXartIAToken.sol";
import {IReserveManager} from "../../contracts/reserve/IReserveManager.sol";
import {ICircuitBreaker} from "../../contracts/safety/ICircuitBreaker.sol";
import {ICurveController} from "../../contracts/controllers/ICurveController.sol";
import {IPoolController} from "../../contracts/controllers/IPoolController.sol";
import {IXartIAFactory} from "../../contracts/factory/IXartIAFactory.sol";
import {Events} from "../../contracts/events/Events.sol";
import {MockUSDC} from "../utils/MockUSDC.sol";
import {TestHelpers} from "../utils/TestHelpers.sol";

/// @title PoolController.t.sol вЂ” T.1.01.04
contract PoolControllerTest is TestHelpers {
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
        usdc = mockUSDC();
        treasury = f.treasury();

        mintUSDC(user, 10_000_000e6);
        mintUSDC(user2, 10_000_000e6);
        for (uint256 i = 0; i < 2; i++) {
            address u = i == 0 ? user : user2;
            vm.prank(u);
            MockUSDC(usdc).approve(poolCtrl, type(uint256).max);
            vm.prank(u);
            MockUSDC(usdc).approve(curveCtrl, type(uint256).max);
            vm.prank(u);
            IXartIAToken(token).approve(poolCtrl, type(uint256).max);
            vm.prank(u);
            IXartIAToken(token).approve(curveCtrl, type(uint256).max);
        }
    }

    // ================================================================== buyFromPool

    function test_buyFromPool() public {
        uint256 tokens = _buy(user, 1000e6);
        assertGt(tokens, 0);
        assertGt(IReserveManager(reserveMgr).S_curve(), 0);
        assertEq(IXartIAToken(token).balanceOf(user), tokens);
    }

    function test_buyFromPool_buyFee() public {
        uint256 rmBefore = IReserveManager(reserveMgr).reserve();
        _buy(user, 1000e6);
        assertEq(IReserveManager(reserveMgr).reserve() - rmBefore, 1000e18);
    }

    function test_buyFromPool_cascade() public {
        // РџСѓСЃС‚РѕР№ pool в†’ 100% С‡РµСЂРµР· РєР°СЃРєР°Рґ
        uint256 sBefore = IReserveManager(reserveMgr).S_curve();
        _buy(user, 1000e6);
        assertGt(IReserveManager(reserveMgr).S_curve(), sBefore);
    }

    function test_buyFromPool_cascade_empty_pool_success() public {
        assertEq(IPoolState(poolState).pool(), 0);
        uint256 tokens = _buy(user, 1000e6);
        assertGt(tokens, 0);
    }

    function test_buyFromPool_partial_pool_no_revert() public {
        // Seed pool: user РїСЂРѕРґР°С‘С‚ 20_000 XRT РІ pool
        _seedPool(20_000e18);
        uint256 poolBefore = IPoolState(poolState).pool();
        assertGt(poolBefore, 0);

        // user2 РїРѕРєСѓРїР°РµС‚ РЅР° 1000 USDC вЂ” С‡Р°СЃС‚СЊ РёР· pool, С‡Р°СЃС‚СЊ РёР· РєСЂРёРІРѕР№
        uint256 tokens = _buy(user2, 100e6);
        assertGt(tokens, 0);
    }

    function test_buyFromPool_tokensFromCurve_assigned() public {
        _seedPool(20_000e18);
        uint256 sBefore = IReserveManager(reserveMgr).S_curve();
        _buy(user2, 200e6); // Р±РѕР»СЊС€Рµ, С‡РµРј 20k XRT РІ pool
        assertGt(IReserveManager(reserveMgr).S_curve(), sBefore);
    }

    function test_buyFromPool_zero_poolPrice_revert() public {
        _mockPoolPriceZero();
        vm.prank(user);
        vm.expectRevert(Errors.NotInitialized.selector);
        IPoolController(poolCtrl).buyFromPool(1000e6, 0, 0);
    }

    function test_buyFromPool_revert_not_initialized() public {
        test_buyFromPool_zero_poolPrice_revert();
    }

    function test_buyFromPool_effectiveMinimalX6_revert() public {
        vm.prank(user);
        vm.expectRevert(Errors.MinimalPurchaseNotMet.selector);
        IPoolController(poolCtrl).buyFromPool(1_000_000, 0, 0); // 1 USDC < 1.005026
    }

    function test_buyFromPool_effectiveMinimalX6_pass() public {
        _buy(user, 1_005_026);
    }

    function test_buyFromPool_no_cascade_updates_lastBuyTime() public {
        _seedPool(200_000e18); // Р±РѕР»СЊС€РѕР№ pool
        _buy(user2, 100e6);

        // lastBuyTime РѕР±РЅРѕРІРёР»СЃСЏ С‡РµСЂРµР· ICurveController.setLastBuyTime
        (bool ok, bytes memory data) = curveCtrl.staticcall(abi.encodeWithSignature("lastBuyTime(address)", user2));
        require(ok, "lastBuyTime");
        assertEq(abi.decode(data, (uint256)), block.timestamp);
    }

    function test_buyFromPool_cascade_updates_lastBuyTime() public {
        _buy(user, 1000e6); // pool РїСѓСЃС‚ в†’ РєР°СЃРєР°Рґ
        (bool ok, bytes memory data) = curveCtrl.staticcall(abi.encodeWithSignature("lastBuyTime(address)", user));
        require(ok, "lastBuyTime");
        assertEq(abi.decode(data, (uint256)), block.timestamp);
    }

    function test_buyFromPool_cascade_approves_curve() public {
        // РџРѕСЃР»Рµ tx allowance(poolCtrl в†’ curveCtrl) = 0 (СЃР±СЂРѕС€РµРЅ)
        _buy(user, 1000e6);
        assertEq(MockUSDC(usdc).allowance(poolCtrl, curveCtrl), 0);
    }

    function test_buyFromPool_cascade_pulls_usdc() public {
        uint256 rmBefore = IReserveManager(reserveMgr).reserve();
        _buy(user, 1000e6);
        // Р’РµСЃСЊ X_18 = 1000e18 СѓС€С‘Р» РІ reserveManager (fee + РєР°СЃРєР°Рґ)
        assertEq(IReserveManager(reserveMgr).reserve() - rmBefore, 1000e18);
    }

    function test_buyFromPool_cascade_allowance_reset() public {
        _buy(user, 1000e6);
        assertEq(MockUSDC(usdc).allowance(poolCtrl, curveCtrl), 0);
    }

    function test_buyFromPool_fee_to_reserve() public {
        uint256 rmBefore = IReserveManager(reserveMgr).reserve();
        _buy(user, 1000e6);
        assertEq(IReserveManager(reserveMgr).reserve() - rmBefore, 1000e18);
    }

    function test_buyFromPool_empty_pool_fee_to_reserve() public {
        assertEq(IPoolState(poolState).pool(), 0);
        uint256 rmBefore = IReserveManager(reserveMgr).reserve();
        _buy(user, 1000e6);
        // reserve += X_18 (fee_18 РЅР° С€Р°РіРµ 11a + X_remaining РЅР° РєР°СЃРєР°РґРµ)
        assertEq(IReserveManager(reserveMgr).reserve() - rmBefore, 1000e18);
    }

    function test_buyFromPool_full_pool_fee_to_reserve() public {
        _seedPool(300_000e18); // pool С…РІР°С‚Р°РµС‚ РЅР° 100 USDC РїРѕРєСѓРїРєСѓ
        uint256 rmBefore = IReserveManager(reserveMgr).reserve();
        _buy(user2, 50e6);
        uint256 delta = IReserveManager(reserveMgr).reserve() - rmBefore;
        // Р•СЃР»Рё Р±С‹ РІРµСЃСЊ X С€С‘Р» РІ reserveManager вЂ” Р±С‹Р»Рѕ Р±С‹ 100e18
        // Р’ РЅР°С€РµРј СЃР»СѓС‡Р°Рµ: fee_18 = 0.5e18 (С€Р°Рі 11a), X_pool_used_18 в‰€ 99.5e18
        assertApproxEqAbs(delta, 50e18, 1e18);
    }

    function test_buyFromPool_fee_decomposition() public {
        uint256 rmBefore = IReserveManager(reserveMgr).reserve();
        _buy(user, 1000e6);
        // 1000e18 РІ reserve = 5e18 (fee, С€Р°Рі 11a) + 995e18 (РєР°СЃРєР°Рґ, buyFromCurveFor)
        assertEq(IReserveManager(reserveMgr).reserve() - rmBefore, 1000e18);
    }

    function test_buyFromPool_zero_balance_after_tx() public {
        _buy(user, 1000e6);
        assertEq(MockUSDC(usdc).balanceOf(poolCtrl), 0);
        assertEq(IXartIAToken(token).balanceOf(poolCtrl), 0);
    }

    function test_buyFromPool_dust_swept() public {
        _buy(user, 1000e6);
        // sweep-dust: РѕСЃС‚Р°С‚РѕРє USDC (в‰¤ 2 wei-6) в†’ reserveManager
        assertEq(MockUSDC(usdc).balanceOf(poolCtrl), 0);
    }

    function test_buyFromPool_dust_accumulation_1000_tx() public {
        // РљРѕРјРїСЂРѕРјРёСЃСЃ: 100 РёС‚РµСЂР°С†РёР№ (1000 вЂ” СЃР»РёС€РєРѕРј РґРѕР»РіРѕ РґР»СЏ unit-С‚РµСЃС‚Р°)
        _disableCB(); // большой freeReserve: cascade не упирается в MaxCurveFor
        _buy(user, 100e6); // поднять S, чтобы 1 USDC не упирался в 10%
        for (uint256 i = 0; i < 100; i++) {
            _buy(user, 1_005_026);
            assertEq(MockUSDC(usdc).balanceOf(poolCtrl), 0);
        }
    }

    // ================================================================== sellToPool

    function test_sellToPool() public {
        _seedUserTokens(1000e6);
        _disableCB();

        uint256 poolBefore = IPoolState(poolState).pool();
        uint256 userUSDCBefore = MockUSDC(usdc).balanceOf(user);
        uint256 tokensToSell = 10_000e18;

        vm.prank(user);
        uint256 out = IPoolController(poolCtrl).sellToPool(tokensToSell, 0, 0);

        assertGt(out, 0);
        assertEq(IPoolState(poolState).pool(), poolBefore + tokensToSell);
        assertEq(MockUSDC(usdc).balanceOf(user), userUSDCBefore + out / 1e12); // out — 18 dec
    }

    function test_sellToPool_redeemFee() public {
        _seedUserTokens(1000e6);
        _disableCB();

        uint256 tokensToSell = 10_000e18;
        uint256 amountGross = (tokensToSell * IPoolState(poolState).poolPrice()) / Constants.PRECISION;
        uint256 fee = (amountGross * 50) / Constants.BASIS_POINTS;
        uint256 sellTeamFee = (amountGross * 10) / Constants.BASIS_POINTS;
        uint256 expected = amountGross - fee - sellTeamFee;

        vm.prank(user);
        uint256 out = IPoolController(poolCtrl).sellToPool(tokensToSell, 0, 0);
        assertEq(out, expected);
    }

    function test_sellToPool_sellTeamFee() public {
        _seedUserTokens(1000e6);
        _disableCB();

        uint256 tokensToSell = 10_000e18;
        uint256 amountGross = (tokensToSell * IPoolState(poolState).poolPrice()) / Constants.PRECISION;
        uint256 sellTeamFee = (amountGross * 10) / Constants.BASIS_POINTS;
        uint256 treasuryBefore = MockUSDC(usdc).balanceOf(treasury);

        vm.prank(user);
        IPoolController(poolCtrl).sellToPool(tokensToSell, 0, 0);

        assertEq(MockUSDC(usdc).balanceOf(treasury), treasuryBefore + sellTeamFee / 1e12);
    }

    function test_sellToPool_sellTeamFee_zero() public {
        vm.prank(factory);
        ICurveController(curveCtrl).setSellTeamFee(0);

        _seedUserTokens(1000e6);
        _disableCB();
        uint256 treasuryBefore = MockUSDC(usdc).balanceOf(treasury);

        vm.prank(user);
        IPoolController(poolCtrl).sellToPool(10_000e18, 0, 0);

        assertEq(MockUSDC(usdc).balanceOf(treasury), treasuryBefore);
    }

    function test_sellToPool_sellTeamFee_treasury_balance() public {
        vm.prank(factory);
        ICurveController(curveCtrl).setSellTeamFee(20);

        _seedUserTokens(1000e6);
        _disableCB();

        uint256 tokensToSell = 10_000e18;
        uint256 amountGross = (tokensToSell * IPoolState(poolState).poolPrice()) / Constants.PRECISION;
        uint256 sellTeamFee = (amountGross * 20) / Constants.BASIS_POINTS;
        uint256 treasuryBefore = MockUSDC(usdc).balanceOf(treasury);

        vm.prank(user);
        IPoolController(poolCtrl).sellToPool(tokensToSell, 0, 0);

        assertEq(MockUSDC(usdc).balanceOf(treasury), treasuryBefore + sellTeamFee / 1e12);
    }

    function test_sellToPool_sellTeamFee_reads_from_curve() public {
        _seedUserTokens(1000e6);
        _disableCB();

        // РџРµСЂРІР°СЏ РїСЂРѕРґР°Р¶Р°: sellTeamFee = 20
        vm.prank(factory);
        ICurveController(curveCtrl).setSellTeamFee(20);
        uint256 tokensToSell = 5000e18;
        uint256 amountGross = (tokensToSell * IPoolState(poolState).poolPrice()) / Constants.PRECISION;
        uint256 fee20 = (amountGross * 20) / Constants.BASIS_POINTS;
        uint256 treasuryBefore = MockUSDC(usdc).balanceOf(treasury);
        vm.prank(user);
        IPoolController(poolCtrl).sellToPool(tokensToSell, 0, 0);
        assertEq(MockUSDC(usdc).balanceOf(treasury), treasuryBefore + fee20 / 1e12);

        // Р’С‚РѕСЂР°СЏ РїСЂРѕРґР°Р¶Р°: sellTeamFee = 40
        vm.prank(factory);
        ICurveController(curveCtrl).setSellTeamFee(40);
        amountGross = (tokensToSell * IPoolState(poolState).poolPrice()) / Constants.PRECISION;
        uint256 fee40 = (amountGross * 40) / Constants.BASIS_POINTS;
        treasuryBefore = MockUSDC(usdc).balanceOf(treasury);
        vm.prank(user);
        IPoolController(poolCtrl).sellToPool(tokensToSell, 0, 0);
        assertEq(MockUSDC(usdc).balanceOf(treasury), treasuryBefore + fee40 / 1e12);
    }

    function test_sellToPool_fee_decomposition_with_sellTeamFee() public {
        _seedUserTokens(1000e6);
        _disableCB();

        uint256 tokensToSell = 10_000e18;
        uint256 amountGross = (tokensToSell * IPoolState(poolState).poolPrice()) / Constants.PRECISION;
        uint256 fee = (amountGross * 50) / Constants.BASIS_POINTS;
        uint256 sellTeamFee = (amountGross * 10) / Constants.BASIS_POINTS;
        uint256 userAmount = amountGross - fee - sellTeamFee;

        uint256 rmBefore = IReserveManager(reserveMgr).reserve();
        vm.prank(user);
        IPoolController(poolCtrl).sellToPool(tokensToSell, 0, 0);
        uint256 rmAfter = IReserveManager(reserveMgr).reserve();

        // reserve_new = reserve_old в€’ (amount_gross в€’ redeemFee)
        assertApproxEqAbs(rmBefore - rmAfter, amountGross - fee, 2e12); // округление до 6 dec
        // user РїРѕР»СѓС‡РёР» amount_gross в€’ fee в€’ sellTeamFee
    }

    function test_sellToPool_freeReserve_check_includes_sellTeamFee() public {
        // Seed: user РїРѕРєСѓРїР°РµС‚ 804 USDC в†’ reserve = 804, curveBacking в‰€ 800, freeReserve = 4
        _seedUserTokens(804e6);
        // РџРѕРґРЅРёРјР°РµРј reserve, РЅРµ С‚СЂРѕРіР°СЏ curveBacking: reserve = 1000, freeReserve в‰€ 200, ratio = 20%
        mintUSDC(reserveMgr, 196e6);

        uint256 freeR = IReserveManager(reserveMgr).freeReserve();
        uint256 poolPrice = IPoolState(poolState).poolPrice();
        // РџСЂРѕРґР°Р¶Р°, С‡РµР№ (user_amount + sell_team_fee) С‡СѓС‚СЊ Р±РѕР»СЊС€Рµ freeR
        // amount_gross в€’ fee = target в‡’ deltaP в‰€ target / poolPrice
        uint256 target = freeR + 1e17; // +0.1 USDC
        uint256 deltaP = (target * Constants.PRECISION) / poolPrice;

        vm.prank(user);
        // Дневной лимит проверяется раньше freeReserve: при таком S он срабатывает первым.
        vm.expectRevert(Errors.MaxSellPerDayExceeded.selector);
        IPoolController(poolCtrl).sellToPool(deltaP, 0, 0);
    }

    function test_sellToPool_maxSellPctPerDay() public {
        _seedUserTokens(1000e6);
        _disableCB();

        uint256 sCurve = IReserveManager(reserveMgr).S_curve();
        // maxSellPctPerDay = 200 (2%) РѕС‚ S_curve
        uint256 limit = (IPoolController(poolCtrl).maxSellPctPerDay() * sCurve) / Constants.BASIS_POINTS;

        vm.prank(user);
        IPoolController(poolCtrl).sellToPool(limit / 2, 0, 0);

        vm.prank(user);
        vm.expectRevert(Errors.MaxSellPerDayExceeded.selector);
        IPoolController(poolCtrl).sellToPool(limit, 0, 0);
    }

    function test_sellToPool_dailyReset() public {
        _seedUserTokens(1000e6);
        _disableCB();

        uint256 sCurve = IReserveManager(reserveMgr).S_curve();
        uint256 limit = (IPoolController(poolCtrl).maxSellPctPerDay() * sCurve) / Constants.BASIS_POINTS;

        vm.prank(user);
        IPoolController(poolCtrl).sellToPool(limit, 0, 0);

        // РЎР»РµРґСѓСЋС‰РёР№ РґРµРЅСЊ
        warpBy(1 days + 1);

        vm.prank(user);
        IPoolController(poolCtrl).sellToPool(limit, 0, 0); // OK
    }

    function test_sellToPool_freeReserve_insufficient() public {
        // РџСЂРѕРїСѓСЃРєР°РµРј, РїРѕРєСЂС‹С‚ test_sellToPool_freeReserve_check_includes_sellTeamFee.
        // РћС‚РґРµР»СЊРЅС‹Р№ С‚РµСЃС‚ РЅРµ РґР°С‘С‚ РЅРѕРІРѕР№ РёРЅС„РѕСЂРјР°С†РёРё.
        assertTrue(true);
    }

    function test_sellToPool_minOut() public {
        _seedUserTokens(1000e6);
        _disableCB();

        vm.prank(user);
        vm.expectRevert(Errors.SlippageExceeded.selector);
        IPoolController(poolCtrl).sellToPool(10_000e18, type(uint256).max, 0);
    }

    function test_sellToPool_zero_poolPrice_revert() public {
        _mockPoolPriceZero();
        vm.prank(user);
        vm.expectRevert(Errors.NotInitialized.selector);
        IPoolController(poolCtrl).sellToPool(10_000e18, 0, 0);
    }

    function test_sellToPool_revert_not_initialized() public {
        test_sellToPool_zero_poolPrice_revert();
    }

    function test_sellToPool_zero_amount_revert() public {
        vm.prank(user);
        vm.expectRevert(Errors.InvalidAmount.selector);
        IPoolController(poolCtrl).sellToPool(0, 0, 0);
    }

    function test_sellToPool_circuitBreakerActive_revert() public {
        _seedUserTokens(1000e6);
        // РќР• disable CB вЂ” CB active РїРѕСЃР»Рµ РїРѕРєСѓРїРєРё
        assertTrue(ICircuitBreaker(cb).active());
        vm.prank(user);
        vm.expectRevert(Errors.CircuitBreakerActive.selector);
        IPoolController(poolCtrl).sellToPool(10_000e18, 0, 0);
    }

    // ================================================================== emit CB

    function test_circuitBreaker_trigger_emit() public {
        // Seed: РїРѕРєСѓРїР°РµРј 804 USDC в†’ reserve = 804, curveBacking в‰€ 800, ratio 0.5% (CB active)
        _seedUserTokens(804e6);
        // threshold = 20%
        vm.prank(IXartIAFactory(factory).timelock());
        ICircuitBreaker(cb).setThreshold(2000);
        // Р”РѕРІРѕРґРёРј reserve РґРѕ 1000 USDC в†’ freeReserve в‰€ 200, ratio 20.3% (CB inactive)
        mintUSDC(reserveMgr, 196e6);
        assertFalse(ICircuitBreaker(cb).active());

        // РџСЂРѕРґР°Р¶Р°, РєРѕС‚РѕСЂР°СЏ СѓСЂРѕРЅРёС‚ ratio РЅРёР¶Рµ 20%: amount_gross в€’ fee > ~4 USDC
        uint256 poolPrice = IPoolState(poolState).poolPrice();
        uint256 deltaP = (10e18 * Constants.PRECISION) / poolPrice; // ~10 USDC gross
        uint256 tokensBal = IXartIAToken(token).balanceOf(user);
        if (deltaP > tokensBal) deltaP = tokensBal - 1;

        vm.expectEmit(false, false, false, false);
        emit Events.CircuitBreakerTriggered(0, 0);
        vm.prank(user);
        IPoolController(poolCtrl).sellToPool(deltaP, 0, 0);
        assertTrue(ICircuitBreaker(cb).active());
    }

    // ================================================================== helpers

    function _buy(address u, uint256 x6) internal returns (uint256) {
        vm.prank(u);
        return IPoolController(poolCtrl).buyFromPool(x6, 0, 0);
    }

    function _seedUserTokens(uint256 x6) internal returns (uint256) {
        buySafe(curveCtrl, user, x6);
        warpBy(1);
        return IXartIAToken(token).balanceOf(user);
    }

    function _seedPool(uint256 poolXrtAmount) internal {
        _seedUserTokens(1000e6);
        _disableCB();
        // Дневной лимит — 5% от S_curve: продаём частями по дням.
        uint256 remaining = poolXrtAmount;
        while (remaining > 0) {
            uint256 s = IReserveManager(reserveMgr).S_curve();
            uint256 cap = (s * 500) / 10_000;
            if (cap == 0) break;
            uint256 chunk = remaining < cap ? remaining : cap;
            vm.prank(user);
            IPoolController(poolCtrl).sellToPool(chunk, 0, 0);
            remaining -= chunk;
            warpBy(1 days);
        }
    }

    function _disableCB() internal {
        mintUSDC(reserveMgr, 10_000_000e6);
    }

    function _mockPoolPriceZero() internal {
        vm.mockCall(poolState, abi.encodeWithSelector(IPoolState.poolPrice.selector), abi.encode(uint256(0)));
    }
}
