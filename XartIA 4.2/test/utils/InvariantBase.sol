// SPDX-License-Identifier: AGPL-3.0
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";

import {IXartIAFactory} from "../../contracts/factory/IXartIAFactory.sol";
import {IReserveManager} from "../../contracts/reserve/IReserveManager.sol";
import {ICurveController} from "../../contracts/controllers/ICurveController.sol";
import {IPoolController} from "../../contracts/controllers/IPoolController.sol";
import {IXartIAToken} from "../../contracts/token/IXartIAToken.sol";
import {IPoolState} from "../../contracts/math/IPoolState.sol";
import {ILevels} from "../../contracts/math/ILevels.sol";

import {TestHelpers} from "./TestHelpers.sol";

/// @title InvariantBase — общие setup и хелперы для invariant-тестов
/// @notice Инварианты:
///         - reserve ≥ curveBacking
///         - freeReserve ≥ 0
///         - totalSupply == S_curve
///         - poolPrice в коридоре [P(S)/(1+MAX_GAP), P(S)*(1+MAX_GAP)]
///         - poolBalance == poolState.pool()
///         - balanceOf(PoolController) == 0 после tx
///         - treasury_balance монотонно неубывающий (см. T.3.01.09)
abstract contract InvariantBase is TestHelpers {
    address internal factory;
    address internal token;
    address internal curveController;
    address internal poolController;
    address internal reserveManager;
    address internal levels;
    address internal poolState;
    address internal vesting;
    address internal circuitBreaker;
    address internal governance;
    address internal timelock;

    function setUpInvariant() internal virtual {
        factory = deployFullSystem();
        IXartIAFactory f = IXartIAFactory(factory);
        token = f.token();
        levels = f.levels();
        poolState = f.poolState();
        reserveManager = f.reserveManager();
        vesting = f.vesting();
        circuitBreaker = f.circuitBreaker();
        curveController = f.curveController();
        poolController = f.poolController();
        governance = f.governance();
        timelock = f.timelock();
    }

    /// @dev Базовый инвариант. Используется invariant-тестами через внутренний вызов.
    function invariant_reserve_ge_curveBacking() internal view {
        IReserveManager rm = IReserveManager(reserveManager);
        assertGe(rm.reserve(), rm.curveBacking(), "invariant: reserve < curveBacking");
    }
}
