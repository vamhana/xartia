// SPDX-License-Identifier: AGPL-3.0
pragma solidity 0.8.24;

import {ICurveController} from "../../contracts/controllers/ICurveController.sol";
import {IXartIAToken} from "../../contracts/token/IXartIAToken.sol";
import {IXartIAFactory} from "../../contracts/factory/IXartIAFactory.sol";
import {MockUSDC} from "../utils/MockUSDC.sol";
import {TestHelpers} from "../utils/TestHelpers.sol";

/// @title GasRedeemCurve.t.sol — T.6.01.02
contract GasRedeemCurveTest is TestHelpers {
    address internal factory;
    address internal usdc;
    address internal curveCtrl;
    address internal reserveMgr;
    address internal token;

    address internal user = address(0xA11CE);
    uint256 internal userTokens;

    uint256 internal constant GAS_LIMIT = 250_000;

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

        vm.prank(user);
        userTokens = ICurveController(curveCtrl).buyFromCurve(1000e6, 0, 0);
        warpBy(1);
    }

    function test_gas_redeem() public {
        vm.prank(user);
        uint256 gasBefore = gasleft();
        ICurveController(curveCtrl).redeemFromCurve(userTokens / 2, 0, 0);
        uint256 gasUsed = gasBefore - gasleft();

        emit log_named_uint("gas redeemFromCurve", gasUsed);
        assertLe(gasUsed, GAS_LIMIT, "redeemFromCurve exceeds 250k gas");
    }
}
