// SPDX-License-Identifier: AGPL-3.0
pragma solidity 0.8.24;

import {IReserveManager} from "../../contracts/reserve/IReserveManager.sol";
import {IXartIAFactory} from "../../contracts/factory/IXartIAFactory.sol";
import {PrecisionLib} from "../../contracts/libraries/PrecisionLib.sol";
import {MockUSDC} from "../utils/MockUSDC.sol";
import {InvariantBaseExt} from "./InvariantBaseExt.sol";

/// @title InvariantUsdcCustody.t.sol — T.3.01.07
/// @notice reserve() == toWei(balanceOf(reserveManager)).
/// @dev Прямое сравнение 6-dec с 18-dec некорректно — обязательна нормировка.
contract InvariantUsdcCustodyTest is InvariantBaseExt {
    function setUp() public {
        setUpInvariantExt();
    }

    function invariant_usdcCustody() public view {
        address rm = IXartIAFactory(factory).reserveManager();
        uint256 bal6 = MockUSDC(usdc).balanceOf(rm);
        uint256 bal18 = PrecisionLib.toWei(bal6);
        assertEq(IReserveManager(rm).reserve(), bal18, "reserve mismatch with balance");
    }
}
