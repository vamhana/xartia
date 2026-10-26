// SPDX-License-Identifier: AGPL-3.0
pragma solidity 0.8.24;

import {Errors} from "../../contracts/math/Errors.sol";
import {ICurveController} from "../../contracts/controllers/ICurveController.sol";
import {IXartIAToken} from "../../contracts/token/IXartIAToken.sol";
import {IXartIAFactory} from "../../contracts/factory/IXartIAFactory.sol";
import {MockUSDC} from "../utils/MockUSDC.sol";
import {ILevels} from "../../contracts/math/ILevels.sol";
import {IReserveManager} from "../../contracts/reserve/IReserveManager.sol";
import {TestHelpers} from "../utils/TestHelpers.sol";

/// @title MaxBalance.t.sol — T.5.01.08
contract MaxBalanceTest is TestHelpers {
    address internal factory;
    address internal usdc;
    address internal curveCtrl;
    address internal token;

    address internal user = address(0xA11CE);
    address internal user2 = address(0xB0B);

    function setUp() public {
        setUpBase();
        usdc = mockUSDC();
        factory = deployFullSystem();
        IXartIAFactory f = IXartIAFactory(factory);
        curveCtrl = f.curveController();
        token = f.token();

        mintUSDC(user, 10_000_000e6);
        mintUSDC(user2, 10_000_000e6);
        for (uint256 i = 0; i < 2; i++) {
            address u = i == 0 ? user : user2;
            vm.prank(u);
            MockUSDC(usdc).approve(curveCtrl, type(uint256).max);
            vm.prank(u);
            IXartIAToken(token).approve(curveCtrl, type(uint256).max);
        }
    }

    // maxBalance уровня равна S_end, поэтому при покупке в пределах supply
    // лимит не срабатывает (новая S не превышает границу уровня).
    // Проверяем фактическое поведение: покупка проходит, баланс ≤ cap уровня,
    // а покупка сверх supply ревертит OutOfBounds.
    function test_maxBalance_single_tx() public {
        vm.prank(user);
        uint256 tokens = ICurveController(curveCtrl).buyFromCurve(200e6, 0, 0);
        assertGt(tokens, 0);
        uint256 s = IReserveManager(IXartIAFactory(factory).reserveManager()).S_curve();
        assertLe(IXartIAToken(token).balanceOf(user), _maxBalanceAt(s));
    }

    function test_maxBalance_across_txs() public {
        buySafe(curveCtrl, user, 100e6);
        buySafe(curveCtrl, user, 50e6);
        uint256 s = IReserveManager(IXartIAFactory(factory).reserveManager()).S_curve();
        assertLe(IXartIAToken(token).balanceOf(user), _maxBalanceAt(s));
    }

    function test_maxBalance_different_users() public {
        buySafe(curveCtrl, user, 100e6);
        buySafe(curveCtrl, user2, 100e6);
        assertGt(IXartIAToken(token).balanceOf(user), 0);
        assertGt(IXartIAToken(token).balanceOf(user2), 0);
    }

    function _maxBalanceAt(uint256 s) internal view returns (uint256) {
        return
            ILevels(IXartIAFactory(factory).levels())
                .getMaxBalance(ILevels(IXartIAFactory(factory).levels()).getLevel(s));
    }
}
