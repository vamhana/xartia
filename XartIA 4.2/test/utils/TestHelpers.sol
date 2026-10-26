// SPDX-License-Identifier: AGPL-3.0
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";

import {Roles} from "../../contracts/core/Roles.sol";
import {Types} from "../../contracts/math/Types.sol";
import {CurveMath} from "../../contracts/math/CurveMath.sol";
import {Levels} from "../../contracts/math/Levels.sol";
import {ILevels} from "../../contracts/math/ILevels.sol";
import {PoolState} from "../../contracts/math/PoolState.sol";
import {IPoolState} from "../../contracts/math/IPoolState.sol";
import {XartIAToken} from "../../contracts/token/XartIAToken.sol";
import {ReserveManager} from "../../contracts/reserve/ReserveManager.sol";
import {Vesting} from "../../contracts/vesting/Vesting.sol";
import {CircuitBreaker} from "../../contracts/safety/CircuitBreaker.sol";
import {CurveController} from "../../contracts/controllers/CurveController.sol";
import {ICurveController} from "../../contracts/controllers/ICurveController.sol";
import {XartIAFactory} from "../../contracts/factory/XartIAFactory.sol";
import {IXartIAFactory} from "../../contracts/factory/IXartIAFactory.sol";

import {MockUSDC} from "./MockUSDC.sol";
import {MockSafe} from "./MockSafe.sol";
import {TimeHelpers} from "./TimeHelpers.sol";

/// @title TestHelpers — общие хелперы для всех тестов
/// @notice Деплой полной системы + стандартные моки. Уровни и P0 — синхронизированы с config/levels.json.
abstract contract TestHelpers is Test, TimeHelpers {
    uint256 internal constant P0_INITIAL = 2e15; // 0.002 USDC/XRT в 18-dec

    address internal _mockUSDC;
    address internal _mockSafe;
    address internal _mockTreasury;

    function mockUSDC() internal view returns (address) {
        return _mockUSDC;
    }

    function mockSafe() internal view returns (address) {
        return _mockSafe;
    }

    function mockTreasury() internal view returns (address) {
        return _mockTreasury;
    }

    // ------------------------------------------------------------------ базовые helpers

    function setUpBase() internal {
        _mockUSDC = address(new MockUSDC());
        _mockSafe = address(new MockSafe());
        _mockTreasury = address(new MockSafe());
    }

    /// @notice Покупка с автоматическим дроблением под maxPurchasePct (10% от S).
    ///         Тестам не нужно вручную подбирать суммы под лимит.
    function buySafe(address curveController, address user, uint256 x6) internal {
        if (x6 == 0) return;
        vm.prank(user);
        try ICurveController(curveController).buyFromCurve(x6, 0, 0) {
            return;
        } catch {
            if (x6 <= 2_200_000) return; // остаток меньше минимальной покупки — пропускаем
            buySafe(curveController, user, x6 / 2);
            buySafe(curveController, user, x6 - x6 / 2);
        }
    }

    function mintUSDC(address to, uint256 amount) internal {
        MockUSDC(_mockUSDC).mint(to, amount);
    }

    function approveAll(address owner, address spender) internal {
        vm.prank(owner);
        MockUSDC(_mockUSDC).approve(spender, type(uint256).max);
    }

    function warp(uint256 timestamp) internal {
        vm.warp(timestamp);
    }

    // ------------------------------------------------------------------ default levels

    /// @notice Стандартные 3 уровня. P(0) = 2e15, P0_INITIAL = 2e15.
    function defaultLevels() internal pure returns (Types.Level[] memory levels) {
        levels = new Types.Level[](3);
        levels[0] = Types.Level(0, 50_000e18, 2e15, 2e15, 50_000e18);
        levels[1] = Types.Level(50_000e18, 250_000e18, 2e15, 4e15, 250_000e18);
        levels[2] = Types.Level(250_000e18, 1_250_000e18, 4e15, 8e15, 1_250_000e18);
    }

    // ------------------------------------------------------------------ deploy full system

    function deployFullSystem() internal returns (address factory) {
        if (_mockUSDC == address(0)) setUpBase();
        factory = address(new XartIAFactory());
        IXartIAFactory(factory).deploy(_mockSafe, _mockTreasury, 1000, _mockUSDC);
        IXartIAFactory(factory).initializeLevels(defaultLevels());
        IXartIAFactory(factory).initializePoolPrice(P0_INITIAL);
        IXartIAFactory(factory).registerParams();
    }

    function deployFullSystemFinalized() internal returns (address factory) {
        factory = deployFullSystem();
        IXartIAFactory(factory).finalize(_mockSafe);
    }

    // ------------------------------------------------------------------ deploy CurveController for reentrancy

    /// @notice Прямое развёртывание CurveController — тестовый контракт owner.
    ///         Attacker назначается как poolController через setPoolController.
    /// @return curveController_  адрес CurveController
    /// @return token_            адрес XartIAToken
    /// @return levels_           адрес Levels
    /// @return poolState_        адрес PoolState
    /// @return reserveManager_   адрес ReserveManager
    /// @return vesting_          адрес Vesting
    /// @return circuitBreaker_   адрес CircuitBreaker
    /// @return treasury_         адрес treasury (MockSafe)
    function deployCurveControllerForReentrancy(address poolController_)
        internal
        returns (
            address curveController_,
            address token_,
            address levels_,
            address poolState_,
            address reserveManager_,
            address vesting_,
            address circuitBreaker_,
            address treasury_
        )
    {
        _mockUSDC = address(new MockUSDC());
        _mockTreasury = address(new MockSafe());

        token_ = address(new XartIAToken());
        levels_ = address(new Levels());
        poolState_ = address(new PoolState());
        reserveManager_ = address(new ReserveManager(_mockUSDC, levels_));
        vesting_ = address(new Vesting(address(this), token_));
        circuitBreaker_ = address(new CircuitBreaker(1000, reserveManager_));
        curveController_ = address(
            new CurveController(
                reserveManager_, vesting_, circuitBreaker_, poolState_, token_, levels_, _mockUSDC, _mockTreasury
            )
        );

        ILevels(levels_).init(defaultLevels());
        IPoolState(poolState_).initializePoolPrice(P0_INITIAL);
        ICurveController(curveController_).setPoolController(poolController_);

        IAccessControl(token_).grantRole(Roles.MINTER_ROLE, curveController_);
        IAccessControl(token_).grantRole(Roles.BURNER_ROLE, curveController_);
        IAccessControl(vesting_).grantRole(Roles.MINTER_ROLE, curveController_);
        IAccessControl(reserveManager_).grantRole(Roles.CONTROLLER_ROLE, curveController_);
        IAccessControl(reserveManager_).grantRole(Roles.CONTROLLER_ROLE, poolController_);
        IAccessControl(poolState_).grantRole(Roles.PRICE_WRITER_ROLE, curveController_);
        IAccessControl(poolState_).grantRole(Roles.POOL_WRITER_ROLE, poolController_);
        IAccessControl(curveController_).grantRole(Roles.GOVERNANCE_ROLE, address(this));
        IAccessControl(curveController_).grantRole(Roles.PAUSER_ROLE, address(this));

        ICurveController(curveController_).setBuyFee(50);
        ICurveController(curveController_).setRedeemFee(50);
        ICurveController(curveController_).setMinimalPurchase(1e6);
        ICurveController(curveController_).setMaxPurchasePct(500);
        ICurveController(curveController_).setSellTeamFee(10);

        treasury_ = _mockTreasury;
    }
}
