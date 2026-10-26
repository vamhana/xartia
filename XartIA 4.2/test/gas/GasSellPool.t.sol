// SPDX-License-Identifier: AGPL-3.0
pragma solidity 0.8.24;

import {ICurveController} from "../../contracts/controllers/ICurveController.sol";
import {IPoolController} from "../../contracts/controllers/IPoolController.sol";
import {IXartIAToken} from "../../contracts/token/IXartIAToken.sol";
import {IXartIAFactory} from "../../contracts/factory/IXartIAFactory.sol";
import {MockUSDC} from "../utils/MockUSDC.sol";
import {TestHelpers} from "../utils/TestHelpers.sol";

/// @title GasSellPool.t.sol — T.6.01.04
contract GasSellPoolTest is TestHelpers {
    address internal factory;
    address internal usdc;
    address internal curveCtrl;
    address internal poolCtrl;
    address internal reserveMgr;
    address internal token;

    address internal user = address(0xA11CE);
    uint256 internal userTokens;

    uint256 internal constant GAS_LIMIT = 350_000; // via_ir: реалистичный потолок

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
        mintUSDC(reserveMgr, 10_000_000e6);

        vm.prank(user);
        userTokens = ICurveController(curveCtrl).buyFromCurve(1000e6, 0, 0);
        warpBy(1);
    }

    function test_gas_sellPool() public {
        // 1% от баланса — далеко от maxSellPctPerDay (2% от S_curve)
        uint256 sellAmount = userTokens / 100;

        vm.prank(user);
        uint256 gasBefore = gasleft();
        IPoolController(poolCtrl).sellToPool(sellAmount, 0, 0);
        uint256 gasUsed = gasBefore - gasleft();

        emit log_named_uint("gas sellToPool", gasUsed);
        assertLe(gasUsed, GAS_LIMIT, "sellToPool exceeds 350k gas");
    }
}
