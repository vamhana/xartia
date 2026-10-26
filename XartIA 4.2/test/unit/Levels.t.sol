// SPDX-License-Identifier: AGPL-3.0
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";

import {Errors} from "../../contracts/math/Errors.sol";
import {Types} from "../../contracts/math/Types.sol";
import {Levels} from "../../contracts/math/Levels.sol";
import {ILevels} from "../../contracts/math/ILevels.sol";

/// @title Levels.t.sol — T.1.01.11
contract LevelsTest is Test {
    Levels internal levels;

    function setUp() public {
        levels = new Levels();
    }

    function _default() internal pure returns (Types.Level[] memory lv) {
        lv = new Types.Level[](3);
        lv[0] = Types.Level(0, 50_000e18, 2e15, 2e15, 50_000e18);
        lv[1] = Types.Level(50_000e18, 250_000e18, 2e15, 4e15, 250_000e18);
        lv[2] = Types.Level(250_000e18, 1_250_000e18, 4e15, 8e15, 1_250_000e18);
    }

    function test_init() public {
        levels.init(_default());
        assertEq(levels.length(), 3);
    }

    function test_reinit_revert() public {
        levels.init(_default());
        vm.expectRevert(Errors.AlreadyInitialized.selector);
        levels.init(_default());
    }

    function test_getLevel() public {
        levels.init(_default());
        assertEq(levels.getLevel(0), 0);
        assertEq(levels.getLevel(50_000e18 - 1), 0);
        assertEq(levels.getLevel(50_000e18), 1);
        assertEq(levels.getLevel(250_000e18), 2);
        assertEq(levels.getLevel(1_250_000e18), 2);
    }

    function test_getBounds() public {
        levels.init(_default());
        (uint256 s, uint256 e) = levels.getBounds(0);
        assertEq(s, 0);
        assertEq(e, 50_000e18);

        (s, e) = levels.getBounds(2);
        assertEq(s, 250_000e18);
        assertEq(e, 1_250_000e18);
    }

    function test_getBounds_revert_oob() public {
        levels.init(_default());
        vm.expectRevert(Errors.OutOfBounds.selector);
        levels.getBounds(3);
    }

    function test_getMaxBalance() public {
        levels.init(_default());
        assertEq(levels.getMaxBalance(0), 50_000e18);
        assertEq(levels.getMaxBalance(2), 1_250_000e18);
    }

    function test_getMaxBalance_revert_oob() public {
        levels.init(_default());
        vm.expectRevert(Errors.OutOfBounds.selector);
        levels.getMaxBalance(3);
    }

    function test_all() public {
        levels.init(_default());
        Types.Level[] memory lv = levels.all();
        assertEq(lv.length, 3);
        assertEq(lv[0].S_end, 50_000e18);
        assertEq(lv[1].P_end, 4e15);
    }

    function test_init_revert_empty() public {
        Types.Level[] memory lv = new Types.Level[](0);
        vm.expectRevert(Errors.InvalidLevel.selector);
        levels.init(lv);
    }

    function test_init_revert_too_many() public {
        Types.Level[] memory lv = new Types.Level[](11);
        for (uint256 i = 0; i < 11; i++) {
            lv[i] = Types.Level(i * 1e18, (i + 1) * 1e18, 2e15, 2e15, 1e18);
        }
        vm.expectRevert(Errors.InvalidLevel.selector);
        levels.init(lv);
    }

    function test_init_revert_zero_end() public {
        Types.Level[] memory lv = new Types.Level[](1);
        lv[0] = Types.Level(0, 0, 2e15, 2e15, 1e18);
        vm.expectRevert(Errors.InvalidLevel.selector);
        levels.init(lv);
    }

    function test_init_revert_negative_slope() public {
        Types.Level[] memory lv = new Types.Level[](1);
        lv[0] = Types.Level(0, 1e18, 4e15, 2e15, 1e18); // P падает
        vm.expectRevert(Errors.InvalidLevel.selector);
        levels.init(lv);
    }

    function test_init_revert_discontinuous_S() public {
        Types.Level[] memory lv = new Types.Level[](2);
        lv[0] = Types.Level(0, 1_000e18, 2e15, 2e15, 1e18);
        lv[1] = Types.Level(2_000e18, 3_000e18, 2e15, 2e15, 1e18); // разрыв 1000..2000
        vm.expectRevert(Errors.InvalidLevel.selector);
        levels.init(lv);
    }

    function test_init_revert_discontinuous_P() public {
        Types.Level[] memory lv = new Types.Level[](2);
        lv[0] = Types.Level(0, 1_000e18, 2e15, 2e15, 1e18);
        lv[1] = Types.Level(1_000e18, 2_000e18, 3e15, 3e15, 1e18); // разрыв по P
        vm.expectRevert(Errors.InvalidLevel.selector);
        levels.init(lv);
    }
}
