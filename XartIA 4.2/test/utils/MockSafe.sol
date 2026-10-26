// SPDX-License-Identifier: AGPL-3.0
pragma solidity 0.8.24;

/// @title MockSafe — упрощённый 3/5 мультисиг для тестов
/// @notice owner = msg.sender. execTransaction выполняет call. addOwner/removeOwner — no-op.
///         Для тестов Governance.propose (onlySafe) используется vm.prank(safe).
contract MockSafe {
    address public owner;

    constructor() {
        owner = msg.sender;
    }

    function execTransaction(address to, uint256 value, bytes calldata data) external payable returns (bool) {
        require(msg.sender == owner, "MockSafe: not owner");
        (bool ok,) = to.call{value: value}(data);
        return ok;
    }

    function addOwner(address) external {}
    function removeOwner(address) external {}

    receive() external payable {}
}
