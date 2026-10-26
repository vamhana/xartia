// SPDX-License-Identifier: AGPL-3.0
pragma solidity 0.8.24;

import {IReserveManager} from "../../contracts/reserve/IReserveManager.sol";
import {ICurveController} from "../../contracts/controllers/ICurveController.sol";
import {IXartIAToken} from "../../contracts/token/IXartIAToken.sol";
import {IXartIAFactory} from "../../contracts/factory/IXartIAFactory.sol";
import {MockUSDC} from "../utils/MockUSDC.sol";
import {TestHelpers} from "../utils/TestHelpers.sol";

/// @title MassExit.t.sol — T.5.01.01
/// @notice 10%, 25%, 50%, 80%, 100% держателей выходят. Инвариант reserve ≥ R(S_curve) держится.
contract MassExitTest is TestHelpers {
    address internal factory;
    address internal usdc;
    address internal curveCtrl;
    address internal reserveMgr;
    address internal token;

    address[] internal holders;

    function setUp() public {
        setUpBase();
        usdc = mockUSDC();
        factory = deployFullSystem();
        IXartIAFactory f = IXartIAFactory(factory);
        curveCtrl = f.curveController();
        reserveMgr = f.reserveManager();
        token = f.token();

        // 10 держателей, каждый покупает на 500 USDC
        for (uint256 i = 0; i < 10; i++) {
            address h = address(uint160(0xA000 + i));
            holders.push(h);
            mintUSDC(h, 10_000e6);
            vm.prank(h);
            MockUSDC(usdc).approve(curveCtrl, type(uint256).max);
            vm.prank(h);
            IXartIAToken(token).approve(curveCtrl, type(uint256).max);
            buySafe(curveCtrl, h, 500e6);
        }
        warpBy(1);
    }

    function _exitPct(uint256 pct) internal {
        uint256 n = (holders.length * pct) / 100;
        for (uint256 i = 0; i < n; i++) {
            uint256 bal = IXartIAToken(token).balanceOf(holders[i]);
            if (bal == 0) continue;
            vm.prank(holders[i]);
            IXartIAToken(token).approve(curveCtrl, type(uint256).max);
            vm.prank(holders[i]);
            ICurveController(curveCtrl).redeemFromCurve(bal, 0, 0);
            // Инвариант после каждого выхода
            assertGe(
                IReserveManager(reserveMgr).reserve(),
                IReserveManager(reserveMgr).curveBacking(),
                "invariant broken during mass exit"
            );
        }
    }

    function test_massExit_10() public {
        _exitPct(10);
    }

    function test_massExit_25() public {
        _exitPct(25);
    }

    function test_massExit_50() public {
        _exitPct(50);
    }

    function test_massExit_80() public {
        _exitPct(80);
    }

    function test_massExit_100() public {
        _exitPct(100);
    }
}
