// SPDX-License-Identifier: AGPL-3.0
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";

import {Roles} from "../../contracts/core/Roles.sol";
import {Errors} from "../../contracts/math/Errors.sol";
import {Types} from "../../contracts/math/Types.sol";
import {Levels} from "../../contracts/math/Levels.sol";
import {ReserveManager} from "../../contracts/reserve/ReserveManager.sol";
import {MockUSDC} from "../utils/MockUSDC.sol";

/// @title FuzzReserve.t.sol — T.2.01.04
/// @notice Используем плоский уровень P = 2e15, чтобы аналитически связать r и max S:
///         R(S) = S * 2e15 / 1e18 = S / 500. При reserve = r, max S = r * 500.
contract FuzzReserveTest is Test {
    address internal controller = address(0xC0DE);

    MockUSDC internal usdc;
    Levels internal levels;
    ReserveManager internal rm;

    uint256 internal constant P = 2e15; // 0.002 USDC/XRT
    uint256 internal constant S_END = 1_000_000_000e18;

    function setUp() public {
        usdc = new MockUSDC();
        levels = new Levels();

        Types.Level[] memory lv = new Types.Level[](1);
        lv[0] = Types.Level(0, S_END, P, P, S_END);
        levels.init(lv);

        rm = new ReserveManager(address(usdc), address(levels));
        rm.grantRole(Roles.CONTROLLER_ROLE, controller);
    }

    function testFuzz_invariant(uint256 r_18, uint256 S) public {
        r_18 = bound(r_18, 0, 1_000_000e18);
        usdc.mint(address(rm), r_18 / 1e12);
        uint256 actualReserve = rm.reserve();
        uint256 sMax = (actualReserve * 1e18) / P;
        if (sMax > S_END) sMax = S_END;
        S = bound(S, 0, sMax);

        vm.prank(controller);
        rm.updateScurve(S);

        assertTrue(rm.checkInvariant(), "invariant broken");
        assertGe(rm.reserve(), rm.curveBacking(), "reserve < curveBacking");
        assertEq(rm.freeReserve(), rm.reserve() - rm.curveBacking(), "freeReserve wrong");
    }

    function testFuzz_pay_amount(uint256 reserveAmount, uint256 payAmount) public {
        reserveAmount = bound(reserveAmount, 0, 1_000_000e18);
        payAmount = bound(payAmount, 0, 1_000_000e18);

        usdc.mint(address(rm), reserveAmount / 1e12);

        address recipient = address(0xBEEF);
        if (payAmount <= rm.reserve()) {
            vm.prank(controller);
            rm.pay(recipient, payAmount);
            assertEq(usdc.balanceOf(recipient), payAmount / 1e12);
        } else {
            vm.prank(controller);
            vm.expectRevert(Errors.InsufficientReserve.selector);
            rm.pay(recipient, payAmount);
        }
    }
}
