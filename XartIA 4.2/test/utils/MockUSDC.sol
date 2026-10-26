// SPDX-License-Identifier: AGPL-3.0
pragma solidity 0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @title MockUSDC — тестовый USDC (6 decimals) с опциональным hook'ом
/// @notice Hook используется ТОЛЬКО в Reentrancy-тестах (T.5.01.13). По умолчанию отключён.
///         При transfer/transferFrom, где from == hookTrigger или to == hookTrigger,
///         вызывается hookTarget.<hookSelector>() без аргументов. Revert от callback'а
///         пробрасывается наружу — это позволяет тесту ловить «nonReentrant отсутствует».
contract MockUSDC is ERC20 {
    address public hookTrigger;
    address public hookTarget;
    bytes4 public hookSelector;

    constructor() ERC20("MockUSDC", "mUSDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function setHook(address trigger, address target, bytes4 selector) external {
        hookTrigger = trigger;
        hookTarget = target;
        hookSelector = selector;
    }

    function clearHook() external {
        hookTrigger = address(0);
        hookTarget = address(0);
        hookSelector = bytes4(0);
    }

    function _update(address from, address to, uint256 value) internal override {
        super._update(from, to, value);
        if (hookTarget != address(0) && (from == hookTrigger || to == hookTrigger)) {
            (bool ok, bytes memory ret) = hookTarget.call(abi.encodeWithSelector(hookSelector));
            if (!ok) {
                assembly {
                    revert(add(ret, 0x20), mload(ret))
                }
            }
        }
    }
}
