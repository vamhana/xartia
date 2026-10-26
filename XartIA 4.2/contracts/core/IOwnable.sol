// SPDX-License-Identifier: AGPL-3.0
pragma solidity 0.8.24;

/// @title IOwnable — минимальный интерфейс Ownable (OZ v5-совместимый)
/// @notice Используется Factory и внешними интеграциями вместо прямого каста к Ownable.
interface IOwnable {
    function owner() external view returns (address);
    function transferOwnership(address newOwner) external;
    function renounceOwnership() external;
}
