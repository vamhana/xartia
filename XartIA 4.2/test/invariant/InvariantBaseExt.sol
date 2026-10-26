// SPDX-License-Identifier: AGPL-3.0
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import {IReserveManager} from "../../contracts/reserve/IReserveManager.sol";
import {IPoolState} from "../../contracts/math/IPoolState.sol";
import {IXartIAToken} from "../../contracts/token/IXartIAToken.sol";
import {ICurveController} from "../../contracts/controllers/ICurveController.sol";
import {IPoolController} from "../../contracts/controllers/IPoolController.sol";
import {IXartIAFactory} from "../../contracts/factory/IXartIAFactory.sol";
import {MockUSDC} from "../utils/MockUSDC.sol";
import {TestHelpers} from "../utils/TestHelpers.sol";
import {XartIAHandler} from "./XartIAHandler.sol";

/// @title InvariantBaseExt — общий setUp для invariant-тестов
abstract contract InvariantBaseExt is TestHelpers {
    uint256 internal constant ACTORS_COUNT = 4;

    address internal factory;
    address internal usdc;
    address[] internal actors;
    XartIAHandler internal handler;

    function setUpInvariantExt() internal {
        setUpBase();
        usdc = mockUSDC();
        factory = deployFullSystem();
        // тест-контракт тоже может быть покупателем (seed/действия)
        mintUSDC(address(this), 10_000_000e6);
        MockUSDC(usdc).approve(factory_curve(), type(uint256).max);
        MockUSDC(usdc).approve(factory_pool(), type(uint256).max);

        // актёры + approve
        for (uint256 i = 0; i < ACTORS_COUNT; i++) {
            address a = address(uint160(0xA000 + i));
            actors.push(a);
            mintUSDC(a, 10_000_000e6);
            vm.prank(a);
            MockUSDC(usdc).approve(factory_curve(), type(uint256).max);
            vm.prank(a);
            MockUSDC(usdc).approve(factory_pool(), type(uint256).max);
            vm.prank(a);
            IXartIAToken(factory_token()).approve(factory_curve(), type(uint256).max);
            vm.prank(a);
            IXartIAToken(factory_token()).approve(factory_pool(), type(uint256).max);
        }

        // seed: одна покупка, чтобы S_curve > 0 и poolPrice > 0
        vm.prank(actors[0]);
        ICurveController(factory_curve()).buyFromCurve(1000e6, 0, 0);

        // disable CB (иначе sellToPool всегда ревертит)
        mintUSDC(factory_reserveMgr(), 10_000_000e6);

        // handler + target
        handler = new XartIAHandler(factory, usdc, actors);
        targetContract(address(handler));
    }

    // helpers — прокси к factory-геттерам
    function factory_curve() internal view returns (address) {
        return IXartIAFactory(factory).curveController();
    }

    function factory_pool() internal view returns (address) {
        return IXartIAFactory(factory).poolController();
    }

    function factory_token() internal view returns (address) {
        return IXartIAFactory(factory).token();
    }

    function factory_reserveMgr() internal view returns (address) {
        return IXartIAFactory(factory).reserveManager();
    }
}
