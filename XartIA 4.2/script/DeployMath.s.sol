// SPDX-License-Identifier: AGPL-3.0
pragma solidity 0.8.24;

import {Script} from "forge-std/Script.sol";

/// @title DeployMath — DEPRECATED
/// @notice CurveMath и LevelMath — internal pure-библиотеки: они инлайнятся в байткод
///         вызывающих контрактов и не требуют отдельного деплоя.
///         Для external-доступа к математике используется CurveMathWrapper (C.2.01.13),
///         который развёртывается в рамках script/Deploy.s.sol (D.1.01.01).
/// @dev Файл сохранён для истории (D.1.01.06). Активно НЕ используется.
///      run() ревертит — защита от случайного запуска через `forge script`.
///      Сам факт компиляции проверяется `forge build`.
contract DeployMath is Script {
    function run() external pure {
        revert("DeployMath is deprecated: CurveMath and LevelMath are internal pure libraries");
    }
}
