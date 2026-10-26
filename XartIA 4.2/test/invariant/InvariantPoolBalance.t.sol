// SPDX-License-Identifier: AGPL-3.0
pragma solidity 0.8.24;

import {IPoolState} from "../../contracts/math/IPoolState.sol";
import {IXartIAToken} from "../../contracts/token/IXartIAToken.sol";
import {IXartIAFactory} from "../../contracts/factory/IXartIAFactory.sol";
import {InvariantBaseExt} from "./InvariantBaseExt.sol";

/// @title InvariantPoolBalance.t.sol — T.3.01.08
/// @notice balanceOf(PoolController) == poolState.pool().
contract InvariantPoolBalanceTest is InvariantBaseExt {
    function setUp() public {
        setUpInvariantExt();
    }

    function invariant_poolBalance() public view {
        IXartIAFactory f = IXartIAFactory(factory);
        uint256 bal = IXartIAToken(f.token()).balanceOf(f.poolController());
        uint256 pool = IPoolState(f.poolState()).pool();
        assertEq(bal, pool, "pool balance mismatch");
    }

    /// @notice Дополнительный инвариант: PoolController не держит USDC между транзакциями (sweep-dust).
    function invariant_poolControllerUsdcZero() public view {
        IXartIAFactory f = IXartIAFactory(factory);
        uint256 bal = MockUSDCView(usdc).balanceOf(f.poolController());
        assertEq(bal, 0, "PoolController holds USDC");
    }
}

/// @dev Локальный view-интерфейс, чтобы не тащить MockUSDC целиком.
interface MockUSDCView {
    function balanceOf(address) external view returns (uint256);
}
