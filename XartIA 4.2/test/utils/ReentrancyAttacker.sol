// SPDX-License-Identifier: AGPL-3.0-only
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {ICurveController} from "../../contracts/controllers/ICurveController.sol";
import {IPoolController} from "../../contracts/controllers/IPoolController.sol";

/// @title ReentrancyAttacker — атакующий контракт для T.5.01.13
/// @notice Сценарий:
///         (1) Тест регистрирует this как hook в MockUSDC:
///             mockUSDC.setHook(address(attacker), address(attacker), ReentrancyAttacker.tryReenter.selector)
///         (2) Тест вызывает attacker.attack_<fn>(...).
///         (3) Внутри контроллера происходит USDC transfer/transferFrom, где from/to = attacker.
///         (4) MockUSDC вызывает attacker.tryReenter().
///         (5) tryReenter пытается реентерить через _reenterTarget.call(_reenterCall).
///             - Если nonReentrant работает: inner вызов revert, tryReenter возвращает ok.
///             - Если nonReentrant НЕ работает: inner success, tryReenter revert "Reentrancy not blocked",
///               revert пробрасывается в MockUSDC, outer tx revert. Тест падает.
/// @dev Для attack_buyFromCurveFor attacker используется как poolController через
///      deployCurveControllerForReentrancy(address(attacker)).
contract ReentrancyAttacker {
    address private _reenterTarget;
    bytes private _reenterCall;
    bool private _reentering;

    function setReenter(address target, bytes calldata call) external {
        _reenterTarget = target;
        _reenterCall = call;
    }

    /// @notice Вызывается MockUSDC при transfer/transferFrom, где from/to = attacker.
    /// @dev    Требует, чтобы перед атакой был вызван setReenter(...), иначе
    ///         реентерабельность фактически не проверяется и тест может дать
    ///         false positive (outer tx пройдёт при любом состоянии nonReentrant).
    function tryReenter() external {
        if (_reentering) return;

        address target = _reenterTarget;
        require(target != address(0), "ReentrancyAttacker: target not set");

        _reentering = true;
        (bool ok,) = target.call(_reenterCall);
        _reentering = false;

        if (ok) revert("Reentrancy not blocked");
    }

    // ------------------------------------------------------------------ attacks

    function attack_buyFromCurve(address controller, address usdc, uint256 amount) external {
        IERC20(usdc).approve(controller, amount);
        ICurveController(controller).buyFromCurve(amount, 0, 0);
    }

    function attack_redeemFromCurve(address controller, uint256 amount) external {
        ICurveController(controller).redeemFromCurve(amount, 0, 0);
    }

    function attack_buyFromPool(address controller, address usdc, uint256 amount) external {
        IERC20(usdc).approve(controller, amount);
        IPoolController(controller).buyFromPool(amount, 0, 0);
    }

    function attack_sellToPool(address controller, uint256 amount) external {
        IPoolController(controller).sellToPool(amount, 0, 0);
    }

    function attack_buyFromCurveFor(address controller, address usdc, address buyer, uint256 amount) external {
        IERC20(usdc).approve(controller, amount);
        ICurveController(controller).buyFromCurveFor(buyer, amount, 0, 0);
    }

    function attack_setLastBuyTime(address controller, address user, uint256 timestamp) external {
        ICurveController(controller).setLastBuyTime(user, timestamp);
    }
}
