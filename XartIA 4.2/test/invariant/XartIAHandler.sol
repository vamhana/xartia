// SPDX-License-Identifier: AGPL-3.0
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";

import {Constants} from "../../contracts/math/Constants.sol";
import {Types} from "../../contracts/math/Types.sol";
import {CurveMath} from "../../contracts/math/CurveMath.sol";
import {ILevels} from "../../contracts/math/ILevels.sol";
import {IPoolState} from "../../contracts/math/IPoolState.sol";
import {IXartIAToken} from "../../contracts/token/IXartIAToken.sol";
import {IReserveManager} from "../../contracts/reserve/IReserveManager.sol";
import {ICurveController} from "../../contracts/controllers/ICurveController.sol";
import {IPoolController} from "../../contracts/controllers/IPoolController.sol";
import {ICircuitBreaker} from "../../contracts/safety/ICircuitBreaker.sol";
import {IXartIAFactory} from "../../contracts/factory/IXartIAFactory.sol";
import {MockUSDC} from "../utils/MockUSDC.sol";

/// @title XartIAHandler — fuzz-target для invariant-тестов
/// @notice Все mutation-action'ы обёрнуты в try/catch: revert от бизнес-правил
///         (CB.active, maxBalance, maxPurchasePct, freeReserve, minimalPurchase)
///         не валит invariant. Успешные операции → проверка инвариантов.
/// @dev Ghost variables: ghost_treasuryMax (монотонность treasury),
///      ghost_lastSellPriceBefore/After (монотонность poolPrice при sellToPool).
contract XartIAHandler is Test {
    IXartIAFactory public immutable factory;
    IXartIAToken public immutable token;
    ICurveController public immutable curveController;
    IPoolController public immutable poolController;
    IReserveManager public immutable reserveManager;
    IPoolState public immutable poolState;
    ICircuitBreaker public immutable circuitBreaker;
    address public immutable usdc;
    address public immutable treasury;
    address public immutable levels;

    address[] public actors;

    // --- ghosts ---
    uint256 public ghost_treasuryMax;
    uint256 public ghost_lastSellPriceBefore;
    uint256 public ghost_lastSellPriceAfter;

    constructor(address factory_, address usdc_, address[] memory actors_) {
        factory = IXartIAFactory(factory_);
        token = IXartIAToken(factory.token());
        curveController = ICurveController(factory.curveController());
        poolController = IPoolController(factory.poolController());
        reserveManager = IReserveManager(factory.reserveManager());
        poolState = IPoolState(factory.poolState());
        circuitBreaker = ICircuitBreaker(factory.circuitBreaker());
        usdc = usdc_;
        treasury = factory.treasury();
        levels = factory.levels();

        for (uint256 i = 0; i < actors_.length; i++) {
            actors.push(actors_[i]);
        }

        ghost_treasuryMax = MockUSDC(usdc).balanceOf(treasury);
    }

    // ================================================================== actions

    function buyFromCurve(uint256 actorSeed, uint256 amountSeed) external {
        address actor = _pickActor(actorSeed);
        uint256 x6 = _boundX6(actor, amountSeed);
        if (x6 == 0) return;

        vm.prank(actor);
        try curveController.buyFromCurve(x6, 0, 0) {} catch {}
        _updateTreasuryGhost();
    }

    function buyFromPool(uint256 actorSeed, uint256 amountSeed) external {
        address actor = _pickActor(actorSeed);
        uint256 x6 = _boundX6(actor, amountSeed);
        if (x6 == 0) return;

        vm.prank(actor);
        try poolController.buyFromPool(x6, 0, 0) {} catch {}
        _updateTreasuryGhost();
    }

    function redeemFromCurve(uint256 actorSeed, uint256 amountSeed) external {
        address actor = _pickActor(actorSeed);
        uint256 bal = token.balanceOf(actor);
        if (bal == 0) return;
        uint256 deltaS = bound(amountSeed, 1, bal);

        vm.prank(actor);
        try curveController.redeemFromCurve(deltaS, 0, 0) {} catch {}
        _updateTreasuryGhost();
    }

    function sellToPool(uint256 actorSeed, uint256 amountSeed) external {
        if (circuitBreaker.active()) return;

        address actor = _pickActor(actorSeed);
        uint256 bal = token.balanceOf(actor);
        if (bal == 0) return;

        uint256 sCurve = reserveManager.S_curve();
        if (sCurve == 0) return;
        uint256 dailyLimit = (200 * sCurve) / Constants.BASIS_POINTS;
        uint256 cap = bal < dailyLimit ? bal : dailyLimit;
        if (cap == 0) return;
        uint256 deltaP = bound(amountSeed, 1, cap);

        uint256 priceBefore = poolState.poolPrice();

        vm.prank(actor);
        try poolController.sellToPool(deltaP, 0, 0) {
            ghost_lastSellPriceBefore = priceBefore;
            ghost_lastSellPriceAfter = poolState.poolPrice();
        } catch {}
        _updateTreasuryGhost();
    }

    function warp(uint256 secs) external {
        secs = bound(secs, 1, 1 days);
        vm.warp(block.timestamp + secs);
    }

    // ================================================================== views

    function actorsLength() external view returns (uint256) {
        return actors.length;
    }

    // ================================================================== internal

    function _pickActor(uint256 seed) internal view returns (address) {
        return actors[seed % actors.length];
    }

    function _boundX6(address actor, uint256 seed) internal view returns (uint256) {
        uint256 minX6 = curveController.effectiveMinimalX6();
        uint256 balX6 = MockUSDC(usdc).balanceOf(actor);
        if (balX6 < minX6) return 0;

        uint256 capX6 = balX6;
        uint256 sCurve = reserveManager.S_curve();
        if (sCurve > 0) {
            Types.Level[] memory lv = ILevels(levels).all();
            uint256 pS = CurveMath.P(sCurve, lv);
            if (pS == 0) return 0;
            uint256 maxDeltaS = (500 * sCurve) / Constants.BASIS_POINTS; // maxPurchasePct = 500
            // X_6 ≈ maxDeltaS * pS / 1e30, с поправкой на buyFee
            uint256 rawX6 = (maxDeltaS * pS) / 1e30;
            uint256 buyFee = curveController.buyFee();
            capX6 = (rawX6 * Constants.BASIS_POINTS) / (Constants.BASIS_POINTS - buyFee);
        }
        if (capX6 < minX6) return 0;
        if (capX6 > balX6) capX6 = balX6;

        return bound(seed, minX6, capX6);
    }

    function _updateTreasuryGhost() internal {
        uint256 bal = MockUSDC(usdc).balanceOf(treasury);
        if (bal > ghost_treasuryMax) ghost_treasuryMax = bal;
    }
}
