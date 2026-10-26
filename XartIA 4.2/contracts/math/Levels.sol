// SPDX-License-Identifier: AGPL-3.0
pragma solidity 0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Types} from "./Types.sol";
import {Constants} from "./Constants.sol";
import {Errors} from "./Errors.sol";
import {ILevels} from "./ILevels.sol";

/// @title Levels — таблица уровней предложения
/// @notice Иммутабельна после init(). init() — onlyOwner, ровно один раз.
/// @dev При init() дополнительно проверяем непрерывность (S_end_i == S_start_{i+1},
///      P_end_i == P_start_{i+1}) и монотонность (P_end_i > P_start_i).
///      Это не в спеке буквально, но без этого инвариант T.3.01.06 (price continuity)
///      не может держаться, а P(S) на границе станет разрывной.
contract Levels is ILevels, Ownable {
    Types.Level[] private _levels;
    bool private _initialized;

    constructor() Ownable(msg.sender) {}

    function init(Types.Level[] memory newLevels) external override onlyOwner {
        if (_initialized) revert Errors.AlreadyInitialized();
        uint256 n = newLevels.length;
        if (n == 0 || n > Constants.MAX_LEVELS) revert Errors.InvalidLevel();

        for (uint256 i = 0; i < n; i++) {
            Types.Level memory l = newLevels[i];
            if (l.S_end <= l.S_start) revert Errors.InvalidLevel();
            if (l.P_end < l.P_start) revert Errors.InvalidLevel();

            if (i > 0) {
                Types.Level memory prev = newLevels[i - 1];
                if (l.S_start != prev.S_end) revert Errors.InvalidLevel();
                if (l.P_start != prev.P_end) revert Errors.InvalidLevel();
            }

            _levels.push(l);
        }

        _initialized = true;
    }

    function getLevel(uint256 S) external view override returns (uint8) {
        uint256 n = _levels.length;
        if (n == 0) revert Errors.InvalidLevel();
        for (uint256 i = 0; i < n; i++) {
            if (S < _levels[i].S_end) return uint8(i);
        }
        return uint8(n - 1);
    }

    function getBounds(uint8 levelIndex) external view override returns (uint256, uint256) {
        if (levelIndex >= _levels.length) revert Errors.OutOfBounds();
        Types.Level storage l = _levels[levelIndex];
        return (l.S_start, l.S_end);
    }

    function getMaxBalance(uint8 levelIndex) external view override returns (uint256) {
        if (levelIndex >= _levels.length) revert Errors.OutOfBounds();
        return _levels[levelIndex].maxBalance;
    }

    function all() external view override returns (Types.Level[] memory) {
        uint256 n = _levels.length;
        Types.Level[] memory out = new Types.Level[](n);
        for (uint256 i = 0; i < n; i++) {
            out[i] = _levels[i];
        }
        return out;
    }

    function length() external view override returns (uint256) {
        return _levels.length;
    }
}
