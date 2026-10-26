// SPDX-License-Identifier: AGPL-3.0
pragma solidity 0.8.24;

import {Types} from "../../contracts/math/Types.sol";
import {CurveMath} from "../../contracts/math/CurveMath.sol";
import {ILevels} from "../../contracts/math/ILevels.sol";
import {IReserveManager} from "../../contracts/reserve/IReserveManager.sol";
import {IPoolState} from "../../contracts/math/IPoolState.sol";
import {ICurveController} from "../../contracts/controllers/ICurveController.sol";
import {IPoolController} from "../../contracts/controllers/IPoolController.sol";
import {IXartIAToken} from "../../contracts/token/IXartIAToken.sol";
import {IXartIAFactory} from "../../contracts/factory/IXartIAFactory.sol";
import {MockUSDC} from "../utils/MockUSDC.sol";
import {TestHelpers} from "../utils/TestHelpers.sol";

/// @title FullCycle.t.sol — T.4.01.01
contract FullCycleTest is TestHelpers {
    address internal factory;
    address internal usdc;
    address internal curveCtrl;
    address internal poolCtrl;
    address internal reserveMgr;
    address internal poolState;
    address internal levelsAddr;
    address internal token;

    address internal alice = address(0xA11CE);
    address internal bob = address(0xB0B);
    address internal carol = address(0xCAFE);

    function setUp() public {
        setUpBase();
        usdc = mockUSDC();
        factory = deployFullSystem();
        IXartIAFactory f = IXartIAFactory(factory);
        curveCtrl = f.curveController();
        poolCtrl = f.poolController();
        reserveMgr = f.reserveManager();
        poolState = f.poolState();
        levelsAddr = f.levels();
        token = f.token();

        address[3] memory users = [alice, bob, carol];
        for (uint256 i = 0; i < 3; i++) {
            address u = users[i];
            mintUSDC(u, 10_000_000e6);
            vm.prank(u);
            MockUSDC(usdc).approve(curveCtrl, type(uint256).max);
            vm.prank(u);
            MockUSDC(usdc).approve(poolCtrl, type(uint256).max);
            vm.prank(u);
            IXartIAToken(token).approve(curveCtrl, type(uint256).max);
            vm.prank(u);
            IXartIAToken(token).approve(poolCtrl, type(uint256).max);
        }
    }

    function test_fullCycle() public {
        // 1. mint — alice покупает на 100 USDC
        vm.prank(alice);
        uint256 aliceTokens = ICurveController(curveCtrl).buyFromCurve(100e6, 0, 0);
        assertGt(aliceTokens, 0);
        _checkInvariants("after alice buy");
        warpBy(1);

        // 2. pool — alice продаёт половину в pool
        mintUSDC(reserveMgr, 10_000_000e6); // disable CB
        vm.prank(alice);
        IPoolController(poolCtrl).sellToPool(aliceTokens / 50, 0, 0);
        assertGt(IPoolState(poolState).pool(), 0);
        _checkInvariants("after alice sellToPool");
        warpBy(1 days);

        // 3. pool buy — bob покупает из pool
        vm.prank(bob);
        uint256 bobTokens = IPoolController(poolCtrl).buyFromPool(8e6, 0, 0);
        assertGt(bobTokens, 0);
        _checkInvariants("after bob buyFromPool");
        warpBy(1);

        // 4. curve redeem — bob продаёт через кривую
        vm.prank(bob);
        ICurveController(curveCtrl).redeemFromCurve(bobTokens, 0, 0);
        _checkInvariants("after bob redeemFromCurve");
        warpBy(1);

        // 5. mint снова + level transition (граница 50_000e18)
        buySafe(curveCtrl, carol, 500e6);
        uint256 sAfter = IReserveManager(reserveMgr).S_curve();
        assertGt(sAfter, 50_000e18, "did not cross level boundary");
        _checkInvariants("after carol level transition");
        warpBy(1);

        // 6. pool — carol продаёт часть в pool
        uint256 carolBal = IXartIAToken(token).balanceOf(carol);
        vm.prank(carol);
        IPoolController(poolCtrl).sellToPool(carolBal / 100, 0, 0);
        _checkInvariants("after carol sellToPool");
        warpBy(1 days);

        // 7. redeem — alice продаёт остаток через кривую
        uint256 aliceLeft = IXartIAToken(token).balanceOf(alice);
        vm.prank(alice);
        ICurveController(curveCtrl).redeemFromCurve(aliceLeft, 0, 0);
        _checkInvariants("after alice redeemFromCurve");
    }

    // ------------------------------------------------------------------ internal

    function _checkInvariants(string memory tag) internal view {
        assertGe(
            IReserveManager(reserveMgr).reserve(),
            IReserveManager(reserveMgr).curveBacking(),
            string.concat(tag, ": reserve < curveBacking")
        );
        assertEq(
            IXartIAToken(token).totalSupply(),
            IReserveManager(reserveMgr).S_curve(),
            string.concat(tag, ": supply != S_curve")
        );

        uint256 price = IPoolState(poolState).poolPrice();
        if (price > 0) {
            uint256 pS = _calcP(IReserveManager(reserveMgr).S_curve());
            uint256 lower = (pS * 10_000) / 11_000;
            uint256 upper = (pS * 11_000) / 10_000;
            assertGe(price, lower, string.concat(tag, ": poolPrice < floor"));
            assertLe(price, upper, string.concat(tag, ": poolPrice > ceiling"));
        }

        assertEq(MockUSDC(usdc).balanceOf(poolCtrl), 0, string.concat(tag, ": PoolController holds USDC"));
    }

    function _calcP(uint256 S) internal view returns (uint256) {
        Types.Level[] memory lv = ILevels(levelsAddr).all();
        return CurveMath.P(S, lv);
    }
}
