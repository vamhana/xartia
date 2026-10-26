// SPDX-License-Identifier: AGPL-3.0
pragma solidity 0.8.24;

import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";

import {Roles} from "../../contracts/core/Roles.sol";
import {IXartIAFactory} from "../../contracts/factory/IXartIAFactory.sol";
import {IXartIAToken} from "../../contracts/token/IXartIAToken.sol";
import {TestHelpers} from "../utils/TestHelpers.sol";

/// @title AccessControl.t.sol — T.1.01.18
/// @notice Проверки ролей после finalize. Комплексные тесты:
///         - factory_has_no_roles_after_finalize
///         - treasury_has_no_roles
///         - отдельные роли выданы нужным адресам
contract AccessControlTest is TestHelpers {
    address internal factory;
    address internal token;
    address internal curveCtrl;
    address internal poolCtrl;
    address internal reserveMgr;
    address internal vesting;
    address internal cb;
    address internal governance;
    address internal timelock;
    address internal poolState;
    address internal safe;
    address internal treasury;

    function setUp() public {
        factory = deployFullSystemFinalized();
        safe = mockSafe();
        treasury = mockTreasury();
        IXartIAFactory f = IXartIAFactory(factory);
        token = f.token();
        curveCtrl = f.curveController();
        poolCtrl = f.poolController();
        reserveMgr = f.reserveManager();
        vesting = f.vesting();
        cb = f.circuitBreaker();
        governance = f.governance();
        timelock = f.timelock();
        poolState = f.poolState();
    }

    function test_minter_role() public view {
        assertTrue(IAccessControl(token).hasRole(Roles.MINTER_ROLE, curveCtrl));
    }

    function test_burner_role() public view {
        assertTrue(IAccessControl(token).hasRole(Roles.BURNER_ROLE, curveCtrl));
    }

    function test_controller_role() public view {
        assertTrue(IAccessControl(reserveMgr).hasRole(Roles.CONTROLLER_ROLE, curveCtrl));
        assertTrue(IAccessControl(reserveMgr).hasRole(Roles.CONTROLLER_ROLE, poolCtrl));
    }

    function test_governance_role() public view {
        assertTrue(IAccessControl(curveCtrl).hasRole(Roles.GOVERNANCE_ROLE, timelock));
        assertTrue(IAccessControl(poolCtrl).hasRole(Roles.GOVERNANCE_ROLE, timelock));
        assertTrue(IAccessControl(cb).hasRole(Roles.GOVERNANCE_ROLE, timelock));
        assertTrue(IAccessControl(timelock).hasRole(Roles.GOVERNANCE_ROLE, governance));
    }

    function test_pauser_role() public view {
        assertTrue(IAccessControl(curveCtrl).hasRole(Roles.PAUSER_ROLE, safe));
        assertTrue(IAccessControl(poolCtrl).hasRole(Roles.PAUSER_ROLE, safe));
    }

    /// @notice После finalize DEFAULT_ADMIN_ROLE нет ни у кого: роли неизменяемы,
    ///         поэтому резерв нельзя вывести через выдачу CONTROLLER_ROLE.
    function test_no_default_admin_after_finalize() public view {
        assertFalse(IAccessControl(token).hasRole(Roles.DEFAULT_ADMIN_ROLE, safe));
        assertFalse(IAccessControl(curveCtrl).hasRole(Roles.DEFAULT_ADMIN_ROLE, safe));
        assertFalse(IAccessControl(poolCtrl).hasRole(Roles.DEFAULT_ADMIN_ROLE, safe));
        assertFalse(IAccessControl(reserveMgr).hasRole(Roles.DEFAULT_ADMIN_ROLE, safe));
        assertFalse(IAccessControl(vesting).hasRole(Roles.DEFAULT_ADMIN_ROLE, safe));
        assertFalse(IAccessControl(cb).hasRole(Roles.DEFAULT_ADMIN_ROLE, safe));
        assertFalse(IAccessControl(governance).hasRole(Roles.DEFAULT_ADMIN_ROLE, safe));
        assertFalse(IAccessControl(timelock).hasRole(Roles.DEFAULT_ADMIN_ROLE, safe));
        assertFalse(IAccessControl(poolState).hasRole(Roles.DEFAULT_ADMIN_ROLE, safe));
        assertFalse(IAccessControl(curveCtrl).hasRole(Roles.DEFAULT_ADMIN_ROLE, factory));
    }

    function test_revert_unauthorized_all() public {
        // Пользователь без ролей не может вызвать админ-функции
        address user = address(0xBAD);

        vm.prank(user);
        vm.expectRevert();
        IAccessControl(token).grantRole(Roles.MINTER_ROLE, user);

        vm.prank(user);
        vm.expectRevert();
        IAccessControl(curveCtrl).grantRole(Roles.GOVERNANCE_ROLE, user);

        vm.prank(user);
        vm.expectRevert();
        IAccessControl(poolCtrl).grantRole(Roles.GOVERNANCE_ROLE, user);
    }

    function test_factory_has_no_roles_after_finalize() public view {
        // token
        assertFalse(IAccessControl(token).hasRole(Roles.MINTER_ROLE, factory));
        assertFalse(IAccessControl(token).hasRole(Roles.BURNER_ROLE, factory));
        assertFalse(IAccessControl(token).hasRole(Roles.DEFAULT_ADMIN_ROLE, factory));
        // curveController
        assertFalse(IAccessControl(curveCtrl).hasRole(Roles.GOVERNANCE_ROLE, factory));
        assertFalse(IAccessControl(curveCtrl).hasRole(Roles.PAUSER_ROLE, factory));
        assertFalse(IAccessControl(curveCtrl).hasRole(Roles.DEFAULT_ADMIN_ROLE, factory));
        // poolController
        assertFalse(IAccessControl(poolCtrl).hasRole(Roles.GOVERNANCE_ROLE, factory));
        assertFalse(IAccessControl(poolCtrl).hasRole(Roles.PAUSER_ROLE, factory));
        assertFalse(IAccessControl(poolCtrl).hasRole(Roles.DEFAULT_ADMIN_ROLE, factory));
        // reserveManager
        assertFalse(IAccessControl(reserveMgr).hasRole(Roles.CONTROLLER_ROLE, factory));
        assertFalse(IAccessControl(reserveMgr).hasRole(Roles.DEFAULT_ADMIN_ROLE, factory));
        // vesting
        assertFalse(IAccessControl(vesting).hasRole(Roles.MINTER_ROLE, factory));
        assertFalse(IAccessControl(vesting).hasRole(Roles.DEFAULT_ADMIN_ROLE, factory));
        // circuitBreaker
        assertFalse(IAccessControl(cb).hasRole(Roles.GOVERNANCE_ROLE, factory));
        assertFalse(IAccessControl(cb).hasRole(Roles.DEFAULT_ADMIN_ROLE, factory));
        // governance
        assertFalse(IAccessControl(governance).hasRole(Roles.DEFAULT_ADMIN_ROLE, factory));
        // timelock
        assertFalse(IAccessControl(timelock).hasRole(Roles.GOVERNANCE_ROLE, factory));
        assertFalse(IAccessControl(timelock).hasRole(Roles.DEFAULT_ADMIN_ROLE, factory));
        // poolState
        assertFalse(IAccessControl(poolState).hasRole(Roles.POOL_WRITER_ROLE, factory));
        assertFalse(IAccessControl(poolState).hasRole(Roles.PRICE_WRITER_ROLE, factory));
        assertFalse(IAccessControl(poolState).hasRole(Roles.DEFAULT_ADMIN_ROLE, factory));
    }

    function test_treasury_has_no_roles() public view {
        // treasury не имеет ни одной роли ни в одном из 9 контрактов
        assertFalse(IAccessControl(token).hasRole(Roles.MINTER_ROLE, treasury));
        assertFalse(IAccessControl(token).hasRole(Roles.BURNER_ROLE, treasury));
        assertFalse(IAccessControl(token).hasRole(Roles.DEFAULT_ADMIN_ROLE, treasury));

        assertFalse(IAccessControl(curveCtrl).hasRole(Roles.GOVERNANCE_ROLE, treasury));
        assertFalse(IAccessControl(curveCtrl).hasRole(Roles.PAUSER_ROLE, treasury));
        assertFalse(IAccessControl(curveCtrl).hasRole(Roles.DEFAULT_ADMIN_ROLE, treasury));

        assertFalse(IAccessControl(poolCtrl).hasRole(Roles.GOVERNANCE_ROLE, treasury));
        assertFalse(IAccessControl(poolCtrl).hasRole(Roles.PAUSER_ROLE, treasury));
        assertFalse(IAccessControl(poolCtrl).hasRole(Roles.DEFAULT_ADMIN_ROLE, treasury));

        assertFalse(IAccessControl(reserveMgr).hasRole(Roles.CONTROLLER_ROLE, treasury));
        assertFalse(IAccessControl(reserveMgr).hasRole(Roles.DEFAULT_ADMIN_ROLE, treasury));

        assertFalse(IAccessControl(vesting).hasRole(Roles.MINTER_ROLE, treasury));
        assertFalse(IAccessControl(vesting).hasRole(Roles.DEFAULT_ADMIN_ROLE, treasury));

        assertFalse(IAccessControl(cb).hasRole(Roles.GOVERNANCE_ROLE, treasury));
        assertFalse(IAccessControl(cb).hasRole(Roles.DEFAULT_ADMIN_ROLE, treasury));

        assertFalse(IAccessControl(governance).hasRole(Roles.DEFAULT_ADMIN_ROLE, treasury));

        assertFalse(IAccessControl(timelock).hasRole(Roles.GOVERNANCE_ROLE, treasury));
        assertFalse(IAccessControl(timelock).hasRole(Roles.DEFAULT_ADMIN_ROLE, treasury));

        assertFalse(IAccessControl(poolState).hasRole(Roles.POOL_WRITER_ROLE, treasury));
        assertFalse(IAccessControl(poolState).hasRole(Roles.PRICE_WRITER_ROLE, treasury));
        assertFalse(IAccessControl(poolState).hasRole(Roles.DEFAULT_ADMIN_ROLE, treasury));
    }
}
