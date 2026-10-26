// SPDX-License-Identifier: AGPL-3.0
pragma solidity 0.8.24;

import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";

import {Roles} from "../../contracts/core/Roles.sol";
import {Constants} from "../../contracts/math/Constants.sol";
import {Errors} from "../../contracts/math/Errors.sol";
import {Types} from "../../contracts/math/Types.sol";
import {ILevels} from "../../contracts/math/ILevels.sol";
import {IPoolState} from "../../contracts/math/IPoolState.sol";
import {IOwnable} from "../../contracts/core/IOwnable.sol";
import {IParameterRegistry} from "../../contracts/core/IParameterRegistry.sol";
import {IReserveManager} from "../../contracts/reserve/IReserveManager.sol";
import {ICurveController} from "../../contracts/controllers/ICurveController.sol";
import {IPoolController} from "../../contracts/controllers/IPoolController.sol";
import {XartIAFactory} from "../../contracts/factory/XartIAFactory.sol";
import {IXartIAFactory} from "../../contracts/factory/IXartIAFactory.sol";
import {Events} from "../../contracts/events/Events.sol";
import {TestHelpers} from "../utils/TestHelpers.sol";

/// @title XartIAFactory.t.sol — T.1.01.13
contract XartIAFactoryTest is TestHelpers {
    XartIAFactory internal f;
    address internal safe;
    address internal treasury;
    address internal usdc;

    function setUp() public {
        setUpBase();
        safe = mockSafe();
        treasury = mockTreasury();
        usdc = mockUSDC();
        f = new XartIAFactory();
    }

    // ================================================================== deploy — success

    function test_deploy() public {
        (address cc, address pc, address cmw) = f.deploy(safe, treasury, 1000, usdc);
        assertTrue(cc != address(0));
        assertTrue(pc != address(0));
        assertTrue(cmw != address(0));
    }

    function test_deploy_with_args() public {
        // Валидный deploy с полным набором аргументов (не должно быть revert)
        f.deploy(safe, treasury, 1500, usdc);
    }

    function test_deploy_returns_three_addresses() public {
        (address cc, address pc, address cmw) = f.deploy(safe, treasury, 1000, usdc);
        assertEq(cc, f.curveController());
        assertEq(pc, f.poolController());
        assertEq(cmw, f.curveMathWrapper());
    }

    function test_deploy_stores_state_variables() public {
        f.deploy(safe, treasury, 1000, usdc);
        assertTrue(f.token() != address(0));
        assertTrue(f.levels() != address(0));
        assertTrue(f.registry() != address(0));
        assertTrue(f.poolState() != address(0));
        assertTrue(f.reserveManager() != address(0));
        assertTrue(f.vesting() != address(0));
        assertTrue(f.circuitBreaker() != address(0));
        assertTrue(f.governance() != address(0));
        assertTrue(f.timelock() != address(0));
        assertEq(f.treasury(), treasury);
    }

    function test_deploy_initial_params_set() public {
        (address cc, address pc,) = f.deploy(safe, treasury, 1000, usdc);
        assertEq(ICurveController(cc).buyFee(), 50);
        assertEq(ICurveController(cc).redeemFee(), 50);
        assertEq(ICurveController(cc).maxPurchasePct(), 1000); // 10% — как в спецификации
        assertEq(ICurveController(cc).minimalPurchase(), 1e6);
        assertEq(ICurveController(cc).sellTeamFee(), 10);
        // PoolController.maxSellPctPerDay через interface не выставлен — читаем прокси-методом
        (bool ok, bytes memory data) = pc.staticcall(abi.encodeWithSignature("maxSellPctPerDay()"));
        require(ok, "maxSellPctPerDay");
        assertEq(abi.decode(data, (uint256)), 500); // 5% — как в спецификации
    }

    function test_deploy_calls_setPoolController() public {
        (address cc, address pc,) = f.deploy(safe, treasury, 1000, usdc);
        assertEq(ICurveController(cc).poolController(), pc);
    }

    function test_deploy_sets_treasury() public {
        (address cc, address pc,) = f.deploy(safe, treasury, 1000, usdc);
        assertEq(f.treasury(), treasury);
        assertEq(ICurveController(cc).treasury(), treasury);
        assertEq(IPoolController(pc).treasury(), treasury);
    }

    function test_deploy_sets_sellTeamFee_default() public {
        (address cc,,) = f.deploy(safe, treasury, 1000, usdc);
        assertEq(ICurveController(cc).sellTeamFee(), 10);
    }

    function test_deploy_emits_event() public {
        vm.expectEmit(true, false, false, false);
        emit Events.Deploy(address(f), address(0), address(0), address(0), safe, treasury, address(0));
        f.deploy(safe, treasury, 1000, usdc);
    }

    // ================================================================== deploy — validation

    function test_deploy_revert_safe_is_eoa() public {
        vm.expectRevert(Errors.InvalidAddress.selector);
        f.deploy(address(0xE0A), treasury, 1000, usdc);
    }

    function test_deploy_revert_safe_is_zero() public {
        vm.expectRevert(Errors.InvalidAddress.selector);
        f.deploy(address(0), treasury, 1000, usdc);
    }

    function test_deploy_revert_safe_is_this() public {
        vm.expectRevert(Errors.InvalidAddress.selector);
        f.deploy(address(f), treasury, 1000, usdc);
    }

    function test_deploy_revert_usdc_is_zero() public {
        vm.expectRevert(Errors.InvalidAddress.selector);
        f.deploy(safe, treasury, 1000, address(0));
    }

    function test_deploy_revert_treasury_is_eoa() public {
        vm.expectRevert(Errors.InvalidAddress.selector);
        f.deploy(safe, address(0xE0A), 1000, usdc);
    }

    function test_deploy_revert_treasury_is_zero() public {
        vm.expectRevert(Errors.InvalidAddress.selector);
        f.deploy(safe, address(0), 1000, usdc);
    }

    function test_deploy_revert_treasury_is_this() public {
        vm.expectRevert(Errors.InvalidAddress.selector);
        f.deploy(safe, address(f), 1000, usdc);
    }

    function test_deploy_revert_threshold_out_of_bounds() public {
        vm.expectRevert(Errors.OutOfBounds.selector);
        f.deploy(safe, treasury, 49, usdc);

        vm.expectRevert(Errors.OutOfBounds.selector);
        f.deploy(safe, treasury, 2001, usdc);
    }

    // ================================================================== initializeLevels

    function test_initializeLevels() public {
        f.deploy(safe, treasury, 1000, usdc);
        f.initializeLevels(defaultLevels());
        assertEq(ILevels(f.levels()).length(), 3);
    }

    function test_initializeLevels_revert_after_finalize() public {
        f.deploy(safe, treasury, 1000, usdc);
        f.initializeLevels(defaultLevels());
        f.initializePoolPrice(P0_INITIAL);
        f.registerParams();
        f.finalize(safe);

        // owner(f) = safe; вызов от safe → onlyOwner проходит, но levels уже не у factory
        vm.prank(safe);
        vm.expectRevert(Errors.NotOwner.selector);
        f.initializeLevels(defaultLevels());
    }

    function test_initializeLevels_revert_not_owner() public {
        f.deploy(safe, treasury, 1000, usdc);

        // onlyOwner в Factory — вызов от не-owner'а
        vm.prank(address(0xBAD));
        vm.expectRevert();
        f.initializeLevels(defaultLevels());
    }

    // ================================================================== initializePoolPrice

    function test_initializePoolPrice() public {
        f.deploy(safe, treasury, 1000, usdc);
        f.initializeLevels(defaultLevels());
        f.initializePoolPrice(P0_INITIAL);
        assertEq(IPoolState(f.poolState()).poolPrice(), P0_INITIAL);
    }

    function test_initializePoolPrice_revert_empty_levels() public {
        f.deploy(safe, treasury, 1000, usdc);
        vm.expectRevert(Errors.InvalidParam.selector);
        f.initializePoolPrice(P0_INITIAL);
    }

    function test_initializePoolPrice_revert_zero_P_S0() public {
        f.deploy(safe, treasury, 1000, usdc);

        // Уровень с P = 0 → P(0) = 0
        Types.Level[] memory lv = new Types.Level[](1);
        lv[0] = Types.Level(0, 1_000e18, 0, 0, 1_000e18);
        f.initializeLevels(lv);

        vm.expectRevert(Errors.InvalidParam.selector);
        f.initializePoolPrice(1);
    }

    function test_initializePoolPrice_revert_nonzero_Scurve() public {
        f.deploy(safe, treasury, 1000, usdc);
        f.initializeLevels(defaultLevels());

        vm.mockCall(
            f.reserveManager(), abi.encodeWithSelector(IReserveManager.S_curve.selector), abi.encode(uint256(1))
        );

        vm.expectRevert(Errors.InvalidParam.selector);
        f.initializePoolPrice(P0_INITIAL);
    }

    function test_initializePoolPrice_revert_below_lower_bound() public {
        f.deploy(safe, treasury, 1000, usdc);
        f.initializeLevels(defaultLevels());

        uint256 lower = (P0_INITIAL * Constants.BASIS_POINTS) / (Constants.BASIS_POINTS + Constants.MAX_GAP);

        vm.expectRevert(Errors.OutOfBounds.selector);
        f.initializePoolPrice(lower - 1);
    }

    function test_initializePoolPrice_revert_above_upper_bound() public {
        f.deploy(safe, treasury, 1000, usdc);
        f.initializeLevels(defaultLevels());

        uint256 upper = (P0_INITIAL * (Constants.BASIS_POINTS + Constants.MAX_GAP)) / Constants.BASIS_POINTS;

        vm.expectRevert(Errors.OutOfBounds.selector);
        f.initializePoolPrice(upper + 1);
    }

    function test_initializePoolPrice_pass_at_lower_bound() public {
        f.deploy(safe, treasury, 1000, usdc);
        f.initializeLevels(defaultLevels());

        uint256 lower = (P0_INITIAL * Constants.BASIS_POINTS) / (Constants.BASIS_POINTS + Constants.MAX_GAP);

        f.initializePoolPrice(lower);
        assertEq(IPoolState(f.poolState()).poolPrice(), lower);
    }

    function test_initializePoolPrice_pass_at_upper_bound() public {
        f.deploy(safe, treasury, 1000, usdc);
        f.initializeLevels(defaultLevels());

        uint256 upper = (P0_INITIAL * (Constants.BASIS_POINTS + Constants.MAX_GAP)) / Constants.BASIS_POINTS;

        f.initializePoolPrice(upper);
        assertEq(IPoolState(f.poolState()).poolPrice(), upper);
    }

    // ================================================================== registerParams

    function test_registerParams() public {
        (address cc, address pc,) = f.deploy(safe, treasury, 1000, usdc);
        f.registerParams();

        IParameterRegistry r = IParameterRegistry(f.registry());

        assertEq(r.get(Constants.PARAM_BUY_FEE).target, cc);
        assertEq(r.get(Constants.PARAM_BUY_FEE).min, 0);
        assertEq(r.get(Constants.PARAM_BUY_FEE).max, 200);

        assertEq(r.get(Constants.PARAM_MAX_SELL_PCT_PER_DAY).target, pc);
        assertEq(r.get(Constants.PARAM_MAX_SELL_PCT_PER_DAY).max, 500);

        assertEq(r.get(Constants.PARAM_CIRCUIT_BREAKER_THRESHOLD).target, f.circuitBreaker());
        assertEq(r.get(Constants.PARAM_CIRCUIT_BREAKER_THRESHOLD).min, 500);
        assertEq(r.get(Constants.PARAM_CIRCUIT_BREAKER_THRESHOLD).max, 2000);

        assertEq(r.get(Constants.PARAM_SELL_TEAM_FEE).target, cc);
        assertEq(r.get(Constants.PARAM_SELL_TEAM_FEE).min, 0);
        assertEq(r.get(Constants.PARAM_SELL_TEAM_FEE).max, 50);
    }

    function test_registerParams_sellTeamFee_bounds() public {
        (address cc,,) = f.deploy(safe, treasury, 1000, usdc);
        f.registerParams();

        IParameterRegistry.ParamInfo memory info = IParameterRegistry(f.registry()).get(Constants.PARAM_SELL_TEAM_FEE);
        assertEq(info.target, cc);
        assertEq(info.setter, ICurveController.setSellTeamFee.selector);
        assertEq(info.min, 0);
        assertEq(info.max, 50);
        assertTrue(info.exists);
    }

    // ================================================================== finalize

    function test_finalize() public {
        f.deploy(safe, treasury, 1000, usdc);
        f.initializeLevels(defaultLevels());
        f.initializePoolPrice(P0_INITIAL);
        f.registerParams();
        f.finalize(safe);
        assertEq(IOwnable(address(f)).owner(), safe);
    }

    function test_finalize_allOwnables() public {
        f.deploy(safe, treasury, 1000, usdc);
        f.initializeLevels(defaultLevels());
        f.initializePoolPrice(P0_INITIAL);
        f.registerParams();
        f.finalize(safe);

        assertEq(IOwnable(f.levels()).owner(), safe);
        assertEq(IOwnable(f.registry()).owner(), safe);
        assertEq(IOwnable(f.poolState()).owner(), safe);
        assertEq(IOwnable(f.curveController()).owner(), safe);
        assertEq(IOwnable(address(f)).owner(), safe);
    }

    function test_finalize_revokes_roles() public {
        (address cc, address pc,) = f.deploy(safe, treasury, 1000, usdc);
        f.initializeLevels(defaultLevels());
        f.initializePoolPrice(P0_INITIAL);
        f.registerParams();
        f.finalize(safe);

        assertFalse(IAccessControl(cc).hasRole(Roles.GOVERNANCE_ROLE, address(f)));
        assertFalse(IAccessControl(pc).hasRole(Roles.GOVERNANCE_ROLE, address(f)));
    }

    function test_finalize_revokes_default_admin_from_factory() public {
        (address cc, address pc,) = f.deploy(safe, treasury, 1000, usdc);
        f.initializeLevels(defaultLevels());
        f.initializePoolPrice(P0_INITIAL);
        f.registerParams();
        f.finalize(safe);

        assertFalse(IAccessControl(f.token()).hasRole(Roles.DEFAULT_ADMIN_ROLE, address(f)));
        assertFalse(IAccessControl(cc).hasRole(Roles.DEFAULT_ADMIN_ROLE, address(f)));
        assertFalse(IAccessControl(pc).hasRole(Roles.DEFAULT_ADMIN_ROLE, address(f)));
        assertFalse(IAccessControl(f.reserveManager()).hasRole(Roles.DEFAULT_ADMIN_ROLE, address(f)));
        assertFalse(IAccessControl(f.vesting()).hasRole(Roles.DEFAULT_ADMIN_ROLE, address(f)));
        assertFalse(IAccessControl(f.circuitBreaker()).hasRole(Roles.DEFAULT_ADMIN_ROLE, address(f)));
        assertFalse(IAccessControl(f.governance()).hasRole(Roles.DEFAULT_ADMIN_ROLE, address(f)));
        assertFalse(IAccessControl(f.timelock()).hasRole(Roles.DEFAULT_ADMIN_ROLE, address(f)));
        assertFalse(IAccessControl(f.poolState()).hasRole(Roles.DEFAULT_ADMIN_ROLE, address(f)));
    }

    function test_finalize_transfers_curveController_ownership() public {
        (address cc,,) = f.deploy(safe, treasury, 1000, usdc);
        f.initializeLevels(defaultLevels());
        f.initializePoolPrice(P0_INITIAL);
        f.registerParams();
        f.finalize(safe);

        assertEq(IOwnable(cc).owner(), safe);
    }

    function test_finalize_revert_safe_is_eoa() public {
        f.deploy(safe, treasury, 1000, usdc);
        f.initializeLevels(defaultLevels());
        f.initializePoolPrice(P0_INITIAL);
        f.registerParams();

        vm.expectRevert(Errors.InvalidAddress.selector);
        f.finalize(address(0xE0A));
    }

    function test_finalize_revert_safe_not_pauser_address() public {
        f.deploy(safe, treasury, 1000, usdc);
        f.initializeLevels(defaultLevels());
        f.initializePoolPrice(P0_INITIAL);
        f.registerParams();

        address otherSafe = address(new MockSafeForFinalize());
        vm.expectRevert(Errors.SafeNotPauser.selector);
        f.finalize(otherSafe);
    }

    function test_finalize_revert_safe_not_pauser() public {
        (address cc,,) = f.deploy(safe, treasury, 1000, usdc);
        f.initializeLevels(defaultLevels());
        f.initializePoolPrice(P0_INITIAL);
        f.registerParams();

        // Отзываем PAUSER_ROLE у safe через Factory (у неё DEFAULT_ADMIN_ROLE)
        vm.prank(address(f));
        IAccessControl(cc).revokeRole(Roles.PAUSER_ROLE, safe);

        vm.expectRevert(Errors.SafeNotPauser.selector);
        f.finalize(safe);
    }

    function test_finalize_emit() public {
        f.deploy(safe, treasury, 1000, usdc);
        f.initializeLevels(defaultLevels());
        f.initializePoolPrice(P0_INITIAL);
        f.registerParams();

        vm.expectEmit(true, true, false, false);
        emit Events.Finalize(address(f), safe);
        f.finalize(safe);
    }
}

/// @dev Простой контракт для теста «safe не имеет ролей».
contract MockSafeForFinalize {}
