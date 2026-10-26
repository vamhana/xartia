// SPDX-License-Identifier: AGPL-3.0
pragma solidity 0.8.24;

import {ICurveController} from "../../contracts/controllers/ICurveController.sol";
import {IPoolController} from "../../contracts/controllers/IPoolController.sol";
import {IXartIAToken} from "../../contracts/token/IXartIAToken.sol";
import {IXartIAFactory} from "../../contracts/factory/IXartIAFactory.sol";
import {MockUSDC} from "../utils/MockUSDC.sol";
import {TestHelpers} from "../utils/TestHelpers.sol";

/// @title GasBuyPool.t.sol — T.6.01.03
/// @notice buyFromPool ≤ 200 000 gas (путь без каскада — pool покрывает покупку).
contract GasBuyPoolTest is TestHelpers {
    address internal factory;
    address internal usdc;
    address internal curveCtrl;
    address internal poolCtrl;
    address internal reserveMgr;
    address internal token;

    address internal user = address(0xA11CE);
    address internal user2 = address(0xB0B);

    uint256 internal constant GAS_LIMIT = 200_000;

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
        mintUSDC(user2, 10_000_000e6);
        for (uint256 i = 0; i < 2; i++) {
            address u = i == 0 ? user : user2;
            vm.prank(u);
            MockUSDC(usdc).approve(curveCtrl, type(uint256).max);
            vm.prank(u);
            MockUSDC(usdc).approve(poolCtrl, type(uint256).max);
            vm.prank(u);
            IXartIAToken(token).approve(curveCtrl, type(uint256).max);
            vm.prank(u);
            IXartIAToken(token).approve(poolCtrl, type(uint256).max);
        }
        mintUSDC(reserveMgr, 10_000_000e6);

        // Seed: user покупает и заполняет pool через 10 ежедневных продаж
        vm.prank(user);
        ICurveController(curveCtrl).buyFromCurve(500e6, 0, 0);
        warpBy(1);
        for (uint256 i = 0; i < 10; i++) {
            warpBy(1 days + 1); // сбрасываем dailySold
            vm.prank(user);
            IPoolController(poolCtrl).sellToPool(6_000e18, 0, 0);
        }
    }

    function test_gas_buyPool() public {
        vm.prank(user2);
        uint256 gasBefore = gasleft();
        IPoolController(poolCtrl).buyFromPool(100e6, 0, 0);
        uint256 gasUsed = gasBefore - gasleft();

        emit log_named_uint("gas buyFromPool", gasUsed);
        assertLe(gasUsed, GAS_LIMIT, "buyFromPool exceeds 200k gas");
    }
}
