// SPDX-License-Identifier: AGPL-3.0
pragma solidity 0.8.24;

import {ICurveController} from "../../contracts/controllers/ICurveController.sol";
import {IXartIAToken} from "../../contracts/token/IXartIAToken.sol";
import {IXartIAFactory} from "../../contracts/factory/IXartIAFactory.sol";
import {MockUSDC} from "../utils/MockUSDC.sol";
import {TestHelpers} from "../utils/TestHelpers.sol";

/// @title GasBuyCurve.t.sol — T.6.01.01
contract GasBuyCurveTest is TestHelpers {
    address internal factory;
    address internal usdc;
    address internal curveCtrl;
    address internal reserveMgr;
    address internal token;

    address internal user = address(0xA11CE);

    uint256 internal constant GAS_LIMIT = 400_000; // via_ir: реалистичный потолок

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
        mintUSDC(reserveMgr, 10_000_000e6);

        // Установившееся состояние
        vm.prank(user);
        ICurveController(curveCtrl).buyFromCurve(1000e6, 0, 0);
        warpBy(1);
    }

    function test_gas_buy() public {
        vm.prank(user);
        uint256 gasBefore = gasleft();
        ICurveController(curveCtrl).buyFromCurve(100e6, 0, 0);
        uint256 gasUsed = gasBefore - gasleft();

        emit log_named_uint("gas buyFromCurve", gasUsed);
        assertLe(gasUsed, GAS_LIMIT, "buyFromCurve exceeds 400k gas");
    }
}
