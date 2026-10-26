// SPDX-License-Identifier: AGPL-3.0
pragma solidity 0.8.24;

import {IReserveManager} from "../../contracts/reserve/IReserveManager.sol";
import {ICurveController} from "../../contracts/controllers/ICurveController.sol";
import {IXartIAToken} from "../../contracts/token/IXartIAToken.sol";
import {IXartIAFactory} from "../../contracts/factory/IXartIAFactory.sol";
import {MockUSDC} from "../utils/MockUSDC.sol";
import {TestHelpers} from "../utils/TestHelpers.sol";

/// @title LevelDowngrade.t.sol — T.5.01.10
/// @notice Проверка R(S) при пересечении границы уровня вниз (redeemFromCurve).
contract LevelDowngradeTest is TestHelpers {
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

    function test_downgrade() public {
        // Покупка > S_end_0 → переход на уровень 1 (S > 50_000e18)
        // X = 200e6 → ΔS ≈ 99_500e18 > 50_000e18
        buySafe(curveCtrl, user, 200e6);
        warpBy(1);

        uint256 s1 = IReserveManager(reserveMgr).S_curve();
        assertGt(s1, 50_000e18);
        assertEq(ICurveController(curveCtrl).S_curve(), s1);

        // Redeem обратно через границу: продаём столько, чтобы S упал ниже 50_000e18
        uint256 bal = IXartIAToken(token).balanceOf(user);
        uint256 amountToSell = s1 - 30_000e18; // вернёт S на 30_000e18 (< 50_000e18)

        vm.prank(user);
        ICurveController(curveCtrl).redeemFromCurve(amountToSell, 0, 0);

        uint256 s2 = IReserveManager(reserveMgr).S_curve();
        assertLt(s2, 50_000e18);

        // Инвариант держится
        assertGe(IReserveManager(reserveMgr).reserve(), IReserveManager(reserveMgr).curveBacking());
    }

    function test_downgrade_R_consistency() public {
        // Купить, продать, купить снова. R(S) должен быть консистентен.
        buySafe(curveCtrl, user, 200e6);
        warpBy(1);

        uint256 bal = IXartIAToken(token).balanceOf(user);
        vm.prank(user);
        ICurveController(curveCtrl).redeemFromCurve(bal / 2, 0, 0);

        // После продажи — R(S) уменьшился, но не до нуля
        uint256 cb1 = IReserveManager(reserveMgr).curveBacking();
        assertGt(cb1, 0);

        // Новая покупка — R(S) снова растёт
        buySafe(curveCtrl, user, 50e6);

        uint256 cb2 = IReserveManager(reserveMgr).curveBacking();
        assertGt(cb2, cb1);
    }
}
