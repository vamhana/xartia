// SPDX-License-Identifier: AGPL-3.0
pragma solidity 0.8.24;

import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {Errors} from "../../contracts/math/Errors.sol";
import {Roles} from "../../contracts/core/Roles.sol";
import {ICurveController} from "../../contracts/controllers/ICurveController.sol";
import {IPoolController} from "../../contracts/controllers/IPoolController.sol";
import {IXartIAToken} from "../../contracts/token/IXartIAToken.sol";
import {IXartIAFactory} from "../../contracts/factory/IXartIAFactory.sol";
import {MockUSDC} from "../utils/MockUSDC.sol";
import {TestHelpers} from "../utils/TestHelpers.sol";

/// @title PauseUnpause.t.sol — T.5.01.16
contract PauseUnpauseTest is TestHelpers {
    address internal factory;
    address internal usdc;
    address internal curveCtrl;
    address internal poolCtrl;
    address internal token;
    address internal safe;

    address internal user = address(0xA11CE);

    function setUp() public {
        setUpBase();
        safe = mockSafe();
        usdc = mockUSDC();
        factory = deployFullSystem();
        IXartIAFactory f = IXartIAFactory(factory);
        curveCtrl = f.curveController();
        poolCtrl = f.poolController();
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
    }

    function test_pause_blocks_all() public {
        vm.prank(safe);
        ICurveController(curveCtrl).pause();

        vm.prank(user);
        vm.expectRevert();
        ICurveController(curveCtrl).buyFromCurve(1000e6, 0, 0);

        vm.prank(safe);
        IPoolController(poolCtrl).pause();

        vm.prank(user);
        vm.expectRevert();
        IPoolController(poolCtrl).buyFromPool(1000e6, 0, 0);
    }

    function test_unpause_restores() public {
        vm.prank(safe);
        ICurveController(curveCtrl).pause();

        // unpause — только GOVERNANCE_ROLE (factory до finalize)
        vm.prank(safe);
        ICurveController(curveCtrl).unpause();

        vm.prank(user);
        ICurveController(curveCtrl).buyFromCurve(1000e6, 0, 0);
    }

    function test_revert_unauthorized_pause() public {
        vm.prank(user);
        vm.expectRevert();
        ICurveController(curveCtrl).pause();
    }

    function test_revert_unauthorized_unpause() public {
        vm.prank(safe);
        ICurveController(curveCtrl).pause();

        vm.prank(user);
        vm.expectRevert();
        ICurveController(curveCtrl).unpause();
    }
}
