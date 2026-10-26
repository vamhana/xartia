// SPDX-License-Identifier: AGPL-3.0
pragma solidity 0.8.24;

import {Errors} from "../../contracts/math/Errors.sol";
import {XartIAFactory} from "../../contracts/factory/XartIAFactory.sol";
import {IXartIAFactory} from "../../contracts/factory/IXartIAFactory.sol";
import {MockSafe} from "../utils/MockSafe.sol";
import {MockUSDC} from "../utils/MockUSDC.sol";
import {TestHelpers} from "../utils/TestHelpers.sol";

/// @title FuzzFactory.t.sol — T.2.01.06
contract FuzzFactoryTest is TestHelpers {
    address internal safe;
    address internal treasury;
    address internal usdc;

    function setUp() public {
        setUpBase();
        safe = mockSafe();
        treasury = mockTreasury();
        usdc = mockUSDC();
    }

    function testFuzz_deploy(uint256 threshold) public {
        threshold = bound(threshold, 500, 2000);

        XartIAFactory f = new XartIAFactory();
        (address cc, address pc, address cmw) = f.deploy(safe, treasury, threshold, usdc);

        assertTrue(cc != address(0));
        assertTrue(pc != address(0));
        assertTrue(cmw != address(0));
        assertEq(f.treasury(), treasury);
    }

    function testFuzz_deploy_outOfBounds(uint256 threshold) public {
        vm.assume(threshold < 50 || threshold > 2000);

        XartIAFactory f = new XartIAFactory();
        vm.expectRevert(Errors.OutOfBounds.selector);
        f.deploy(safe, treasury, threshold, usdc);
    }
}
