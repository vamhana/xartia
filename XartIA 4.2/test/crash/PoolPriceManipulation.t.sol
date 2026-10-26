// SPDX-License-Identifier: AGPL-3.0
pragma solidity 0.8.24;

import {Constants} from "../../contracts/math/Constants.sol";
import {Types} from "../../contracts/math/Types.sol";
import {CurveMath} from "../../contracts/math/CurveMath.sol";
import {ILevels} from "../../contracts/math/ILevels.sol";
import {IPoolState} from "../../contracts/math/IPoolState.sol";
import {IReserveManager} from "../../contracts/reserve/IReserveManager.sol";
import {ICurveController} from "../../contracts/controllers/ICurveController.sol";
import {IPoolController} from "../../contracts/controllers/IPoolController.sol";
import {IXartIAToken} from "../../contracts/token/IXartIAToken.sol";
import {IXartIAFactory} from "../../contracts/factory/IXartIAFactory.sol";
import {MockUSDC} from "../utils/MockUSDC.sol";
import {TestHelpers} from "../utils/TestHelpers.sol";

/// @title PoolPriceManipulation.t.sol — T.5.01.11
contract PoolPriceManipulationTest is TestHelpers {
    address internal factory;
    address internal usdc;
    address internal curveCtrl;
    address internal poolCtrl;
    address internal reserveMgr;
    address internal poolState;
    address internal levels;
    address internal token;

    address internal user = address(0xA11CE);
    address internal user2 = address(0xB0B);

    function setUp() public {
        setUpBase();
        usdc = mockUSDC();
        factory = deployFullSystem();
        IXartIAFactory f = IXartIAFactory(factory);
        curveCtrl = f.curveController();
        poolCtrl = f.poolController();
        reserveMgr = f.reserveManager();
        poolState = f.poolState();
        levels = f.levels();
        token = f.token();

        mintUSDC(user, 100_000_000e6);
        mintUSDC(user2, 100_000_000e6);
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
        // seed
        vm.prank(user);
        ICurveController(curveCtrl).buyFromCurve(1000e6, 0, 0);
        mintUSDC(reserveMgr, 10_000_000e6);
    }

    function _pS() internal view returns (uint256) {
        Types.Level[] memory lv = ILevels(levels).all();
        return CurveMath.P(IReserveManager(reserveMgr).S_curve(), lv);
    }

    function _floorCeiling() internal view returns (uint256 floor, uint256 ceiling) {
        uint256 pS = _pS();
        floor = (pS * Constants.BASIS_POINTS) / (Constants.BASIS_POINTS + Constants.MAX_GAP);
        ceiling = (pS * (Constants.BASIS_POINTS + Constants.MAX_GAP)) / Constants.BASIS_POINTS;
    }

    function test_manipulation_ceiling() public {
        // Серия sellToPool должна поднимать poolPrice, но не выше ceiling
        uint256 bal = IXartIAToken(token).balanceOf(user);
        uint256 chunk = bal / 50;

        for (uint256 i = 0; i < 10; i++) {
            vm.prank(user);
            IPoolController(poolCtrl).sellToPool(chunk, 0, 0);
            warpBy(1 days);

            (, uint256 ceiling) = _floorCeiling();
            assertLe(IPoolState(poolState).poolPrice(), ceiling, "above ceiling");
        }
    }

    function test_manipulation_floor() public {
        // Серия buyFromCurve поднимает S и P(S) → floor тоже растёт.
        // poolPrice должен обновиться до нового floor.
        for (uint256 i = 0; i < 5; i++) {
            buySafe(curveCtrl, user2, 100e6);

            (uint256 floor,) = _floorCeiling();
            assertGe(IPoolState(poolState).poolPrice(), floor, "below floor");
        }
    }

    function test_manipulation_both_bounds() public {
        // Смешанные операции — проверяем обе границы в конце
        for (uint256 i = 0; i < 3; i++) {
            buySafe(curveCtrl, user2, 100e6);
            warpBy(1);

            uint256 bal = IXartIAToken(token).balanceOf(user);
            if (bal > 0) {
                vm.prank(user);
                IPoolController(poolCtrl).sellToPool(bal / 50, 0, 0);
            }
            warpBy(1 days);
        }

        (uint256 floor, uint256 ceiling) = _floorCeiling();
        uint256 price = IPoolState(poolState).poolPrice();
        assertGe(price, floor);
        assertLe(price, ceiling);
    }
}
