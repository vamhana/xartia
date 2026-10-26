|C.0.01.01|Contracts|Core|Solidity|contracts/core/Roles.sol|—|v.0.0.01|Draft|§10|
|Описание: Единый реестр ролей AccessControl. Роли CONTROLLER_ROLE, POOL_WRITER_ROLE, PRICE_WRITER_ROLE, POOL_CALLER_ROLE. Роли выдаются Factory при деплое.
|Публичный API:
- bytes32 constant MINTER_ROLE = keccak256("MINTER_ROLE")
- bytes32 constant BURNER_ROLE = keccak256("BURNER_ROLE")
- bytes32 constant CONTROLLER_ROLE = keccak256("CONTROLLER_ROLE")
- bytes32 constant POOL_WRITER_ROLE = keccak256("POOL_WRITER_ROLE")
- bytes32 constant PRICE_WRITER_ROLE = keccak256("PRICE_WRITER_ROLE")
- bytes32 constant POOL_CALLER_ROLE = keccak256("POOL_CALLER_ROLE")
- bytes32 constant GOVERNANCE_ROLE = keccak256("GOVERNANCE_ROLE")
- bytes32 constant PAUSER_ROLE = keccak256("PAUSER_ROLE")
- bytes32 constant DEFAULT_ADMIN_ROLE = 0x00
|↙ ПОТРЕБЛЯЕТ: — (нет зависимостей)
|↘ ПРЕДОСТАВЛЯЕТ:
- Унифицированные константы ролей
|Реализация: Solidity-библиотека.
|Примечания: НЕТ ролей CURVE_CONTROLLER_ROLE/POOL_CONTROLLER_ROLE. CONTROLLER_ROLE покрывает оба контроллера в контексте ReserveManager. ИЗМЕНЕНИЕ: шаги Factory переписаны под CONTROLLER_ROLE.

|C.0.01.02|Contracts|Core|Solidity|contracts/core/ParameterRegistry.sol|C.2.01.04|v.0.0.01|Draft|§10|
|Описание: Реестр управляемых параметров. Связывает bytes32-идентификатор параметра с целевым контрактом, селектором сеттера и допустимым диапазоном. Управление — только Ownable.
|Публичный API:
- struct ParamInfo { address target; bytes4 setter; uint256 min; uint256 max; bool exists; }
- function register(bytes32 param, address target, bytes4 setter, uint256 min, uint256 max) external onlyOwner
- function get(bytes32 param) external view returns (ParamInfo memory)
- function isValid(bytes32 param, uint256 value) external view returns (bool)
|↙ ПОТРЕБЛЯЕТ:
- C.2.01.04 Errors (InvalidParam, InvalidAddress, OutOfBounds, AlreadyInitialized)
- OpenZeppelin: Ownable
|↘ ПРЕДОСТАВЛЯЕТ:
- Маппинг bytes32 → (target, setter, min, max)
- Проверку bounds для Governance.propose()
|Реализация: Наследует Ownable. register() — onlyOwner. Повторная регистрация существующего param — revert с AlreadyInitialized. При деплое owner = XartIAFactory. После registerParams() ownership передаётся Safe Multisig через transferOwnership.
register(param, target, setter, min, max):
  (1) require(target != address(0), InvalidAddress)
  (2) require(setter != bytes4(0), InvalidParam)
  (3) require(min <= max, InvalidParam)
  (4) require(!params[param].exists, AlreadyInitialized)
  (5) params[param] = ParamInfo(target, setter, min, max, true)
|Примечания: ИСПРАВЛЕНО 7-я ИТЕРАЦИЯ: добавлены проверки target != address(0), setter != bytes4(0), min <= max. Без проверки min <= max можно зарегистрировать параметр с min > max, и isValid() всегда будет возвращать false. Тип значений — только uint256; bool/address не поддерживаются.

|C.0.01.03|Contracts|Core|Interface|contracts/core/IOwnable.sol|—|v.0.0.01|Draft|§10|
|Описание: Минимальный интерфейс Ownable (OpenZeppelin-совместимый) для вызова transferOwnership через интерфейс. Избегает прямого каста к контракту Ownable.
|Публичный API:
- function owner() external view returns (address)
- function transferOwnership(address newOwner) external
- function renounceOwnership() external
|↙ ПОТРЕБЛЯЕТ: — (нет зависимостей)
|↘ ПРЕДОСТАВЛЯЕТ:
- Типизированный интерфейс для Factory и внешних интеграций
|Реализация: Interface-only, сигнатуры синхронизированы с OpenZeppelin Ownable v5.
|Примечания: НОВОЕ: используется Factory вместо прямого вызова Ownable(address).transferOwnership.

|C.0.01.04|Contracts|Core|Interface|contracts/core/IParameterRegistry.sol|C.0.01.02|v.0.0.01|Draft|§10|
|Описание: Интерфейс ParameterRegistry для Factory и Governance.
|Публичный API:
- struct ParamInfo { address target; bytes4 setter; uint256 min; uint256 max; bool exists; }
- function register(bytes32 param, address target, bytes4 setter, uint256 min, uint256 max) external
- function get(bytes32 param) external view returns (ParamInfo memory)
- function isValid(bytes32 param, uint256 value) external view returns (bool)
|↙ ПОТРЕБЛЯЕТ:
- C.0.01.02 ParameterRegistry
|↘ ПРЕДОСТАВЛЯЕТ:
- Типизированный интерфейс для Factory и Governance
|Реализация: Interface-only, синхронизирован с C.0.01.02.
|Примечания: ИСПРАВЛЕНО: зависимость от C.0.01.01 Roles убрана — интерфейс соответствует реализации на Ownable.

|C.1.01.01|Contracts|Token|Solidity|contracts/token/XartIAToken.sol|C.0.01.01, C.2.01.03, C.2.01.04|v.0.0.01|Draft|§3|
|Описание: ERC-20 токен XartIA. Наследует ERC20, ERC20Burnable, AccessControl. Роли из Roles.sol: MINTER_ROLE, BURNER_ROLE, DEFAULT_ADMIN_ROLE. 18 decimals.
|Публичный API:
- constructor()
- function mint(address to, uint256 amount) external onlyRole(MINTER_ROLE)
- function burnFrom(address from, uint256 amount) external onlyRole(BURNER_ROLE)
- function grantRole(bytes32 role, address account) external onlyRole(DEFAULT_ADMIN_ROLE)
|↙ ПОТРЕБЛЯЕТ:
- C.0.01.01 Roles (MINTER_ROLE, BURNER_ROLE, DEFAULT_ADMIN_ROLE)
- C.2.01.03 Constants (PRECISION)
- C.2.01.04 Errors (InvalidAmount, Unauthorized)
- OpenZeppelin: ERC20, ERC20Burnable, AccessControl
|↘ ПРЕДОСТАВЛЯЕТ:
- ERC-20 интерфейс для контроллеров и пользователей
- MINTER_ROLE / BURNER_ROLE для CurveController
- События Mint, Burn для индексации
|Реализация: Конструктор без параметров. ERC20("XartIA", "XRT"). Роли назначаются при деплое через XartIAFactory. Удалён burn(address,uint256) — оставлен только burnFrom с allowance-моделью.
|Примечания: ИЗМЕНЕНИЕ БЕЗОПАСНОСТИ: burnFrom теперь требует allowance от `from` к msg.sender. Это устраняет риск компромисса BURNER_ROLE без явного разрешения пользователя. Пользователь делает approve(CurveController, amount) один раз перед redeemFromCurve.

|C.1.01.02|Contracts|Token|Interface|contracts/token/IXartIAToken.sol|C.1.01.01|v.0.0.01|Draft|§3|
|Описание: Интерфейс ERC-20 токена XartIA для моков и внешних интеграций.
|Публичный API:
- function mint(address to, uint256 amount) external
- function burnFrom(address from, uint256 amount) external
- function grantRole(bytes32 role, address account) external
|↙ ПОТРЕБЛЯЕТ:
- C.1.01.01 XartIAToken (реализация)
- OpenZeppelin: IERC20
|↘ ПРЕДОСТАВЛЯЕТ:
- Расширение IERC20 с mint/burnFrom/grantRole для внутренних интеграций
- Типизированный контракт для моков в тестах
|Реализация: Чистый interface, наследует IERC20.
|Примечания: ИЗМЕНЕНИЕ: добавлена явная зависимость от OpenZeppelin IERC20. Удалён burn(address,uint256).

|C.2.01.01|Contracts|Math|Solidity|contracts/math/CurveMath.sol|C.2.01.02, C.2.01.03, C.2.01.04, C.2.01.11, C.9.01.01|v.0.0.01|Draft|§4|
|Описание: Библиотека математики bonding curve. Все функции internal pure — инлайнятся в байткод. Отдельный деплой не требуется.
|Публичный API:
- function P(uint256 S, Level[] memory levels) internal pure returns (uint256)
- function R(uint256 S, Level[] memory levels) internal pure returns (uint256)
- function deltaSForBuy(uint256 S, uint256 X, Level[] memory levels) internal pure returns (uint256)
- function amountForRedeem(uint256 S, uint256 deltaS, Level[] memory levels) internal pure returns (uint256)
- function getLevel(uint256 S, Level[] memory levels) internal pure returns (uint8)
|↙ ПОТРЕБЛЯЕТ:
- C.2.01.02 LevelMath
- C.2.01.03 Constants
- C.2.01.04 Errors
- C.2.01.11 Types
- C.9.01.01 MathLib
|↘ ПРЕДОСТАВЛЯЕТ:
- P(S), R(S) для CurveController, PoolController, ReserveManager
|Реализация: internal pure. Инлайнится во всех вызывающих контрактах.
|Примечания: РЕШЕНО: internal-библиотека. Отдельный деплой не требуется, D.1.01.06 деприкейтится.

|C.2.01.02|Contracts|Math|Solidity|contracts/math/LevelMath.sol|C.2.01.11, C.9.01.01|v.0.0.01|Draft|§4|
|Описание: Библиотека атомарных расчётов уровня. Все функции internal pure. Отдельный деплой не требуется.
|Публичный API:
- function a(Level memory level) internal pure returns (uint256)
- function b(Level memory level) internal pure returns (uint256)
- function P_i(uint256 S, Level memory level) internal pure returns (uint256)
- function R_i(uint256 S, Level memory level) internal pure returns (uint256)
- function inBounds(uint256 S, Level memory level) internal pure returns (bool)
|↙ ПОТРЕБЛЯЕТ:
- C.2.01.11 Types
- C.9.01.01 MathLib
|↘ ПРЕДОСТАВЛЯЕТ:
- Атомарные расчёты для CurveMath
|Реализация: internal pure. Инлайнится в CurveMath.
|Примечания: РЕШЕНО: internal-библиотека.

|C.2.01.03|Contracts|Math|Solidity|contracts/math/Constants.sol|—|v.0.0.03|Draft|§4.2|
|Описание: Глобальные константы и иммутабельные параметры протокола. Также содержит bytes32-идентификаторы параметров для ParameterRegistry.
|Публичный API:
- uint256 constant PRECISION = 1e18                              // 18 decimals (XartIA)
- uint256 constant USDC_PRECISION = 1e6                           // 6 decimals (USDC)
- uint256 constant BASIS_POINTS = 10000                           // 100% в базисных пунктах
- uint8 constant MAX_LEVELS = 10                                  // максимум уровней
- uint256 constant TEAM_PERCENT = 50                              // 0.5% = 50 / BASIS_POINTS
- uint256 constant MAX_GAP = 1000                                 // 10% = 1000 / BASIS_POINTS — симметричный коридор poolPrice
- uint256 constant MAX_SOLD_PCT = 100                             // 1% = 100 / BASIS_POINTS
- uint256 constant K = 15000                                      // 1.5 = 15000 / BASIS_POINTS
- uint256 constant TIMELOCK_DELAY = 7 days                        // 7 дней
- uint256 constant MAX_CURVE_FOR_PCT = 2000                       // 20% — лимит X_18 в buyFromCurveFor
- bytes32 constant PARAM_BUY_FEE = keccak256("PARAM_BUY_FEE")
- bytes32 constant PARAM_REDEEM_FEE = keccak256("PARAM_REDEEM_FEE")
- bytes32 constant PARAM_EARLY_SELL_FEE = keccak256("PARAM_EARLY_SELL_FEE")
- bytes32 constant PARAM_EARLY_SELL_PERIOD = keccak256("PARAM_EARLY_SELL_PERIOD")
- bytes32 constant PARAM_MAX_PURCHASE_PCT = keccak256("PARAM_MAX_PURCHASE_PCT")
- bytes32 constant PARAM_MINIMAL_PURCHASE = keccak256("PARAM_MINIMAL_PURCHASE")
- bytes32 constant PARAM_MAX_SELL_PCT_PER_DAY = keccak256("PARAM_MAX_SELL_PCT_PER_DAY")
- bytes32 constant PARAM_CIRCUIT_BREAKER_THRESHOLD = keccak256("PARAM_CIRCUIT_BREAKER_THRESHOLD")
- bytes32 constant PARAM_SELL_TEAM_FEE = keccak256("PARAM_SELL_TEAM_FEE")     // НОВОЕ 13-я ИТЕРАЦИЯ
|↙ ПОТРЕБЛЯЕТ: — (нет зависимостей)
|↘ ПРЕДОСТАВЛЯЕТ:
- Константы точности и иммутабельные параметры
- bytes32-идентификаторы параметров для ParameterRegistry.register
|Реализация: Solidity `constant`.
|Примечания: НОВОЕ 13-я ИТЕРАЦИЯ:
- PARAM_SELL_TEAM_FEE — governance-параметр для комиссии команды с продаж. Bounds: 0–50 bp. Default: 10 bp (0.1%).
- Семантика: USDC-комиссия, применяется в redeemFromCurve и sellToPool. Переводится в treasury (immutable адрес). Не минтит токены — инвариант totalSupply == S_curve держится.
- Отличие от TEAM_PERCENT: TEAM_PERCENT — эмиссия (токены) на покупках в Vesting; sellTeamFee — USDC (комиссия) на продажах в treasury.
ИЗМЕНЕНО 11-я ИТЕРАЦИЯ: TIMELOCK_DELAY = 7 days; MAX_CURVE_FOR_PCT = 2000.

|C.2.01.04|Contracts|Math|Solidity|contracts/math/Errors.sol|—|v.0.0.02|Draft|§4|
|Описание: Кастомные ошибки. Только используемые.
|Публичный API:
- error InvalidAmount()
- error InvalidLevel()
- error InvalidAddress()
- error InvalidParam()
- error OutOfBounds()
- error ReserveInvariantViolation()
- error InsufficientFreeReserve()
- error InsufficientReserve()
- error InsufficientVestingBalance()
- error CircuitBreakerActive()
- error MathOverflow()
- error Unauthorized()
- error NotOwner()
- error SafeNotAdmin()
- error SafeNotPauser()
- error MaxBalanceExceeded()
- error MaxPurchaseExceeded()
- error MaxSellPerDayExceeded()
- error MinimalPurchaseNotMet()
- error DeadlineExpired()
- error SlippageExceeded()
- error AlreadyInitialized()
- error NotQueued()
- error AlreadyQueued()
- error CallFailed()
- error NotInitialized()                                          // НОВОЕ
- error MaxCurveForExceeded()                                     // НОВОЕ
|↙ ПОТРЕБЛЯЕТ: — (нет зависимостей)
|↘ ПРЕДОСТАВЛЯЕТ:
- Кастомные ошибки
|Реализация: Solidity `error`.
|Примечания: НОВОЕ 11-я ИТЕРАЦИЯ:
- NotInitialized(): buyFromCurve, redeemFromCurve, buyFromCurveFor, buyFromPool, sellToPool ревертят, если poolState.poolPrice() == 0. Закрывает окно между deploy и initializePoolPrice.
- MaxCurveForExceeded(): buyFromCurveFor ревертит, если X_18 > freeReserve * MAX_CURVE_FOR_PCT / BASIS_POINTS. Defense-in-depth при компрометации PoolController.
- УДАЛЕНО: Paused — не используется, OpenZeppelin Pausable бросает EnforcedPause. NotOwner — для initializeLevels/initializePoolPrice/registerParams. SafeNotAdmin — для finalize. SafeNotPauser — для finalize (проверка PAUSER_ROLE).

|C.2.01.05|Contracts|Math|Interface|contracts/math/ICurveMath.sol|C.2.01.01|v.0.0.01|Draft|§4|
|Описание: Интерфейс CurveMath для моков и внешних интеграций.
|Публичный API:
- function P(uint256 S, Level[] memory levels) external pure returns (uint256)
- function R(uint256 S, Level[] memory levels) external pure returns (uint256)
- function deltaSForBuy(uint256 S, uint256 X, Level[] memory levels) external pure returns (uint256)
- function amountForRedeem(uint256 S, uint256 deltaS, Level[] memory levels) external pure returns (uint256)
|↙ ПОТРЕБЛЯЕТ:
- C.2.01.01 CurveMath (реализация)
- C.2.01.11 Types (struct Level)
|↘ ПРЕДОСТАВЛЯЕТ:
- Типизированный интерфейс для моков
|Реализация: Interface-only.
|Примечания: Используется в тестах для подмены CurveMath. struct Level приходит из C.2.01.11 Types, не из C.2.01.09.

|C.2.01.06|Contracts|Math|Interface|contracts/math/ILevelMath.sol|C.2.01.02|v.0.0.01|Draft|§4|
|Описание: Интерфейс LevelMath: a_i, b_i, P_i(S), R_i(S), bounds.
|Публичный API:
- function a(Level memory level) external pure returns (uint256)
- function b(Level memory level) external pure returns (uint256)
- function P_i(uint256 S, Level memory level) external pure returns (uint256)
- function R_i(uint256 S, Level memory level) external pure returns (uint256)
- function inBounds(uint256 S, Level memory level) external pure returns (bool)
|↙ ПОТРЕБЛЯЕТ:
- C.2.01.02 LevelMath (реализация)
- C.2.01.11 Types (struct Level)
|↘ ПРЕДОСТАВЛЯЕТ:
- Типизированный интерфейс для моков
|Реализация: Interface-only.
|Примечания: Используется в тестах LevelMath. struct Level приходит из C.2.01.11 Types.

|C.2.01.07|Contracts|Math|Interface|contracts/math/IConstants.sol|C.2.01.03|v.0.0.01|Draft|§4.2|
|Описание: Интерфейс констант для внешних интеграций.
|Публичный API:
- function PRECISION() external pure returns (uint256)
- function USDC_PRECISION() external pure returns (uint256)
- function BASIS_POINTS() external pure returns (uint256)
|↙ ПОТРЕБЛЯЕТ:
- C.2.01.03 Constants
|↘ ПРЕДОСТАВЛЯЕТ:
- Доступ к константам для внешних контрактов
|Реализация: Interface-only.
|Примечания: Не обязательно к использованию, но полезно для интеграций.

|C.2.01.08|Contracts|Math|Interface|contracts/math/IErrors.sol|C.2.01.04|v.0.0.02|Draft|§4|
|Описание: Интерфейс ошибок для frontend.
|Публичный API:
- error InvalidAmount()
- error InvalidLevel()
- error InvalidAddress()
- error InvalidParam()
- error OutOfBounds()
- error ReserveInvariantViolation()
- error InsufficientFreeReserve()
- error InsufficientReserve()
- error InsufficientVestingBalance()
- error CircuitBreakerActive()
- error MathOverflow()
- error Unauthorized()
- error NotOwner()
- error SafeNotAdmin()
- error SafeNotPauser()
- error MaxBalanceExceeded()
- error MaxPurchaseExceeded()
- error MaxSellPerDayExceeded()
- error MinimalPurchaseNotMet()
- error DeadlineExpired()
- error SlippageExceeded()
- error AlreadyInitialized()
- error NotQueued()
- error AlreadyQueued()
- error CallFailed()
- error NotInitialized()                                          // НОВОЕ
- error MaxCurveForExceeded()                                     // НОВОЕ
|↙ ПОТРЕБЛЯЕТ:
- C.2.01.04 Errors
|↘ ПРЕДОСТАВЛЯЕТ:
- Схему для декодирования revert-данных
|Реализация: Interface-only.
|Примечания: Синхронизирован с C.2.01.04. НОВОЕ 11-я ИТЕРАЦИЯ: добавлены NotInitialized, MaxCurveForExceeded. УДАЛЕНО: Paused.

|C.2.01.09|Contracts|Math|Solidity|contracts/math/Levels.sol|C.2.01.03, C.2.01.04, C.2.01.11|v.0.0.01|Draft|§3.3|
|Описание: Таблица уровней предложения. Хранит S_start, S_end, P_start, P_end, maxBalance. Иммутабельна после деплоя.
|Публичный API:
- function init(Level[] memory newLevels) external onlyOwner
- function getLevel(uint256 S) external view returns (uint8)
- function getBounds(uint8 levelIndex) external view returns (uint256, uint256)
- function getMaxBalance(uint8 levelIndex) external view returns (uint256)
- function all() external view returns (Level[] memory)
- function length() external view returns (uint256)
|↙ ПОТРЕБЛЯЕТ:
- C.2.01.03 Constants (MAX_LEVELS)
- C.2.01.04 Errors (AlreadyInitialized, InvalidLevel, OutOfBounds)
- C.2.01.11 Types (struct Level)
- OpenZeppelin: Ownable
|↘ ПРЕДОСТАВЛЯЕТ:
- Таблицу уровней для CurveMath и контроллеров
- Определение текущего уровня по S_curve
|Реализация: Хранит Level[] в storage. init() — onlyOwner, вызывается один раз через XartIAFactory. Повторный init revert с AlreadyInitialized.
|Примечания: ИЗМЕНЕНИЕ: добавлены зависимости C.2.01.04 Errors, Ownable. b_i больше не хранится в struct — вычисляется на лету.

|C.2.01.10|Contracts|Math|Interface|contracts/math/ILevels.sol|C.2.01.09|v.0.0.01|Draft|§3.3|
|Описание: Интерфейс таблицы уровней для внешних интеграций, моков и Factory.
|Публичный API:
- function init(Level[] memory newLevels) external          // НОВОЕ: для Factory
- function getLevel(uint256 S) external view returns (uint8)
- function getBounds(uint8 levelIndex) external view returns (uint256, uint256)
- function getMaxBalance(uint8 levelIndex) external view returns (uint256)
- function all() external view returns (Level[] memory)
- function length() external view returns (uint256)
|↙ ПОТРЕБЛЯЕТ:
- C.2.01.09 Levels
- C.2.01.11 Types (struct Level)
|↘ ПРЕДОСТАВЛЯЕТ:
- Типизированный интерфейс для моков, frontend и Factory
|Реализация: Interface-only.
|Примечания: ИСПРАВЛЕНО: добавлен init для вызова из Factory.initializeLevels.

|C.2.01.11|Contracts|Math|Solidity|contracts/math/Types.sol|—|v.0.0.01|Draft|§3.3|
|Описание: Общие типы данных для библиотек математики. Разрывает циклическую зависимость между CurveMath и Levels.
|Публичный API:
- struct Level { uint256 S_start; uint256 S_end; uint256 P_start; uint256 P_end; uint256 maxBalance; }
|↙ ПОТРЕБЛЯЕТ: — (нет зависимостей)
|↘ ПРЕДОСТАВЛЯЕТ:
- struct Level для CurveMath, LevelMath, Levels, контроллеров
|Реализация: Solidity-библиотека типов. Только struct, никакой логики.
|Примечания: ИЗМЕНЕНИЕ: из struct убран b_i. b_i вычисляется на лету в LevelMath.b() как (P_end − P_start)/(S_end − S_start). Это уменьшает storage и устраняет неоднозначность «кто и когда считает b_i».

|C.2.01.12|Contracts|Math|Solidity|contracts/math/PoolState.sol|C.0.01.01, C.2.01.04|v.0.0.01|Draft|§6|
|Описание: Общее состояние пула. poolPrice хранится в 18 decimals (USDC per 1 XartIA token × 1e18). Одноразовая инициализация poolPrice. Dual-authority модель: Ownable для initializePoolPrice, AccessControl для setPool/setPoolPrice.
|Публичный API:
- constructor()
- function initializePoolPrice(uint256 initialPrice_18) external onlyOwner
- function pool() external view returns (uint256)               // 18-dec tokens
- function poolPrice() external view returns (uint256)          // 18-dec USDC per token
- function setPool(uint256 newPool) external onlyRole(POOL_WRITER_ROLE)
- function setPoolPrice(uint256 newPrice_18) external onlyRole(PRICE_WRITER_ROLE)
|↙ ПОТРЕБЛЯЕТ:
- C.0.01.01 Roles (POOL_WRITER_ROLE, PRICE_WRITER_ROLE)
- C.2.01.04 Errors (Unauthorized, AlreadyInitialized, InvalidAmount)
- C.10.01.01 Events (PoolPriceInitialized, PoolPriceUpdated)
- OpenZeppelin: Ownable, AccessControl
|↘ ПРЕДОСТАВЛЯЕТ:
- Хранение pool и poolPrice
- События PoolPriceInitialized (при инициализации) и PoolPriceUpdated (при каждом изменении цены)
|Реализация:
initializePoolPrice(initialPrice_18):
  (1) require(initialPrice_18 > 0, InvalidAmount)
  (2) require(poolPrice == 0, AlreadyInitialized)
  (3) poolPrice = initialPrice_18
  (4) эмиссия PoolPriceInitialized(initialPrice_18)
setPool(newPool):
  (1) pool = newPool
setPoolPrice(newPrice_18):
  (1) old = poolPrice
  (2) poolPrice = newPrice_18
  (3) эмиссия PoolPriceUpdated(old, newPrice_18)
|Примечания: ИСПРАВЛЕНО 7-я ИТЕРАЦИЯ: добавлено событие PoolPriceUpdated в setPoolPrice(). Ранее событие упоминалось в C.10.01.01 Events, но не эмитилось ни одним контрактом — это создавало пробел для индексатора. Теперь PoolState эмитит его при каждом изменении poolPrice. Индексатор может отслеживать динамику poolPrice.
- Dual-authority модель: Ownable для initializePoolPrice (одноразово), AccessControl для регулярных обновлений. Owner теряется в finalize() через transferOwnership(safe). DEFAULT_ADMIN_ROLE отзывается через renounceRole. См. R.2.01.08 security-model.md.
- poolPrice хранится в 18 decimals. initialPrice_18 принимается в 18-dec. В config (D.2.01.01) p0 указывается в 6-dec (2000), в D.1.01.02 Initialize.s.sol конвертируется в 18-dec (2e15) через умножение на 1e12.

|C.2.01.13|Contracts|Math|Solidity|contracts/math/CurveMathWrapper.sol|C.2.01.01, C.2.01.11|v.0.0.01|Draft|§4|
|Описание: Production-wrapper над internal-библиотекой CurveMath.
|Публичный API:
- function P(uint256 S, Level[] memory levels) external pure returns (uint256)
- function R(uint256 S, Level[] memory levels) external pure returns (uint256)
- function deltaSForBuy(uint256 S, uint256 X, Level[] memory levels) external pure returns (uint256)
- function amountForRedeem(uint256 S, uint256 deltaS, Level[] memory levels) external pure returns (uint256)
- function getLevel(uint256 S, Level[] memory levels) external pure returns (uint8)
|↙ ПОТРЕБЛЯЕТ:
- C.2.01.01 CurveMath
- C.2.01.11 Types
|↘ ПРЕДОСТАВЛЯЕТ:
- External-доступ к математике
|Реализация: Каждая external-функция делегирует internal CurveMath.
|Примечания: ИСПРАВЛЕНО: убрана зависимость C.2.01.04 Errors — MathOverflow пробрасывается автоматически из internal, не требует явной зависимости.

|C.2.01.14|Contracts|Math|Interface|contracts/math/IPoolState.sol|C.2.01.12|v.0.0.01|Draft|§6|
|Описание: Интерфейс PoolState. Все величины в 18 decimals.
|Публичный API:
- function initializePoolPrice(uint256 initialPrice_18) external
- function pool() external view returns (uint256)
- function poolPrice() external view returns (uint256)
- function setPool(uint256 newPool) external
- function setPoolPrice(uint256 newPrice_18) external
|↙ ПОТРЕБЛЯЕТ:
- C.2.01.12 PoolState
|↘ ПРЕДОСТАВЛЯЕТ:
- Типизированный интерфейс для Factory и PoolController
|Реализация: Interface-only.
|Примечания: УТОЧНЕНО: poolPrice в 18 decimals. Параметры переименованы в *_18 для явности.

|C.3.01.01|Contracts|Controllers|Solidity|contracts/controllers/CurveController.sol|C.0.01.01, C.1.01.02, C.2.01.01, C.2.01.04, C.2.01.10, C.2.01.11, C.2.01.12, C.4.01.02, C.5.01.01, C.6.01.01, C.9.01.02, C.10.01.01|v.0.0.05|Draft|§5|
|Описание: Контроллер bonding curve. Единая семантика minP. Сеттеры защищены onlyRole(GOVERNANCE_ROLE). earlySellPeriod == 0 отключает earlySellFee. Проверка maxBalance — по финальному уровню newS. lastBuyTime обновляется через buyFromCurve, buyFromCurveFor и setLastBuyTime.
НОВОЕ 11-я ИТЕРАЦИЯ:
- buyFromCurveFor САМ тянет USDC через safeTransferFrom(msg.sender, reserveManager, X_6). Caller (PoolController) должен предварительно approve.
- buyFromCurveFor защищён immutable poolController (require msg.sender == poolController), НЕ ролью.
- buyFromCurveFor проверяет X_18 <= freeReserve * MAX_CURVE_FOR_PCT / BASIS_POINTS при S_curve() > 0.
- buyFromCurve, redeemFromCurve, buyFromCurveFor требуют poolState.poolPrice() > 0.
- buyFromCurve и buyFromCurveFor после роста S_curve поднимают poolPrice до floor = P(newS)/(1+MAX_GAP).
- redeemFromCurve дополнительно применяет floor (defensive).
ИСПРАВЛЕНО 12-я ИТЕРАЦИЯ:
- КРИТИЧНО: genesis-исключение для MAX_CURVE_FOR_PCT (шаг 2b) при S_curve() > 0.
- КРИТИЧНО: нормализация X_18 = toWei(toUSDC(X_18)) (шаг 2a).
- КОСМЕТИКА: шаги 2a (нормализация) и 2b (лимит) переупорядочены.
НОВОЕ 13-я ИТЕРАЦИЯ:
- НОВОЕ: параметр sellTeamFee (0–50 bp, default 10 bp). Применяется в redeemFromCurve как USDC-комиссия с gross amount_18. Переводится в immutable treasury через reserveManager.pay(treasury, sell_team_fee_18).
- НОВОЕ: immutable treasury в конструкторе. Валидация: treasury != address(0).
- НОВОЕ: сеттер setSellTeamFee(uint256) onlyRole(GOVERNANCE_ROLE), bounds 0–50 bp, событие SellTeamFeeUpdated.
- НОВОЕ: геттер sellTeamFee() и treasury().
- ИЗМЕНЕНО: событие Redeem расширено полем sellTeamFee.
|Публичный API:
- constructor(address reserveManager_, address vesting_, address circuitBreaker_, address poolState_, address token_, address levels_, address usdc_, address treasury_)
- function setPoolController(address poolController_) external onlyOwner
- function poolController() external view returns (address)
- function treasury() external view returns (address)                                    // НОВОЕ
- function sellTeamFee() external view returns (uint256)                                 // НОВОЕ
- function setSellTeamFee(uint256) external onlyRole(GOVERNANCE_ROLE)                    // НОВОЕ: bounds 0–50 bp
- function buyFromCurve(uint256 X_6, uint256 minTokensOut, uint256 deadline) external nonReentrant whenNotPaused returns (uint256 userTokens)
- function redeemFromCurve(uint256 deltaS, uint256 minUsdcOut, uint256 deadline) external nonReentrant whenNotPaused returns (uint256 userAmount)
- function buyFromCurveFor(address buyer, uint256 X_18, uint256 minTokensOut, uint256 deadline) external nonReentrant whenNotPaused returns (uint256 userTokens)
- function setLastBuyTime(address user, uint256 timestamp) external
- function effectiveMinimalX6() external view returns (uint256)
- function S_curve() external view returns (uint256)
- function reserve() external view returns (uint256)
- function token() external view returns (address)
- function levels() external view returns (address)
- function vesting() external view returns (address)
- function reserveManager() external view returns (address)
- function circuitBreaker() external view returns (address)
- function poolState() external view returns (address)
- function usdc() external view returns (address)
- function buyFee() external view returns (uint256)
- function redeemFee() external view returns (uint256)
- function earlySellFee() external view returns (uint256)
- function earlySellPeriod() external view returns (uint256)
- function maxPurchasePct() external view returns (uint256)
- function minimalPurchase() external view returns (uint256)
- function lastBuyTime(address) external view returns (uint256)
- function setBuyFee(uint256) external onlyRole(GOVERNANCE_ROLE)          // bounds: 0–200 bp
- function setRedeemFee(uint256) external onlyRole(GOVERNANCE_ROLE)       // bounds: 0–200 bp
- function setEarlySellFee(uint256) external onlyRole(GOVERNANCE_ROLE)    // bounds: 0–500 bp
- function setEarlySellPeriod(uint256) external onlyRole(GOVERNANCE_ROLE) // bounds: 0–7776000 секунд
- function setMaxPurchasePct(uint256) external onlyRole(GOVERNANCE_ROLE)  // bounds: 0–1000 bp
- function setMinimalPurchase(uint256) external onlyRole(GOVERNANCE_ROLE) // bounds: 1e6–1e12
- function pause() external onlyRole(PAUSER_ROLE)
- function unpause() external onlyRole(GOVERNANCE_ROLE)
|↙ ПОТРЕБЛЯЕТ:
- C.0.01.01 Roles (GOVERNANCE_ROLE, PAUSER_ROLE)
- C.1.01.02 IXartIAToken (mint, burnFrom, balanceOf)
- C.2.01.01 CurveMath
- C.2.01.04 Errors (OutOfBounds, SlippageExceeded, DeadlineExpired, MinimalPurchaseNotMet, MaxPurchaseExceeded, MaxBalanceExceeded, InvalidAmount, Unauthorized, NotInitialized, MaxCurveForExceeded, InvalidAddress)
- C.2.01.10 ILevels (all, getLevel, getMaxBalance)
- C.2.01.11 Types (struct Level)
- C.2.01.12 PoolState (poolPrice, setPoolPrice)
- C.4.01.02 IReserveManager (updateScurve, pay, S_curve, reserve, freeReserve)
- C.5.01.01 Vesting (addTokens)
- C.6.01.01 CircuitBreaker (active)
- C.9.01.02 PrecisionLib (toUSDC, fromUSDC, toWei)
- C.10.01.01 Events
- OpenZeppelin: IERC20, SafeERC20, AccessControl, ReentrancyGuard, Pausable, Ownable
|↘ ПРЕДОСТАВЛЯЕТ:
- buyFromCurve / redeemFromCurve / buyFromCurveFor
- setLastBuyTime() — вызывается из PoolController.buyFromPool
- effectiveMinimalX6() — view для frontend/UX
- sellTeamFee() / treasury() — view для PoolController и frontend   // НОВОЕ
- Сеттеры с проверкой bounds и эмиссией событий
|Реализация:
constructor(..., treasury_):
  (0) require(treasury_ != address(0), InvalidAddress)             // НОВОЕ
  ... (остальные immutable как раньше)
  (N) treasury = treasury_
setPoolController(poolController_):
  (0) require(poolController_ != address(0), InvalidAddress)
  (1) require(poolController == address(0), AlreadyInitialized)
  (2) poolController = poolController_
setLastBuyTime(user, timestamp):
  (0) require(msg.sender == poolController, Unauthorized)
  (1) lastBuyTime[user] = timestamp
effectiveMinimalX6():
  uint256 minP = minimalPurchase
  uint256 bp = BASIS_POINTS
  return (minP * bp + (bp − buyFee) − 1) / (bp − buyFee)
setSellTeamFee(newFee):                                            // НОВОЕ
  (1) require(newFee <= 50, OutOfBounds)   // bounds 0–50 bp, синхронизировано с registerParams
  (2) old = sellTeamFee
  (3) sellTeamFee = newFee
  (4) эмиссия SellTeamFeeUpdated(old, newFee)
setBuyFee(newFee):
  (1) require(newFee <= 200, OutOfBounds)
  (2) old = buyFee
  (3) buyFee = newFee
  (4) эмиссия BuyFeeUpdated(old, newFee)
setRedeemFee(newFee):
  (1) require(newFee <= 200, OutOfBounds)
  ...
setEarlySellFee(newFee):
  (1) require(newFee <= 500, OutOfBounds)
  ...
setEarlySellPeriod(newPeriod):
  (1) require(newPeriod <= 7776000, OutOfBounds)
  ...
setMaxPurchasePct(newPct):
  (1) require(newPct <= 1000, OutOfBounds)
  ...
setMinimalPurchase(newMin):
  (1) require(newMin >= 1e6 && newMin <= 1e12, OutOfBounds)
  ...
buyFromCurve(X_6, minOut, deadline):
  (0) require(poolState.poolPrice() > 0, NotInitialized)
  (1) require(deadline == 0 || block.timestamp <= deadline, DeadlineExpired)
  (2) X_18 = PrecisionLib.fromUSDC(X_6)
  (3) require(X_6 >= effectiveMinimalX6(), MinimalPurchaseNotMet)
  (4) fee_18 = X_18 * buyFee / BASIS_POINTS
  (5) X_net_18 = X_18 − fee_18
  (6) Level[] memory levels_arr = ILevels(levels).all()
  (7) ΔS = CurveMath.deltaSForBuy(S_curve(), X_net_18, levels_arr)
  (8) require(minOut == 0 || ΔS >= minOut, SlippageExceeded)
  (9) если S_curve() > 0:
        require(ΔS <= maxPurchasePct * S_curve() / BASIS_POINTS, MaxPurchaseExceeded)
  (10) teamTokens = ΔS * TEAM_PERCENT / BASIS_POINTS
  (11) newS = S_curve() + ΔS
  (12) level_old = ILevels(levels).getLevel(S_curve())
       level_new = ILevels(levels).getLevel(newS)
  (13) require(IXartIAToken(token).balanceOf(msg.sender) + ΔS − teamTokens <= ILevels(levels).getMaxBalance(level_new), MaxBalanceExceeded)
  (14) IERC20(usdc).safeTransferFrom(msg.sender, reserveManager, X_6)
  (15) было_active = circuitBreaker.active()
  (16) IXartIAToken(token).mint(msg.sender, ΔS − teamTokens)
  (17) IXartIAToken(token).mint(vesting(), teamTokens)
  (18) IVesting(vesting()).addTokens(teamTokens)
  (19) lastBuyTime[msg.sender] = block.timestamp
  (20) reserveManager.updateScurve(newS)
  (21) _enforcePoolPriceFloor(newS, levels_arr)
  (22) эмиссия TeamFee, Buy(msg.sender, X_18, ΔS − teamTokens, fee_18, teamTokens, newS, reserve(), level_new)
  (23) если level_new != level_old: эмиссия LevelChanged
  (24) если !было_active && circuitBreaker.active(): эмиссия CircuitBreakerTriggered
buyFromCurveFor(buyer, X_18, minOut, deadline):
  (0) require(msg.sender == poolController, Unauthorized)
  (0a) require(poolState.poolPrice() > 0, NotInitialized)
  (1) require(deadline == 0 || block.timestamp <= deadline, DeadlineExpired)
  (2) require(X_18 > 0, InvalidAmount)
  (2a) X_18 = PrecisionLib.toWei(PrecisionLib.toUSDC(X_18))     // нормализация
  (2b) если S_curve() > 0:                                       // genesis-исключение
        require(X_18 <= IReserveManager(reserveManager).freeReserve() * MAX_CURVE_FOR_PCT / BASIS_POINTS, MaxCurveForExceeded)
  (3) Level[] memory levels_arr = ILevels(levels).all()
  (4) ΔS = CurveMath.deltaSForBuy(S_curve(), X_18, levels_arr)
  (5) require(minOut == 0 || ΔS >= minOut, SlippageExceeded)
  (6) если S_curve() > 0:
        require(ΔS <= maxPurchasePct * S_curve() / BASIS_POINTS, MaxPurchaseExceeded)
  (7) teamTokens = ΔS * TEAM_PERCENT / BASIS_POINTS
  (8) newS = S_curve() + ΔS
  (9) level_old = ILevels(levels).getLevel(S_curve())
      level_new = ILevels(levels).getLevel(newS)
  (10) require(IXartIAToken(token).balanceOf(buyer) + ΔS − teamTokens <= ILevels(levels).getMaxBalance(level_new), MaxBalanceExceeded)
  (11) IERC20(usdc).safeTransferFrom(msg.sender, reserveManager, PrecisionLib.toUSDC(X_18))
  (12) было_active = circuitBreaker.active()
  (13) IXartIAToken(token).mint(buyer, ΔS − teamTokens)
  (14) IXartIAToken(token).mint(vesting(), teamTokens)
  (15) IVesting(vesting()).addTokens(teamTokens)
  (16) lastBuyTime[buyer] = block.timestamp
  (17) reserveManager.updateScurve(newS)
  (18) _enforcePoolPriceFloor(newS, levels_arr)
  (19) эмиссия TeamFee, Buy(buyer, X_18, ΔS − teamTokens, 0, teamTokens, newS, reserve(), level_new)
  (20) если level_new != level_old: эмиссия LevelChanged
  (21) если !было_active && circuitBreaker.active(): эмиссия CircuitBreakerTriggered
redeemFromCurve(deltaS, minOut, deadline):
  (0) require(deltaS > 0, InvalidAmount)
  (0a) require(poolState.poolPrice() > 0, NotInitialized)
  (1) require(deadline == 0 || block.timestamp <= deadline, DeadlineExpired)
  (2) IXartIAToken(token).burnFrom(msg.sender, deltaS)
  (3) Level[] memory levels_arr = ILevels(levels).all()
  (4) amount_18 = CurveMath.amountForRedeem(S_curve(), deltaS, levels_arr)
  (5) fee_18 = amount_18 * redeemFee / BASIS_POINTS
  (6) early_fee_18 = 0
  (7) если block.timestamp < lastBuyTime[msg.sender] + earlySellPeriod:
        early_fee_18 = amount_18 * earlySellFee / BASIS_POINTS
  (7a) sell_team_fee_18 = amount_18 * sellTeamFee / BASIS_POINTS
  (8) user_amount_18 = amount_18 − fee_18 − early_fee_18 − sell_team_fee_18
  (9) user_amount_6 = PrecisionLib.toUSDC(user_amount_18)
  (10) require(minOut == 0 || user_amount_6 >= minOut, SlippageExceeded)
  (11) было_active = circuitBreaker.active()
  (12) newS = S_curve() − deltaS
  (12a) level_old = ILevels(levels).getLevel(S_curve())                // ИСПРАВЛЕНО 13-я ИТЕРАЦИЯ (ревизия 2)
  (12b) level_new = ILevels(levels).getLevel(newS)                     // ИСПРАВЛЕНО 13-я ИТЕРАЦИЯ (ревизия 2)
  (13) reserveManager.pay(msg.sender, user_amount_18)
  (13a) если sell_team_fee_18 > 0: reserveManager.pay(treasury, sell_team_fee_18)
  (14) reserveManager.updateScurve(newS)
  (15) P_newS = CurveMath.P(newS, levels_arr)
       ceiling = P_newS * (BASIS_POINTS + MAX_GAP) / BASIS_POINTS
       floor = P_newS * BASIS_POINTS / (BASIS_POINTS + MAX_GAP)
       uint256 cur = poolState.poolPrice()
       если cur > ceiling: poolState.setPoolPrice(ceiling)
       иначе если cur < floor: poolState.setPoolPrice(floor)
  (16) эмиссия Redeem(seller=msg.sender, tokensIn=deltaS, usdcOut=user_amount_18,
                      fee=fee_18, earlyFee=early_fee_18, sellTeamFee=sell_team_fee_18,
                      newScurve=newS, newReserve=reserve(), newLevel=level_new)
  (17) если level_new != level_old: эмиссия LevelChanged
  (18) если !было_active && circuitBreaker.active(): эмиссия CircuitBreakerTriggered
_enforcePoolPriceFloor(newS, levels_arr):
  (1) P_newS = CurveMath.P(newS, levels_arr)
  (2) floor = P_newS * BASIS_POINTS / (BASIS_POINTS + MAX_GAP)
  (3) uint256 cur = poolState.poolPrice()
  (4) если cur < floor: poolState.setPoolPrice(floor)
|Примечания: НОВОЕ 13-я ИТЕРАЦИЯ:
- sellTeamFee — USDC-комиссия с продаж в treasury. Применяется в redeemFromCurve на gross amount_18. User получает amount_18 − redeemFee − earlyFee − sellTeamFee. Treasury получает sellTeamFee через reserveManager.pay(treasury, ...).
- ReserveManager.pay(treasury, ...) требует CONTROLLER_ROLE у CurveController — уже есть.
- treasury — immutable, валидируется в конструкторе. Default в Factory — safe.
- Инвариант reserve >= R(S_curve): reserve_new = reserve_old − (amount_18 − redeemFee − earlyFee), R(S_new) = R(S) − amount_18, freeReserve_new = freeReserve_old + redeemFee + earlyFee ≥ 0. Инвариант держится.
- totalSupply == S_curve: токены не минтим, только USDC. Инвариант держится.
- Round-trip cost (buy + immediate redeem): buyFee 0.5% + redeemFee 0.5% + sellTeamFee 0.1% + (earlySellFee если активен) = 1.1% базово.
ИСПРАВЛЕНО 12-я ИТЕРАЦИЯ: genesis-исключение MAX_CURVE_FOR_PCT, нормализация X_18, порядок 2a/2b.
НОВОЕ 11-я ИТЕРАЦИЯ: pull-модель, immutable poolController, симметричный коридор, гейт инициализации.
ИСПРАВЛЕНО 13-я ИТЕРАЦИЯ (ревизия 2): в redeemFromCurve добавлены шаги (12a) и (12b) — вычисление level_old и level_new. Ранее шаг (16) эмиссии Redeem и шаг (17) LevelChanged ссылались на level_new, которая не была определена в псевдокоде. Баг спецификации: событие Redeem в поле newLevel и условие LevelChanged не могли быть реализованы по псевдокоду без домысливания. Теперь level_old = getLevel(S_curve()) до updateScurve, level_new = getLevel(newS). Это соответствует семантике maxBalance (проверка по финальному уровню) и логике LevelChanged в buyFromCurve/buyFromCurveFor.

|C.3.01.02|Contracts|Controllers|Solidity|contracts/controllers/PoolController.sol|C.0.01.01, C.1.01.02, C.2.01.01, C.2.01.04, C.2.01.10, C.2.01.11, C.2.01.12, C.3.01.03, C.4.01.02, C.6.01.01, C.9.01.02, C.10.01.01|v.0.0.05|Draft|§6|
|Описание: Контроллер внутреннего пула. Все внутренние вычисления USDC в 18 decimals. Единая семантика minP. lastBuyTime обновляется через ICurveController.setLastBuyTime.
НОВОЕ 11-я ИТЕРАЦИЯ:
- buyFromPool переводит USDC частями: pool-часть → reserveManager, cascade-часть остаётся в PoolController и approve для CurveController. buyFromCurveFor сам тянет USDC.
- sellToPool блокируется при poolState.poolPrice() == 0 (NotInitialized).
ИСПРАВЛЕНО 12-я ИТЕРАЦИЯ:
- КРИТИЧНО: шаг (11a): fee_18 → reserveManager.
- КРИТИЧНО: шаг (11b): sweep-dust. Инвариант balanceOf(PoolController) == 0 между транзакциями.
НОВОЕ 13-я ИТЕРАЦИЯ:
- НОВОЕ: immutable treasury в конструкторе.
- НОВОЕ: sellTeamFee применяется в sellToPool. Читается через ICurveController.sellTeamFee(). Переводится в treasury через reserveManager.pay(treasury, sell_team_fee_18).
- ИЗМЕНЕНО: событие SellToPool расширено полем sellTeamFee.
- ИЗМЕНЕНО: проверка freeReserve учитывает sellTeamFee: amount_user_18 + sell_team_fee_18 <= freeReserve.
|Публичный API:
- constructor(address curveController_, address reserveManager_, address circuitBreaker_, address poolState_, address token_, address levels_, address usdc_, address treasury_)
- function treasury() external view returns (address)                                    // НОВОЕ
- function buyFromPool(uint256 X_6, uint256 minTokensOut, uint256 deadline) external nonReentrant whenNotPaused returns (uint256 userTokens)
- function sellToPool(uint256 deltaP, uint256 minUsdcOut_6, uint256 deadline) external nonReentrant whenNotPaused returns (uint256 userAmount_6)
- function pool() external view returns (uint256)
- function poolPrice() external view returns (uint256)
- function maxSellPctPerDay() external view returns (uint256)
- function dailySold(address) external view returns (uint256)
- function lastResetDay(address) external view returns (uint256)
- function token() external view returns (address)
- function levels() external view returns (address)
- function curveController() external view returns (address)
- function reserveManager() external view returns (address)
- function circuitBreaker() external view returns (address)
- function poolState() external view returns (address)
- function usdc() external view returns (address)
- function effectiveMinimalX6() external view returns (uint256)
- function setMaxSellPctPerDay(uint256) external onlyRole(GOVERNANCE_ROLE)   // bounds: 0–500 bp
- function pause() external onlyRole(PAUSER_ROLE)
- function unpause() external onlyRole(GOVERNANCE_ROLE)
|↙ ПОТРЕБЛЯЕТ:
- C.0.01.01 Roles (POOL_WRITER_ROLE, PRICE_WRITER_ROLE, GOVERNANCE_ROLE, PAUSER_ROLE)
- C.1.01.02 IXartIAToken (transfer, transferFrom, balanceOf)
- C.2.01.01 CurveMath (P)
- C.2.01.04 Errors (OutOfBounds, SlippageExceeded, DeadlineExpired, MinimalPurchaseNotMet, CircuitBreakerActive, InvalidAmount, InsufficientFreeReserve, MaxSellPerDayExceeded, NotInitialized, InvalidAddress)
- C.2.01.10 ILevels (all)
- C.2.01.11 Types (struct Level)
- C.2.01.12 PoolState (setPool, setPoolPrice)
- C.3.01.03 ICurveController (buyFromCurveFor, effectiveMinimalX6, S_curve, buyFee, redeemFee, minimalPurchase, setLastBuyTime, sellTeamFee)   // + sellTeamFee
- C.4.01.02 IReserveManager (freeReserve, pay, reserve, S_curve)
- C.6.01.01 CircuitBreaker (active)
- C.9.01.02 PrecisionLib (toUSDC, fromUSDC)
- C.10.01.01 Events
- OpenZeppelin: IERC20, SafeERC20, AccessControl, ReentrancyGuard, Pausable
|↘ ПРЕДОСТАВЛЯЕТ:
- buyFromPool / sellToPool
- Обновление poolPrice через PoolState
- effectiveMinimalX6() — прокси
- Обновление lastBuyTime через ICurveController.setLastBuyTime
- treasury() — view для frontend                                                  // НОВОЕ
|Реализация:
constructor(..., treasury_):
  (0) require(treasury_ != address(0), InvalidAddress)             // НОВОЕ
  ... (остальные immutable как раньше)
  (N) treasury = treasury_
setMaxSellPctPerDay(newPct):
  (1) require(newPct <= 500, OutOfBounds)
  (2) old = maxSellPctPerDay
  (3) maxSellPctPerDay = newPct
  (4) эмиссия MaxSellPctPerDayUpdated(old, newPct)
effectiveMinimalX6():
  return ICurveController(curveController).effectiveMinimalX6()
buyFromPool(X_6, minOut, deadline):
  (1)  require(deadline == 0 || block.timestamp <= deadline, DeadlineExpired)
  (2)  require(poolState.poolPrice() > 0, NotInitialized)
  (3)  X_18 = PrecisionLib.fromUSDC(X_6)
  (4)  require(X_6 >= ICurveController(curveController).effectiveMinimalX6(), MinimalPurchaseNotMet)
  (5)  fee_18 = X_18 * ICurveController(curveController).buyFee() / BASIS_POINTS
  (6)  X_net_18 = X_18 − fee_18
  (7)  tokensNeeded = X_net_18 * PRECISION / poolState.poolPrice()
  (8)  tokens_from_pool = min(poolState.pool(), tokensNeeded)
  (9)  X_pool_used_18 = tokens_from_pool * poolState.poolPrice() / PRECISION
  (10) X_remaining_18 = X_net_18 − X_pool_used_18
  (11) IERC20(usdc).safeTransferFrom(msg.sender, address(this), X_6)
  (11a) IERC20(usdc).safeTransfer(reserveManager, PrecisionLib.toUSDC(fee_18))
  (12) tokens_from_curve = 0
  (13) если tokens_from_pool > 0:
        poolState.setPool(poolState.pool() − tokens_from_pool)
        если X_remaining_18 == 0:
          level_cur = ILevels(levels).getLevel(IReserveManager(reserveManager).S_curve())
          require(IXartIAToken(token).balanceOf(msg.sender) + tokens_from_pool
                  <= ILevels(levels).getMaxBalance(level_cur), MaxBalanceExceeded)
        IERC20(usdc).safeTransfer(reserveManager, PrecisionLib.toUSDC(X_pool_used_18))
        IXartIAToken(token).safeTransfer(msg.sender, tokens_from_pool)
  (14) если X_remaining_18 > 0:
        uint256 X_remaining_6 = PrecisionLib.toUSDC(X_remaining_18)
        IERC20(usdc).forceApprove(curveController, X_remaining_6)
        minOut_curve = minOut > tokens_from_pool ? minOut − tokens_from_pool : 0
        tokens_from_curve = ICurveController(curveController).buyFromCurveFor(msg.sender, X_remaining_18, minOut_curve, deadline)
        IERC20(usdc).forceApprove(curveController, 0)
  (14a) ICurveController(curveController).setLastBuyTime(msg.sender, block.timestamp)
  (14b) uint256 leftover_6 = IERC20(usdc).balanceOf(address(this))
        если leftover_6 > 0: IERC20(usdc).safeTransfer(reserveManager, leftover_6)
  (15) эмиссия BuyFromPool(buyer=msg.sender, usdcIn=X_18, tokensFromPool=tokens_from_pool,
                           tokensFromCurve=tokens_from_curve, fee=fee_18,
                           newPool=poolState.pool(), newPoolPrice=poolState.poolPrice(),
                           newScurve=IReserveManager(reserveManager).S_curve(),
                           newReserve=IReserveManager(reserveManager).reserve())
sellToPool(deltaP, minUsdcOut_6, deadline):
  (0) require(deltaP > 0, InvalidAmount)
  (1) require(deadline == 0 || block.timestamp <= deadline, DeadlineExpired)
  (2) require(poolState.poolPrice() > 0, NotInitialized)
  (3) require(!circuitBreaker.active(), CircuitBreakerActive)
  (4)  IXartIAToken(token).safeTransferFrom(msg.sender, address(this), deltaP)
  (5) day = block.timestamp / 1 days
        если lastResetDay[msg.sender] != day:
          dailySold[msg.sender] = 0
          lastResetDay[msg.sender] = day
  (6) require(dailySold[msg.sender] + deltaP <= maxSellPctPerDay * IReserveManager(reserveManager).S_curve() / BASIS_POINTS, MaxSellPerDayExceeded)
  (7) amount_gross_18 = deltaP * poolState.poolPrice() / PRECISION
  (8) fee_18 = amount_gross_18 * ICurveController(curveController).redeemFee() / BASIS_POINTS
  (8a) sell_team_fee_18 = amount_gross_18 * ICurveController(curveController).sellTeamFee() / BASIS_POINTS   // НОВОЕ
  (9) amount_user_18 = amount_gross_18 − fee_18 − sell_team_fee_18                     // ИЗМЕНЕНО: было amount_18 = amount_gross − fee
  (10) require(amount_user_18 + sell_team_fee_18 <= IReserveManager(reserveManager).freeReserve(), InsufficientFreeReserve)   // ИЗМЕНЕНО
  (11) require(minUsdcOut_6 == 0 || PrecisionLib.toUSDC(amount_user_18) >= minUsdcOut_6, SlippageExceeded)   // ИЗМЕНЕНО: amount_user_18
  (12) было_active = circuitBreaker.active()
  (13) dailySold[msg.sender] += deltaP
  (14) IReserveManager(reserveManager).pay(msg.sender, amount_user_18)                 // ИЗМЕНЕНО: amount_user_18
  (14a) если sell_team_fee_18 > 0: IReserveManager(reserveManager).pay(treasury, sell_team_fee_18)   // НОВОЕ
  (15) poolState.setPool(poolState.pool() + deltaP)
  (16) Level[] memory levels_arr = ILevels(levels).all()
       P_S = CurveMath.P(IReserveManager(reserveManager).S_curve(), levels_arr)
       q_bp = min(deltaP * BASIS_POINTS / max(IReserveManager(reserveManager).S_curve(), 1), MAX_SOLD_PCT)
       mult_bp = BASIS_POINTS + K * q_bp / BASIS_POINTS
       newPrice = min(poolState.poolPrice() * mult_bp / BASIS_POINTS, P_S * (BASIS_POINTS + MAX_GAP) / BASIS_POINTS)
  (17) poolState.setPoolPrice(newPrice)
  (18) эмиссия SellToPool(seller=msg.sender, tokensIn=deltaP, usdcOut=amount_user_18,
                          fee=fee_18, sellTeamFee=sell_team_fee_18,
                          newPool=poolState.pool(), newPoolPrice=newPrice, newReserve=reserve())   // ИЗМЕНЕНО
  (19) если !было_active && circuitBreaker.active(): эмиссия CircuitBreakerTriggered
|Примечания: НОВОЕ 13-я ИТЕРАЦИЯ:
- sellTeamFee читается через ICurveController(curveController).sellTeamFee() — single source of truth в CurveController.
- treasury — immutable в конструкторе. Обычно treasury == safe, но может быть отдельный адрес.
- sellTeamFee применяется в sellToPool на gross amount_gross_18. User получает amount_gross − redeemFee − sellTeamFee, treasury получает sellTeamFee.
- reserveManager.pay(treasury, ...) требует CONTROLLER_ROLE у PoolController — уже есть.
- Инвариант reserve >= R(S_curve): reserve_new = reserve_old − (amount_gross − redeemFee), R(S) unchanged. freeReserve_new = freeReserve_old − (amount_gross − redeemFee − sellTeamFee) − sellTeamFee = freeReserve_old − (amount_gross − redeemFee). То же самое, что без sellTeamFee. Инвариант держится.
- totalSupply == S_curve: не трогается (токены сжигаются в redeemFromCurve, не здесь).
- Проверка freeReserve: amount_user_18 + sell_team_fee_18 = amount_gross − redeemFee. Учитывает, что sellTeamFee тоже уходит из reserve.
- minUsdcOut_6 проверяется по amount_user_18 (то, что получит user).
- Событие SellToPool: usdcOut = amount_user_18 (user), sellTeamFee = sell_team_fee_18 (treasury).
ИСПРАВЛЕНО 12-я ИТЕРАЦИЯ: fee_18 → reserveManager (шаг 11a), sweep-dust (шаг 11b).
НОВОЕ 11-я ИТЕРАЦИЯ: pull-модель в каскаде, NotInitialized, forceApprove.

|C.3.01.03|Contracts|Controllers|Interface|contracts/controllers/ICurveController.sol|C.3.01.01|v.0.0.03|Draft|§5|
|Описание: Интерфейс CurveController. Включает setPoolController, setLastBuyTime, sellTeamFee, treasury.
|Публичный API:
- function setPoolController(address poolController_) external
- function poolController() external view returns (address)
- function treasury() external view returns (address)                              // НОВОЕ
- function sellTeamFee() external view returns (uint256)                           // НОВОЕ
- function setSellTeamFee(uint256) external                                        // НОВОЕ
- function buyFromCurve(uint256 X_6, uint256 minTokensOut, uint256 deadline) external returns (uint256)
- function redeemFromCurve(uint256 deltaS, uint256 minUsdcOut_6, uint256 deadline) external returns (uint256)
- function buyFromCurveFor(address buyer, uint256 X_18, uint256 minTokensOut, uint256 deadline) external returns (uint256)
- function setLastBuyTime(address user, uint256 timestamp) external
- function effectiveMinimalX6() external view returns (uint256)
- function S_curve() external view returns (uint256)
- function reserve() external view returns (uint256)
- function buyFee() external view returns (uint256)
- function redeemFee() external view returns (uint256)
- function minimalPurchase() external view returns (uint256)
- function setBuyFee(uint256) external
- function setRedeemFee(uint256) external
- function setEarlySellFee(uint256) external
- function setEarlySellPeriod(uint256) external
- function setMaxPurchasePct(uint256) external
- function setMinimalPurchase(uint256) external
- function pause() external
- function unpause() external
|↙ ПОТРЕБЛЯЕТ:
- C.3.01.01 CurveController
|↘ ПРЕДОСТАВЛЯЕТ:
- Типизированный интерфейс для PoolController, Factory и frontend
- sellTeamFee() для PoolController (read)                                         // НОВОЕ
- treasury() для frontend и внешних интеграций                                    // НОВОЕ
|Реализация: Interface-only.
|Примечания: НОВОЕ 13-я ИТЕРАЦИЯ: добавлены treasury(), sellTeamFee(), setSellTeamFee(). PoolController читает sellTeamFee через этот интерфейс.
ИЗМЕНЕНО 11-я ИТЕРАЦИЯ: buyFromCurveFor защищён immutable poolController; добавлены setPoolController, poolController.

|C.3.01.04|Contracts|Controllers|Interface|contracts/controllers/IPoolController.sol|C.3.01.02|v.0.0.02|Draft|§6|
|Описание: Интерфейс PoolController. Включает treasury() для чтения адреса treasury из frontend и внешних интеграций. Все величины в 18 decimals, minUsdcOut_6 — 6-dec.
|Публичный API:
- function buyFromPool(uint256 X_6, uint256 minTokensOut, uint256 deadline) external returns (uint256)
- function sellToPool(uint256 deltaP, uint256 minUsdcOut_6, uint256 deadline) external returns (uint256)
- function poolPrice() external view returns (uint256)
- function effectiveMinimalX6() external view returns (uint256)
- function treasury() external view returns (address)              // НОВОЕ
- function setMaxSellPctPerDay(uint256) external
- function pause() external
- function unpause() external
|↙ ПОТРЕБЛЯЕТ:
- C.3.01.02 PoolController
|↘ ПРЕДОСТАВЛЯЕТ:
- Типизированный интерфейс для frontend и Factory
- effectiveMinimalX6() для frontend/UX
- treasury() для frontend и внешних интеграций                     // НОВОЕ
|Реализация: Interface-only.
|Примечания: ИСПРАВЛЕНО 13-я ИТЕРАЦИЯ (ревизия 4): добавлен treasury() в публичный API, в блок ↘ ПРЕДОСТАВЛЯЕТ, в описание. Версия поднята с v.0.0.01 до v.0.0.02. Ранее treasury() был добавлен в публичный API, но не отражён в блоке предоставления и примечаниях — несогласованность шапки.
ИЗМЕНЕНО 11-я ИТЕРАЦИЯ: добавлена effectiveMinimalX6() — прокси curveController.effectiveMinimalX6(). Frontend может узнавать минимальный X_6 как через IPoolController, так и через ICurveController.

|C.4.01.01|Contracts|Reserve|Solidity|contracts/reserve/ReserveManager.sol|C.0.01.01, C.2.01.01, C.2.01.04, C.2.01.10, C.2.01.11, C.9.01.02|v.0.0.01|Draft|§7|
|Описание: Менеджер резерва. usdc и levels — immutable. Все учётные величины (reserve, curveBacking, freeReserve) в 18 decimals. При переводе USDC наружу — конвертация в 6 decimals через PrecisionLib.
|Публичный API:
- constructor(address usdc_, address levels_)
- function updateScurve(uint256 newScurve) external onlyRole(CONTROLLER_ROLE)
- function pay(address to, uint256 amount_18) external onlyRole(CONTROLLER_ROLE)
- function reserve() external view returns (uint256)              // 18 decimals
- function curveBacking() external view returns (uint256)         // 18 decimals
- function freeReserve() external view returns (uint256)          // 18 decimals
- function S_curve() external view returns (uint256)
- function checkInvariant() external view returns (bool)
- function usdc() external view returns (address)
- function levels() external view returns (address)
|↙ ПОТРЕБЛЯЕТ:
- C.0.01.01 Roles (CONTROLLER_ROLE)
- C.2.01.01 CurveMath (R, P)
- C.2.01.04 Errors (InsufficientReserve, ReserveInvariantViolation, Unauthorized)
- C.2.01.10 ILevels (all) — внешние вызовы через интерфейс
- C.2.01.11 Types (struct Level)
- C.9.01.02 PrecisionLib (toUSDC, toWei)
- OpenZeppelin: IERC20, SafeERC20, AccessControl
|↘ ПРЕДОСТАВЛЯЕТ:
- reserve, curveBacking, freeReserve, S_curve — все в 18 decimals
- Физическое хранение USDC (6 decimals на балансе)
- Проверку инварианта reserve ≥ R(S_curve) с revert
|Реализация:
constructor(usdc_, levels_):
  usdc = usdc_; levels = levels_
// Возвращает баланс USDC, приведённый к 18 decimals (для внутренних сравнений с R(S))
reserve(): return PrecisionLib.toWei(IERC20(usdc).balanceOf(address(this)))
// R(S_curve_stored) — 18 decimals
curveBacking(): return CurveMath.R(S_curve_stored, ILevels(levels).all())
// 18 decimals
freeReserve(): return reserve() > curveBacking() ? reserve() − curveBacking() : 0
updateScurve(newS):
  (1) S_curve_stored = newS
  (2) require(reserve() >= curveBacking(), ReserveInvariantViolation)
     // reserve() в 18-dec, curveBacking() в 18-dec — сравнение корректно
pay(to, amount_18):
  (1) require(amount_18 <= reserve(), InsufficientReserve)
  (2) uint256 amount_6 = PrecisionLib.toUSDC(amount_18)
  (3) IERC20(usdc).safeTransfer(to, amount_6)
|Примечания: ИСПРАВЛЕНО 8-я ИТЕРАЦИЯ:
- УБРАНА избыточная зависимость C.2.01.09 Levels (реализация) — контракт не делает type-cast к Levels, только вызывает ILevels(levels).all() через интерфейс. Оставлена только C.2.01.10 ILevels. Это соответствует принципу «реализация только там, где делается new» (т.е. в C.8.01.01 Factory).
- Добавлена зависимость OpenZeppelin: SafeERC20 — используется safeTransfer в pay(). Устраняет риск непроверенных возвратов ERC20.
- Уточнено: reserve() возвращает 18-dec (через PrecisionLib.toWei) — синхронизировано с CurveMath.R (18-dec). Без этого инвариант reserve ≥ curveBacking сравнивал бы 6-dec с 18-dec.
- pay() принимает amount в 18-dec и конвертирует в 6-dec для safeTransfer.
- PrecisionLib в зависимостях (toUSDC, toWei).
- Добавлен levels в конструктор — без него curveBacking() не вычисляется.
- levels хранится как immutable — не может быть изменён после деплоя.
- AccessControl наследуется для onlyRole(CONTROLLER_ROLE) в updateScurve и pay.

|C.4.01.02|Contracts|Reserve|Interface|contracts/reserve/IReserveManager.sol|C.4.01.01|v.0.0.01|Draft|§7|
|Описание: Интерфейс ReserveManager. Все учётные величины в 18 decimals.
|Публичный API:
- function updateScurve(uint256 newScurve) external
- function pay(address to, uint256 amount_18) external
- function reserve() external view returns (uint256)
- function curveBacking() external view returns (uint256)
- function freeReserve() external view returns (uint256)
- function S_curve() external view returns (uint256)
- function checkInvariant() external view returns (bool)
- function usdc() external view returns (address)
- function levels() external view returns (address)
|↙ ПОТРЕБЛЯЕТ:
- C.4.01.01 ReserveManager
|↘ ПРЕДОСТАВЛЯЕТ:
- Типизированный интерфейс для Factory, CurveController, PoolController, CircuitBreaker
|Реализация: Interface-only.
|Примечания: AccessControl-методы НЕ включены — используются через IAccessControl(address). Все величины USDC в 18-dec. Добавлен levels() геттер.

|C.5.01.01|Contracts|Vesting|Solidity|contracts/vesting/Vesting.sol|C.0.01.01, C.1.01.02, C.2.01.04|v.0.0.02|Draft|§8|
|Описание: Вестинг командных токенов. Все параметры (beneficiary, token) — immutable. cliff = 365 дней, duration = 730 дней — module-level constants.
ВАЖНО: Vesting — ТОЛЬКО токенный канал дохода команды. teamTokens (0.5% от ΔS на покупках) минтится в Vesting. USDC-доход команды идёт отдельно — через sellTeamFee в treasury (см. C.3.01.01, C.3.01.02). Это два независимых канала:
  - teamTokens → Vesting (токены XRT, cliff 365 дней, duration 730 дней).
  - sellTeamFee → treasury (USDC, немедленно, immutable адрес).
Vesting НЕ получает USDC. Treasury НЕ получает токены.
|Публичный API:
- constructor(address safe, address token_)
- function addTokens(uint256 amount) external onlyRole(MINTER_ROLE)
- function release() external
- function vestedAmount() external view returns (uint256)
- function releasable() external view returns (uint256)
- function beneficiary() external view returns (address)
- function token() external view returns (address)
- function vestingCliff() external view returns (uint256)
- function vestingDuration() external view returns (uint256)
- function vestingStart() external view returns (uint256)
- function totalAdded() external view returns (uint256)
- function totalReleased() external view returns (uint256)
|↙ ПОТРЕБЛЯЕТ:
- C.0.01.01 Roles (MINTER_ROLE)
- C.1.01.02 IXartIAToken (transfer, balanceOf)
- C.2.01.04 Errors (Unauthorized, InvalidAmount, InsufficientVestingBalance)
- OpenZeppelin: AccessControl
- OpenZeppelin: SafeERC20 (safeTransfer, safeTransferFrom)
|↘ ПРЕДОСТАВЛЯЕТ:
- Учёт командных токенов (teamTokens)
- Линейную разблокировку после cliff
- Единственный токенный канал дохода команды
|Реализация:
// Module-level constants (не конструктор)
uint256 constant VESTING_CLIFF = 365 days;    // 31 536 000 секунд
uint256 constant VESTING_DURATION = 730 days; // 63 072 000 секунд
constructor(safe, token_):
  (1) beneficiary = safe
  (2) token = token_
addTokens(amount):
  (1) require(amount > 0, InvalidAmount)
  (2) если totalAdded == 0: vestingStart = block.timestamp
  (3) require(IXartIAToken(token).balanceOf(address(this)) >= totalAdded + amount − totalReleased, InsufficientVestingBalance)
  (4) totalAdded += amount
vestedAmount():
  если block.timestamp < vestingStart + VESTING_CLIFF: return 0
  иначе: linear от vestingStart + VESTING_CLIFF до vestingStart + VESTING_CLIFF + VESTING_DURATION
release():
  uint256 amount = releasable()
  require(amount > 0, InvalidAmount)
  totalReleased += amount
  IXartIAToken(token).safeTransfer(beneficiary, amount)
vestingCliff(): return VESTING_CLIFF
vestingDuration(): return VESTING_DURATION
|Примечания: ИСПРАВЛЕНО 13-я ИТЕРАЦИЯ (ревизия 3): добавлено явное разделение двух каналов дохода команды.
- teamTokens (0.5% от ΔS) → Vesting (токены XRT).
- sellTeamFee (0.1% от gross amount с продаж) → treasury (USDC, немедленно).
Это два независимых источника: Vesting не получает USDC, treasury не получает токены.
Обоснование: Vesting привязан к эмиссии (защита от размывания), treasury — к обороту (сглаживание просадки в медвежий рынок). См. R.1.01.01 подраздел «Доход команды».
ИЗМЕНЕНО 5-я ИТЕРАЦИЯ:
- VESTING_CLIFF и VESTING_DURATION — module-level constants. Не принимаются в конструкторе.
- release() кеширует releasable() в локальную переменную (gas-оптимизация и читаемость).
- Добавлен require(amount > 0, InvalidAmount) в release() — защита от no-op вызова.
ИСПРАВЛЕНО 7-я ИТЕРАЦИЯ: transfer/transferFrom заменены на safeTransfer/safeTransferFrom из OpenZeppelin SafeERC20. Устраняет риск непроверенных возвратов.

|C.5.01.02|Contracts|Vesting|Interface|contracts/vesting/IVesting.sol|C.5.01.01|v.0.0.01|Draft|§8|
|Описание: Интерфейс Vesting. Только доменные методы.
|Публичный API:
- function addTokens(uint256 amount) external
- function release() external
- function vestedAmount() external view returns (uint256)
- function releasable() external view returns (uint256)
- function beneficiary() external view returns (address)
|↙ ПОТРЕБЛЯЕТ:
- C.5.01.01 Vesting
|↘ ПРЕДОСТАВЛЯЕТ:
- Типизированный интерфейс
|Реализация: Interface-only.
|Примечания: AccessControl-методы НЕ включены.

|C.6.01.01|Contracts|Safety|Solidity|contracts/safety/CircuitBreaker.sol|C.0.01.01, C.2.01.03, C.2.01.04, C.4.01.02, C.10.01.01|v.0.0.01|Draft|§9|
|Описание: Circuit Breaker. threshold инициализируется Factory. active() читает reserve и freeReserve из ReserveManager через интерфейс IReserveManager (immutable). GOVERNANCE_ROLE выдаётся Timelock в Factory.deploy (шаг 34b). Сеттер setThreshold вызывается через Governance → Timelock → CircuitBreaker.
|Публичный API:
- constructor(uint256 initialThreshold, address reserveManager_)
- function active() external view returns (bool)
- function threshold() external view returns (uint256)
- function setThreshold(uint256) external onlyRole(GOVERNANCE_ROLE)
- function reserveManager() external view returns (address)
|↙ ПОТРЕБЛЯЕТ:
- C.0.01.01 Roles (GOVERNANCE_ROLE)
- C.2.01.03 Constants (BASIS_POINTS)
- C.2.01.04 Errors (OutOfBounds, Unauthorized)
- C.4.01.02 IReserveManager (reserve, freeReserve) — внешние вызовы через интерфейс
- C.10.01.01 Events (ThresholdUpdated)
- OpenZeppelin: AccessControl
|↘ ПРЕДОСТАВЛЯЕТ:
- Флаг active (view)
- Порог срабатывания
- setThreshold — точка входа для ParameterRegistry.register(PARAM_CIRCUIT_BREAKER_THRESHOLD)
|Реализация:
constructor(initialThreshold, reserveManager_):
  (1) require(initialThreshold >= 500 && initialThreshold <= 2000, OutOfBounds)
  (2) threshold = initialThreshold
  (3) reserveManager = reserveManager_
  (4) эмиссия ThresholdUpdated(0, initialThreshold)
active():
  (1) uint256 r = IReserveManager(reserveManager).reserve()          // 18-dec
  (2) если r == 0: return false
  (3) uint256 fr = IReserveManager(reserveManager).freeReserve()     // 18-dec
  (4) return fr * BASIS_POINTS / r < threshold
setThreshold(newThreshold):
  (1) require(newThreshold >= 500 && newThreshold <= 2000, OutOfBounds)
  (2) old = threshold
  (3) threshold = newThreshold
  (4) эмиссия ThresholdUpdated(old, newThreshold)
|Примечания: ИСПРАВЛЕНО (ранние итерации):
- Добавлен reserveManager в конструктор — без него active() не может читать reserve/freeReserve.

|C.6.01.02|Contracts|Safety|Interface|contracts/safety/ICircuitBreaker.sol|C.6.01.01|v.0.0.01|Draft|§9|
|Описание: Интерфейс CircuitBreaker.
|Публичный API:
- function active() external view returns (bool)
- function threshold() external view returns (uint256)
- function setThreshold(uint256) external
- function reserveManager() external view returns (address)
|↙ ПОТРЕБЛЯЕТ:
- C.6.01.01 CircuitBreaker
|↘ ПРЕДОСТАВЛЯЕТ:
- Типизированный интерфейс для PoolController и Factory
|Реализация: Interface-only.
|Примечания: AccessControl-методы НЕ включены. Добавлен reserveManager() геттер.

|C.7.01.01|Contracts|Governance|Solidity|contracts/governance/Governance.sol|C.0.01.01, C.0.01.02, C.2.01.04, C.7.01.02, C.10.01.01|v.0.0.01|Draft|§10|
|Описание: Управление параметрами через Safe Multisig (immutable) и Timelock. Использует ParameterRegistry. Не зависит от целевых контрактов.
|Публичный API:
- constructor(address safe_, address timelock_, address registry_)
- function propose(bytes32 param, uint256 value) external onlySafe
- function execute(bytes32 param) external onlySafe
- function cancel(bytes32 param) external onlySafe
- function getProposal(bytes32 param) external view returns (uint256 value, address target, bytes4 setter, uint256 executeAfter, bool exists)
- function safe() external view returns (address)
|↙ ПОТРЕБЛЯЕТ:
- C.0.01.02 ParameterRegistry (get, isValid)
- C.2.01.04 Errors (InvalidParam, OutOfBounds, Unauthorized)
- C.7.01.02 Timelock (queue, execute, cancel, get)
- C.10.01.01 Events (Queued, Executed, Cancelled — эмитит Timelock)
- OpenZeppelin: AccessControl
|↘ ПРЕДОСТАВЛЯЕТ:
- Изменение управляемых параметров с timelock
- Прокси-чтение состояния через Timelock.get()
|Реализация: safe — immutable. onlySafe: require(msg.sender == safe, Unauthorized). getProposal() проксирует Timelock.get() с тем же порядком полей.
|Примечания: ИСПРАВЛЕНО: GOVERNANCE_ROLE убран из зависимостей — Governance не использует его в функциях. Все вызовы — onlySafe. AccessControl наследуется только для хранения DEFAULT_ADMIN_ROLE на safe.

|C.7.01.02|Contracts|Governance|Solidity|contracts/governance/Timelock.sol|C.0.01.01, C.2.01.03, C.2.01.04|v.0.0.01|Draft|§10|
|Описание: Timelock с задержкой TIMELOCK_DELAY. Хранит executeAfter per param. Вызывается исключительно Governance. Проверяет, что target — контракт, при queue().
|Публичный API:
- constructor()
- function queue(bytes32 param, uint256 value, address target, bytes4 setter) external onlyRole(GOVERNANCE_ROLE)
- function execute(bytes32 param) external onlyRole(GOVERNANCE_ROLE)
- function cancel(bytes32 param) external onlyRole(GOVERNANCE_ROLE)
- function get(bytes32 param) external view returns (uint256 value, address target, bytes4 setter, uint256 executeAfter, bool exists)
- function delay() external pure returns (uint256)
|↙ ПОТРЕБЛЯЕТ:
- C.0.01.01 Roles (GOVERNANCE_ROLE)
- C.2.01.03 Constants (TIMELOCK_DELAY)
- C.2.01.04 Errors (InvalidParam, DeadlineExpired, NotQueued, AlreadyQueued, CallFailed)
- C.10.01.01 Events (Queued, Executed, Cancelled)
- OpenZeppelin: AccessControl
|↘ ПРЕДОСТАВЛЯЕТ:
- Задержку исполнения для Governance
|Реализация: Наследует AccessControl. queue/execute/cancel — onlyRole(GOVERNANCE_ROLE).
queue(param, value, target, setter):
  (0) require(target.code.length > 0, InvalidParam)   // НОВОЕ: target должен быть контрактом, не EOA
  (1) require(!entries[param].exists, AlreadyQueued)
  (2) entries[param] = Entry(value, target, setter, block.timestamp + TIMELOCK_DELAY, true)
  (3) эмиссия Queued
execute(param):
  (1) require(entries[param].exists, NotQueued)
  (2) require(block.timestamp >= entries[param].executeAfter, DeadlineExpired)
  (2a) require(entries[param].target.code.length > 0, InvalidParam)   // НОВОЕ: target должен оставаться контрактом
  (3) (bool success, ) = entries[param].target.call(abi.encodeWithSelector(entries[param].setter, entries[param].value))
  (4) require(success, CallFailed)
  (5) delete entries[param]
  (6) эмиссия Executed
cancel(param):
  (1) require(entries[param].exists, NotQueued)
  (2) delete entries[param]
  (3) эмиссия Cancelled
|Примечания: ИСПРАВЛЕНО 7-я ИТЕРАЦИЯ: добавлен require(target.code.length > 0, InvalidParam) в queue(). Блокирует регистрацию EOA как target — предотвращает бесполезные вызовы и потенциальный обход управления при компрометации safe.

|C.7.01.03|Contracts|Governance|Interface|contracts/governance/IGovernance.sol|C.7.01.01|v.0.0.01|Draft|§10|
|Описание: Интерфейс Governance.
|Публичный API:
- function propose(bytes32 param, uint256 value) external
- function execute(bytes32 param) external
- function cancel(bytes32 param) external
- function getProposal(bytes32 param) external view returns (uint256 value, address target, bytes4 setter, uint256 executeAfter, bool exists)
- function safe() external view returns (address)
|↙ ПОТРЕБЛЯЕТ:
- C.7.01.01 Governance
|↘ ПРЕДОСТАВЛЯЕТ:
- Типизированный интерфейс для frontend
|Реализация: Interface-only.
|Примечания: AccessControl-методы НЕ включены.

|C.7.01.04|Contracts|Governance|Interface|contracts/governance/ITimelock.sol|C.7.01.02|v.0.0.01|Draft|§10|
|Описание: Интерфейс Timelock.
|Публичный API:
- function queue(bytes32 param, uint256 value, address target, bytes4 setter) external
- function execute(bytes32 param) external
- function cancel(bytes32 param) external
- function get(bytes32 param) external view returns (uint256 value, address target, bytes4 setter, uint256 executeAfter, bool exists)
- function delay() external pure returns (uint256)
|↙ ПОТРЕБЛЯЕТ:
- C.7.01.02 Timelock
|↘ ПРЕДОСТАВЛЯЕТ:
- Типизированный интерфейс для Governance и Factory
|Реализация: Interface-only.
|Примечания: НОВОЕ: устраняет отсутствие ITimelock, который использовался в C.8.01.01.

|C.8.01.01|Contracts|Factory|Solidity|contracts/factory/XartIAFactory.sol|C.0.01.01, C.0.01.02, C.0.01.03, C.0.01.04, C.1.01.01, C.2.01.01, C.2.01.03, C.2.01.04, C.2.01.09, C.2.01.10, C.2.01.11, C.2.01.12, C.2.01.13, C.2.01.14, C.3.01.01, C.3.01.02, C.3.01.03, C.3.01.04, C.4.01.01, C.4.01.02, C.5.01.01, C.5.01.02, C.6.01.01, C.6.01.02, C.7.01.01, C.7.01.02, C.7.01.03, C.7.01.04, C.10.01.01|v.0.0.04|Draft|§11|
|Описание: Фабрика деплоя. Все созданные контракты хранятся в state variables. deploy проверяет safe, treasury, usdc, initialThreshold. deploy вызывает setPoolController для CurveController. initializePoolPrice проверяет коридор, наличие Levels, P(S_0) > 0, S_curve() == 0. finalize проверяет DEFAULT_ADMIN_ROLE и PAUSER_ROLE у safe, передаёт ownership и отзывает все роли у Factory.
ИСПРАВЛЕНО 12-я ИТЕРАЦИЯ:
- КРИТИЧНО: шаг (14a) в finalize: IOwnable(curveController).transferOwnership(safe).
НОВОЕ 13-я ИТЕРАЦИЯ:
- НОВОЕ: deploy принимает treasury. Валидация: treasury != address(0), treasury != address(this), treasury.code.length > 0.
- НОВОЕ: treasury передаётся в CurveController и PoolController конструкторы.
- НОВОЕ: registerParams регистрирует PARAM_SELL_TEAM_FEE (bounds 0–50 bp).
- НОВОЕ: в deploy шаг (45a) setSellTeamFee(10) — default 0.1%.
|Публичный API:
- function deploy(address safe, address treasury, uint256 initialThreshold, address usdc) external returns (address curveController_, address poolController_, address curveMathWrapper_)   // ИЗМЕНЕНО: +treasury
- function initializeLevels(Level[] memory levels) external onlyOwner
- function initializePoolPrice(uint256 initialPoolPrice_18) external onlyOwner
- function registerParams() external onlyOwner
- function finalize(address safe) external onlyOwner
- function token() external view returns (address)
- function levels() external view returns (address)
- function registry() external view returns (address)
- function poolState() external view returns (address)
- function reserveManager() external view returns (address)
- function vesting() external view returns (address)
- function circuitBreaker() external view returns (address)
- function curveController() external view returns (address)
- function poolController() external view returns (address)
- function governance() external view returns (address)
- function timelock() external view returns (address)
- function curveMathWrapper() external view returns (address)
- function treasury() external view returns (address)                              // НОВОЕ: сохранён для reference
|↙ ПОТРЕБЛЯЕТ:
- C.0.01.01 Roles (MINTER_ROLE, BURNER_ROLE, CONTROLLER_ROLE, POOL_WRITER_ROLE, PRICE_WRITER_ROLE, GOVERNANCE_ROLE, PAUSER_ROLE, DEFAULT_ADMIN_ROLE)
- C.0.01.02 ParameterRegistry
- C.0.01.03 IOwnable
- C.0.01.04 IParameterRegistry
- C.1.01.01 XartIAToken
- C.2.01.01 CurveMath
- C.2.01.03 Constants (PARAM_*, BASIS_POINTS, MAX_GAP)
- C.2.01.04 Errors (NotOwner, SafeNotAdmin, SafeNotPauser, InvalidAmount, InvalidAddress, InvalidParam, OutOfBounds)
- C.2.01.09 Levels (реализация)
- C.2.01.10 ILevels
- C.2.01.11 Types
- C.2.01.12 PoolState
- C.2.01.13 CurveMathWrapper
- C.2.01.14 IPoolState
- C.3.01.01 CurveController
- C.3.01.02 PoolController
- C.3.01.03 ICurveController
- C.3.01.04 IPoolController
- C.4.01.01 ReserveManager
- C.4.01.02 IReserveManager
- C.5.01.01 Vesting
- C.5.01.02 IVesting
- C.6.01.01 CircuitBreaker
- C.6.01.02 ICircuitBreaker
- C.7.01.01 Governance
- C.7.01.02 Timelock
- C.7.01.03 IGovernance
- C.7.01.04 ITimelock
- C.10.01.01 Events
- OpenZeppelin: Ownable, IAccessControl
|↘ ПРЕДОСТАВЛЯЕТ:
- Все созданные контракты в state variables с автоматическими геттерами
- treasury сохранён в state variable (для reference и frontend)                    // НОВОЕ
- setPoolController вызван для CurveController
- S_curve() == 0 гарантирован при initializePoolPrice
- Ownership Levels, ParameterRegistry, PoolState, CurveController, XartIAFactory → safe (в finalize)
- Все роли Factory отозваны в finalize
|Реализация:
// State variables
address public token;
address public levels;
address public registry;
address public poolState;
address public reserveManager;
address public vesting;
address public circuitBreaker;
address public curveController;
address public poolController;
address public governance;
address public timelock;
address public curveMathWrapper;
address public treasury;                                                       // НОВОЕ
deploy(safe, treasury, initialThreshold, usdc):
  (0)  require(safe != address(0), InvalidAddress)
  (0a) require(safe != address(this), InvalidAddress)
  (0b) require(safe.code.length > 0, InvalidAddress)
  (0c) require(usdc != address(0), InvalidAddress)
  (0d) require(initialThreshold >= 500 && initialThreshold <= 2000, OutOfBounds)
  (0e) require(treasury != address(0), InvalidAddress)                 // НОВОЕ
  (0f) require(treasury != address(this), InvalidAddress)              // НОВОЕ
  (0g) require(treasury.code.length > 0, InvalidAddress)               // НОВОЕ
  (1)  token = address(new XartIAToken())
  (2)  levels = address(new Levels())
  (3)  registry = address(new ParameterRegistry())
  (4)  poolState = address(new PoolState())
  (5)  reserveManager = address(new ReserveManager(usdc, levels))
  (6)  vesting = address(new Vesting(safe, token))
  (7)  circuitBreaker = address(new CircuitBreaker(initialThreshold, reserveManager))
  (8)  curveMathWrapper = address(new CurveMathWrapper())
  (9)  curveController = address(new CurveController(reserveManager, vesting, circuitBreaker, poolState, token, levels, usdc, treasury))   // +treasury
  (10) poolController = address(new PoolController(curveController, reserveManager, circuitBreaker, poolState, token, levels, usdc, treasury))   // +treasury
  (10a) ICurveController(curveController).setPoolController(poolController)
  (11) timelock = address(new Timelock())
  (12) governance = address(new Governance(safe, timelock, registry))
  // ... роли как раньше
  (13) IAccessControl(token).grantRole(MINTER_ROLE, curveController)
  (14) IAccessControl(token).grantRole(BURNER_ROLE, curveController)
  (15) IAccessControl(token).grantRole(DEFAULT_ADMIN_ROLE, safe)
  (16) IAccessControl(reserveManager).grantRole(CONTROLLER_ROLE, curveController)
  (17) IAccessControl(reserveManager).grantRole(CONTROLLER_ROLE, poolController)
  (18) IAccessControl(reserveManager).grantRole(DEFAULT_ADMIN_ROLE, safe)
  (19) IAccessControl(poolState).grantRole(POOL_WRITER_ROLE, poolController)
  (20) IAccessControl(poolState).grantRole(PRICE_WRITER_ROLE, curveController)
  (21) IAccessControl(poolState).grantRole(PRICE_WRITER_ROLE, poolController)
  (22) IAccessControl(poolState).grantRole(DEFAULT_ADMIN_ROLE, safe)
  (23b) IAccessControl(curveController).grantRole(GOVERNANCE_ROLE, timelock)
  (24)  IAccessControl(curveController).grantRole(GOVERNANCE_ROLE, address(this))
  (25)  IAccessControl(curveController).grantRole(PAUSER_ROLE, safe)
  (27)  IAccessControl(curveController).grantRole(DEFAULT_ADMIN_ROLE, safe)
  (28b) IAccessControl(poolController).grantRole(GOVERNANCE_ROLE, timelock)
  (29)  IAccessControl(poolController).grantRole(GOVERNANCE_ROLE, address(this))
  (30)  IAccessControl(poolController).grantRole(PAUSER_ROLE, safe)
  (31)  IAccessControl(poolController).grantRole(DEFAULT_ADMIN_ROLE, safe)
  (32) IAccessControl(vesting).grantRole(MINTER_ROLE, curveController)
  (33) IAccessControl(vesting).grantRole(DEFAULT_ADMIN_ROLE, safe)
  (34b) IAccessControl(circuitBreaker).grantRole(GOVERNANCE_ROLE, timelock)
  (36)  IAccessControl(circuitBreaker).grantRole(DEFAULT_ADMIN_ROLE, safe)
  (37) IAccessControl(timelock).grantRole(GOVERNANCE_ROLE, governance)
  (38) IAccessControl(timelock).grantRole(DEFAULT_ADMIN_ROLE, safe)
  (39) IAccessControl(governance).grantRole(DEFAULT_ADMIN_ROLE, safe)
  // Установка начальных параметров
  (40) ICurveController(curveController).setBuyFee(50)
  (41) ICurveController(curveController).setRedeemFee(50)
  (42) ICurveController(curveController).setEarlySellFee(0)
  (43) ICurveController(curveController).setEarlySellPeriod(0)
  (44) ICurveController(curveController).setMaxPurchasePct(500)
  (45) ICurveController(curveController).setMinimalPurchase(1e6)
  (45a) ICurveController(curveController).setSellTeamFee(10)                     // НОВОЕ: default 0.1%
  (46) IPoolController(poolController).setMaxSellPctPerDay(200)
  (47) эмиссия Deploy(address(this), token, curveController, poolController, safe, treasury, curveMathWrapper)   // ИЗМЕНЕНО: +treasury
  return (curveController, poolController, curveMathWrapper)
initializeLevels(_levels):
  (1) require(IOwnable(levels).owner() == address(this), NotOwner)
  (2) ILevels(levels).init(_levels)
  (3) эмиссия Initialize(address(this), _levels.length)
initializePoolPrice(initialPoolPrice_18):
  (1) require(IOwnable(poolState).owner() == address(this), NotOwner)
  (2) require(initialPoolPrice_18 > 0, InvalidAmount)
  (3) require(ILevels(levels).length() > 0, InvalidParam)
  (3a) require(IReserveManager(reserveManager).S_curve() == 0, InvalidParam)
  (4) uint256 P_S0 = CurveMath.P(0, ILevels(levels).all())
  (5) require(P_S0 > 0, InvalidParam)
  (6) uint256 lower = P_S0 * BASIS_POINTS / (BASIS_POINTS + MAX_GAP)
  (7) uint256 upper = P_S0 * (BASIS_POINTS + MAX_GAP) / BASIS_POINTS
  (8) require(initialPoolPrice_18 >= lower, OutOfBounds)
  (9) require(initialPoolPrice_18 <= upper, OutOfBounds)
  (10) IPoolState(poolState).initializePoolPrice(initialPoolPrice_18)
registerParams():
  (1) require(IOwnable(registry).owner() == address(this), NotOwner)
  (2) register(PARAM_BUY_FEE, curveController, ICurveController.setBuyFee.selector, 0, 200)
  (3) register(PARAM_REDEEM_FEE, curveController, ICurveController.setRedeemFee.selector, 0, 200)
  (4) register(PARAM_EARLY_SELL_FEE, curveController, ICurveController.setEarlySellFee.selector, 0, 500)
  (5) register(PARAM_EARLY_SELL_PERIOD, curveController, ICurveController.setEarlySellPeriod.selector, 0, 7776000)
  (6) register(PARAM_MAX_PURCHASE_PCT, curveController, ICurveController.setMaxPurchasePct.selector, 0, 1000)
  (7) register(PARAM_MINIMAL_PURCHASE, curveController, ICurveController.setMinimalPurchase.selector, 1e6, 1e12)
  (8) register(PARAM_MAX_SELL_PCT_PER_DAY, poolController, IPoolController.setMaxSellPctPerDay.selector, 0, 500)
  (9) register(PARAM_CIRCUIT_BREAKER_THRESHOLD, circuitBreaker, ICircuitBreaker.setThreshold.selector, 500, 2000)
  (10) register(PARAM_SELL_TEAM_FEE, curveController, ICurveController.setSellTeamFee.selector, 0, 50)   // НОВОЕ
finalize(safe):
  (0)  require(safe != address(0), InvalidAddress)
  (0a) require(safe != address(this), InvalidAddress)
  (0b) require(safe.code.length > 0, InvalidAddress)
  // проверки DEFAULT_ADMIN_ROLE
  (1)  require(IAccessControl(token).hasRole(DEFAULT_ADMIN_ROLE, safe), SafeNotAdmin)
  (2)  require(IAccessControl(curveController).hasRole(DEFAULT_ADMIN_ROLE, safe), SafeNotAdmin)
  (3)  require(IAccessControl(poolController).hasRole(DEFAULT_ADMIN_ROLE, safe), SafeNotAdmin)
  (4)  require(IAccessControl(reserveManager).hasRole(DEFAULT_ADMIN_ROLE, safe), SafeNotAdmin)
  (5)  require(IAccessControl(vesting).hasRole(DEFAULT_ADMIN_ROLE, safe), SafeNotAdmin)
  (6)  require(IAccessControl(circuitBreaker).hasRole(DEFAULT_ADMIN_ROLE, safe), SafeNotAdmin)
  (7)  require(IAccessControl(governance).hasRole(DEFAULT_ADMIN_ROLE, safe), SafeNotAdmin)
  (8)  require(IAccessControl(timelock).hasRole(DEFAULT_ADMIN_ROLE, safe), SafeNotAdmin)
  (9)  require(IAccessControl(poolState).hasRole(DEFAULT_ADMIN_ROLE, safe), SafeNotAdmin)
  // проверки PAUSER_ROLE
  (10) require(IAccessControl(curveController).hasRole(PAUSER_ROLE, safe), SafeNotPauser)
  (11) require(IAccessControl(poolController).hasRole(PAUSER_ROLE, safe), SafeNotPauser)
  // передача ownership
  (12) IOwnable(levels).transferOwnership(safe)
  (13) IOwnable(registry).transferOwnership(safe)
  (14) IOwnable(poolState).transferOwnership(safe)
  (14a) IOwnable(curveController).transferOwnership(safe)
  (15) super.transferOwnership(safe)
  // отзыв временного GOVERNANCE_ROLE
  (16) IAccessControl(curveController).renounceRole(GOVERNANCE_ROLE, address(this))
  (17) IAccessControl(poolController).renounceRole(GOVERNANCE_ROLE, address(this))
  // отзыв DEFAULT_ADMIN_ROLE
  (18) IAccessControl(token).renounceRole(DEFAULT_ADMIN_ROLE, address(this))
  (19) IAccessControl(curveController).renounceRole(DEFAULT_ADMIN_ROLE, address(this))
  (20) IAccessControl(poolController).renounceRole(DEFAULT_ADMIN_ROLE, address(this))
  (21) IAccessControl(reserveManager).renounceRole(DEFAULT_ADMIN_ROLE, address(this))
  (22) IAccessControl(vesting).renounceRole(DEFAULT_ADMIN_ROLE, address(this))
  (23) IAccessControl(circuitBreaker).renounceRole(DEFAULT_ADMIN_ROLE, address(this))
  (24) IAccessControl(governance).renounceRole(DEFAULT_ADMIN_ROLE, address(this))
  (25) IAccessControl(timelock).renounceRole(DEFAULT_ADMIN_ROLE, address(this))
  (26) IAccessControl(poolState).renounceRole(DEFAULT_ADMIN_ROLE, address(this))
  (27) эмиссия Finalize(address(this), safe)
|Примечания: НОВОЕ 13-я ИТЕРАЦИЯ:
- deploy принимает treasury. Валидация: != address(0), != address(this), code.length > 0. Treasury сохраняется в state variable для reference и frontend.
- treasury передаётся в CurveController и PoolController. Оба используют его в redeemFromCurve / sellToPool для sellTeamFee.
- registerParams: PARAM_SELL_TEAM_FEE с bounds [0, 50].
- deploy устанавливает setSellTeamFee(10) — default 0.1%.
- Событие Deploy расширено treasury.
ИСПРАВЛЕНО 12-я ИТЕРАЦИЯ: finalize шаг (14a) — IOwnable(curveController).transferOwnership(safe).
ИСПРАВЛЕНО 11-я ИТЕРАЦИЯ: setPoolController в deploy (шаг 10a); initializePoolPrice требует S_curve() == 0.

|C.8.01.02|Contracts|Factory|Interface|contracts/factory/IXartIAFactory.sol|C.8.01.01|v.0.0.02|Draft|§11|
|Описание: Интерфейс XartIAFactory.
|Публичный API:
- function deploy(address safe, address treasury, uint256 initialThreshold, address usdc) external returns (address curveController, address poolController, address curveMathWrapper)   // ИЗМЕНЕНО: +treasury
- function initializeLevels(Level[] memory levels) external
- function initializePoolPrice(uint256 initialPoolPrice) external
- function registerParams() external
- function finalize(address safe) external
- function token() external view returns (address)
- function levels() external view returns (address)
- function registry() external view returns (address)
- function poolState() external view returns (address)
- function reserveManager() external view returns (address)
- function vesting() external view returns (address)
- function circuitBreaker() external view returns (address)
- function curveController() external view returns (address)
- function poolController() external view returns (address)
- function governance() external view returns (address)
- function timelock() external view returns (address)
- function curveMathWrapper() external view returns (address)
- function treasury() external view returns (address)                              // НОВОЕ
|↙ ПОТРЕБЛЯЕТ:
- C.8.01.01 XartIAFactory
- C.2.01.11 Types (struct Level)
|↘ ПРЕДОСТАВЛЯЕТ:
- Типизированный интерфейс
|Реализация: Interface-only.
|Примечания: ИСПРАВЛЕНО 13-я ИТЕРАЦИЯ: deploy принимает treasury, добавлен геттер treasury().

|C.9.01.01|Contracts|Libraries|Solidity|contracts/libraries/MathLib.sol|—|v.0.0.01|Draft|§4.5|
|Описание: Библиотека математических утилит. mulDiv с округлением вверх/вниз, sqrt, min, max, abs.
|Публичный API:
- function mulDiv(uint256 a, uint256 b, uint256 c) internal pure returns (uint256)
- function mulDivUp(uint256 a, uint256 b, uint256 c) internal pure returns (uint256)
- function sqrt(uint256 x) internal pure returns (uint256)
- function min(uint256 a, uint256 b) internal pure returns (uint256)
- function max(uint256 a, uint256 b) internal pure returns (uint256)
- function abs(int256 x) internal pure returns (uint256)
|↙ ПОТРЕБЛЯЕТ: — (нет зависимостей)
|↘ ПРЕДОСТАВЛЯЕТ:
- Утилиты для CurveMath и контроллеров
|Реализация: mulDiv использует 512-битную арифметику (OpenZeppelin). sqrt — Babylonian.
|Примечания: Все функции internal pure, компилируются в inline. Аудит обязателен.

|C.9.01.02|Contracts|Libraries|Solidity|contracts/libraries/PrecisionLib.sol|—|v.0.0.01|Draft|§4.5|
|Описание: Библиотека конвертации точности между 18 decimals (XartIA) и 6 decimals (USDC).
|Публичный API:
- function toUSDC(uint256 amount18) internal pure returns (uint256)
- function fromUSDC(uint256 amount6) internal pure returns (uint256)
- function toWei(uint256 amount6) internal pure returns (uint256)
- function fromWei(uint256 amount18) internal pure returns (uint256)
|↙ ПОТРЕБЛЯЕТ: — (нет зависимостей)
|↘ ПРЕДОСТАВЛЯЕТ:
- Конвертацию точности для контроллеров
|Реализация: toUSDC делит на 1e12, fromUSDC умножает на 1e12. Защита от потери точности.
|Примечания: Используется при смешанных расчётах USDC и XartIA.

|C.9.01.03|Contracts|Libraries|Interface|contracts/libraries/IMathLib.sol|C.9.01.01|v.0.0.01|Draft|§4.5|
|Описание: Интерфейс MathLib.
|Публичный API:
- function mulDiv(uint256 a, uint256 b, uint256 c) external pure returns (uint256)
- function sqrt(uint256 x) external pure returns (uint256)
|↙ ПОТРЕБЛЯЕТ:
- C.9.01.01 MathLib
|↘ ПРЕДОСТАВЛЯЕТ:
- Типизированный интерфейс для моков
|Реализация: Interface-only.
|Примечания: Используется в T.1.01.14.

|C.9.01.04|Contracts|Libraries|Interface|contracts/libraries/IPrecisionLib.sol|C.9.01.02|v.0.0.01|Draft|§4.5|
|Описание: Интерфейс PrecisionLib.
|Публичный API:
- function toUSDC(uint256 amount18) external pure returns (uint256)
- function fromUSDC(uint256 amount6) external pure returns (uint256)
|↙ ПОТРЕБЛЯЕТ:
- C.9.01.02 PrecisionLib
|↘ ПРЕДОСТАВЛЯЕТ:
- Типизированный интерфейс
|Реализация: Interface-only.
|Примечания: Используется в T.1.01.15.

|C.10.01.01|Contracts|Events|Solidity|contracts/events/Events.sol|—|v.0.0.02|Draft|§12.2|
|Описание: Централизованные события. Paused/Unpaused из OpenZeppelin Pausable.
|Публичный API:
- event Buy(address indexed buyer, uint256 usdcIn, uint256 tokensOut, uint256 fee, uint256 teamTokens, uint256 newScurve, uint256 newReserve, uint256 newLevel)
- event BuyFromPool(address indexed buyer, uint256 usdcIn, uint256 tokensFromPool, uint256 tokensFromCurve, uint256 fee, uint256 newPool, uint256 newPoolPrice, uint256 newScurve, uint256 newReserve)
- event SellToPool(address indexed seller, uint256 tokensIn, uint256 usdcOut, uint256 fee, uint256 sellTeamFee, uint256 newPool, uint256 newPoolPrice, uint256 newReserve)   // ИЗМЕНЕНО: +sellTeamFee
- event Redeem(address indexed seller, uint256 tokensIn, uint256 usdcOut, uint256 fee, uint256 earlyFee, uint256 sellTeamFee, uint256 newScurve, uint256 newReserve, uint256 newLevel)   // ИЗМЕНЕНО: +sellTeamFee
- event PoolPriceUpdated(uint256 oldPrice, uint256 newPrice)
- event PoolPriceInitialized(uint256 initialPrice)
- event LevelChanged(uint256 oldLevel, uint256 newLevel)
- event TeamFee(address indexed vesting, uint256 amount)
- event CircuitBreakerTriggered(uint256 freeReserve, uint256 reserve)
- event ThresholdUpdated(uint256 oldThreshold, uint256 newThreshold)
- event BuyFeeUpdated(uint256 oldFee, uint256 newFee)
- event RedeemFeeUpdated(uint256 oldFee, uint256 newFee)
- event EarlySellFeeUpdated(uint256 oldFee, uint256 newFee)
- event EarlySellPeriodUpdated(uint256 oldPeriod, uint256 newPeriod)
- event MaxPurchasePctUpdated(uint256 oldPct, uint256 newPct)
- event MinimalPurchaseUpdated(uint256 oldMin, uint256 newMin)
- event MaxSellPctPerDayUpdated(uint256 oldPct, uint256 newPct)
- event SellTeamFeeUpdated(uint256 oldFee, uint256 newFee)                        // НОВОЕ
- event Queued(bytes32 indexed param, uint256 value, uint256 executeAfter)
- event Executed(bytes32 indexed param, uint256 value)
- event Cancelled(bytes32 indexed param)
- event Deploy(address indexed factory, address token, address curveController, address poolController, address safe, address treasury, address curveMathWrapper)   // ИЗМЕНЕНО: +treasury
- event Initialize(address indexed factory, uint256 levelCount)
- event Finalize(address indexed factory, address indexed safe)
|↙ ПОТРЕБЛЯЕТ: — (нет зависимостей)
|↘ ПРЕДОСТАВЛЯЕТ:
- Единый источник событий
|Реализация: Abstract contract.
|Примечания: ИЗМЕНЕНО 13-я ИТЕРАЦИЯ:
- SellToPool и Redeem расширены полем sellTeamFee — часть от amount_gross, переводимая в treasury.
- Добавлено SellTeamFeeUpdated для сеттера CurveController.setSellTeamFee.
- Deploy расширен treasury.
- Семантика полей: usdcOut — что получил пользователь (net); fee — redeemFee (остаётся в reserve); sellTeamFee — уходит в treasury.
ДОБАВЛЕНО 11-я ИТЕРАЦИЯ: BuyFeeUpdated, RedeemFeeUpdated, EarlySellFeeUpdated, EarlySellPeriodUpdated, MaxPurchasePctUpdated, MinimalPurchaseUpdated, MaxSellPctPerDayUpdated, Finalize.

|D.1.01.01|Deployment|Scripts|Solidity|script/Deploy.s.sol|C.8.01.01|v.0.0.02|Draft|§14|
|Описание: Главный скрипт деплоя. Читает safe, treasury, initial_threshold, usdc из config. Вызывает factory.deploy(). Начальные параметры задаются hardcoded в Factory.
|Публичный API:
- function run() external returns (address curveController, address poolController, address curveMathWrapper)
|↙ ПОТРЕБЛЯЕТ:
- C.8.01.01 XartIAFactory
- D.2.01.01 config/polygon.toml
- D.2.01.02 config/amoy.toml
|↘ ПРЕДОСТАВЛЯЕТ:
- JSON-артефакт deployments/<network>.json
|Реализация: читает safe, treasury, initial_threshold, usdc из config, вызывает factory.deploy(safe, treasury, threshold, usdc). Записывает адреса в deployments/<network>.json, включая treasury.
|Примечания: ИСПРАВЛЕНО 13-я ИТЕРАЦИЯ: скрипт читает treasury из config и передаёт в factory.deploy. Если treasury не задан — default = safe.

|D.1.01.02|Deployment|Scripts|Solidity|script/Initialize.s.sol|D.1.01.01|v.0.0.01|Draft|§14|
|Описание: Скрипт инициализации. Вызывает initializeLevels, initializePoolPrice, registerParams. p0 из config (6-dec) конвертируется в 18-dec.
|Публичный API:
- function run(address factory) external
|↙ ПОТРЕБЛЯЕТ:
- D.1.01.01 Deploy.s.sol
- C.8.01.01 XartIAFactory
|↘ ПРЕДОСТАВЛЯЕТ:
- Инициализированные Levels, PoolState, ParameterRegistry
|Реализация: run:
  (1) factory.initializeLevels(levels_from_config)
  (2) uint256 P0_6 = P0_from_config                                  // например, 2000 (6-dec)
  (3) uint256 P0_18 = P0_6 * 1e12                                    // 2e15 (18-dec)
  (4) factory.initializePoolPrice(P0_18)                             // > 0, 18-dec
  (5) factory.registerParams()
|Примечания: ИСПРАВЛЕНО: p0 из config (6-dec) конвертируется в 18-dec перед initializePoolPrice. Factory.initializePoolPrice принимает 18-dec.

|D.1.01.04|Deployment|Scripts|Solidity|script/Verify.s.sol|D.1.01.01|v.0.0.01|Draft|§14|
|Описание: Скрипт верификации контрактов на Polygonscan. Публикует исходники и ABI.
|Публичный API:
- function run(address[] memory contracts) external
|↙ ПОТРЕБЛЯЕТ:
- D.1.01.01 Deploy.s.sol
|↘ ПРЕДОСТАВЛЯЕТ:
- Верифицированные контракты на Polygonscan
|Реализация: Вызывает forge verify-contract для каждого адреса.
|Примечания: Требует POLYGONSCAN_API_KEY.

|D.1.01.05|Deployment|Scripts|Solidity|script/DeployToken.s.sol|C.1.01.01|v.0.0.01|Draft|§14|
|Описание: Изолированный скрипт деплоя только XartIAToken.
|Публичный API:
- function run() external returns (address)
|↙ ПОТРЕБЛЯЕТ:
- C.1.01.01 XartIAToken
|↘ ПРЕДОСТАВЛЯЕТ:
- Развёрнутый XartIAToken
|Реализация: Отдельный скрипт для тестов и раздельного деплоя.
|Примечания: Используется в unit-тестах.

|D.1.01.06|Deployment|Scripts|Solidity|script/DeployMath.s.sol|C.2.01.01|v.0.0.01|Deprecated|§14|
|Описание: DEPRECATED. CurveMath и LevelMath — internal pure-библиотеки, инлайнятся в байткод вызывающих контрактов. Отдельный деплой не требуется.
|Публичный API:
- forge script script/<файл>.s.sol — развёртывание/инициализация (устаревший скрипт).
|↙ ПОТРЕБЛЯЕТ:
- C.2.01.01
|↘ ПРЕДОСТАВЛЯЕТ:
- развёрнутые контракты для инициализации
|Реализация: Solidity-файл; проверяется forge build и forge test.
|Примечания: УДАЛЕНО из активного использования. Оставлено для истории.

|D.1.01.07|Deployment|Scripts|Solidity|script/Finalize.s.sol|D.1.01.02|v.0.0.01|Draft|§14|
|Описание: Финальный скрипт деплоя. Проверяет safe != address(0) и safe != address(this), передаёт ownership и отзывает ВСЕ роли у деплойера.
|Публичный API:
- function run(address factory, address safe) external
|↙ ПОТРЕБЛЯЕТ:
- D.1.01.02 Initialize.s.sol
- C.8.01.01 XartIAFactory
|↘ ПРЕДОСТАВЛЯЕТ:
- Передачу всех прав на Safe
- Отзыв DEFAULT_ADMIN_ROLE во всех 9 AccessControl-контрактах у деплойера
- Отзыв временного GOVERNANCE_ROLE у деплойера
|Реализация: factory.finalize(safe).
|Примечания: ИСПРАВЛЕНО: скрипт предварительно проверяет safe != address(0) и safe != address(this). Factory.finalize также проверяет эти условия, но явная проверка на уровне скрипта даёт понятную ошибку до отправки транзакции. finalize() отзывает DEFAULT_ADMIN_ROLE (автоматически выданный OpenZeppelin AccessControl при деплое) во всех 9 AccessControl-контрактах, а также временный GOVERNANCE_ROLE у CurveController и PoolController.

|D.2.01.01|Deployment|Configs|TOML|config/polygon.toml|—|v.0.0.02|Draft|§14.2|
|Описание: Конфигурация Polygon PoS Mainnet.
Поля:
- rpc_url, chain_id = 137
- usdc = 0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174
- safe = <Safe Multisig 3/5>
- treasury = <адрес treasury; default = safe>                  // НОВОЕ
- initial_threshold = 1000                                     // bp, передаётся в deploy()
- p0_initial_pool_price_6dec = 2000                            // USDC 6 decimals (= 0.002 USDC)
|Публичный API:
- Файл конфигурации: ключи и значения, читаются скриптами деплоя и инициализации.
|↙ ПОТРЕБЛЯЕТ:
- — (нет зависимостей)
|↘ ПРЕДОСТАВЛЯЕТ:
- параметры сети и адреса для D.1.01.*
|Реализация: TOML-конфигурация, читается скриптами деплоя.
|Примечания: НОВОЕ 13-я ИТЕРАЦИЯ: добавлено поле treasury. Если treasury == safe, можно указать тот же адрес или оставить пустым (Deploy.s.sol подставит safe). Treasury получает sellTeamFee (USDC) с продаж. Валидация: != address(0), != Factory, code.length > 0.

|D.2.01.02|Deployment|Configs|TOML|config/amoy.toml|—|v.0.0.02|Draft|§14.1|
|Описание: Конфигурация Polygon Amoy Testnet. Те же поля, что polygon.toml, включая treasury.
|Публичный API:
- Файл конфигурации: ключи и значения, читаются скриптами деплоя и инициализации.
|↙ ПОТРЕБЛЯЕТ:
- — (нет зависимостей)
|↘ ПРЕДОСТАВЛЯЕТ:
- параметры сети и адреса для D.1.01.*
|Реализация: TOML-конфигурация, читается скриптами деплоя.
|Примечания: НОВОЕ 13-я ИТЕРАЦИЯ: добавлено поле treasury.

|D.2.01.03|Deployment|Configs|ENV|config/.env.example|—|v.0.0.01|Draft|§14|
|Описание: Пример .env файла. PRIVATE_KEY, RPC_URL, POLYGONSCAN_API_KEY. Не коммитится.

|Публичный API:
- Файл конфигурации: ключи и значения, читаются скриптами деплоя и инициализации.
|↙ ПОТРЕБЛЯЕТ:
- — (нет зависимостей)
|↘ ПРЕДОСТАВЛЯЕТ:
- параметры сети и адреса для D.1.01.*
|Реализация: Файл переменных окружения (пример); реальные значения не коммитятся.

|D.2.01.04|Deployment|Configs|TOML|foundry.toml|—|v.0.0.01|Draft|§14|
|Описание: Конфигурация Foundry. Solidity 0.8.24, optimizer 200 runs, evm_version=paris, fuzz runs=10000, invariant runs=1000.

|Публичный API:
- Файл конфигурации: ключи и значения, читаются скриптами деплоя и инициализации.
|↙ ПОТРЕБЛЯЕТ:
- — (нет зависимостей)
|↘ ПРЕДОСТАВЛЯЕТ:
- параметры сети и адреса для D.1.01.*
|Реализация: TOML-конфигурация, читается скриптами деплоя.

|D.2.01.05|Deployment|Configs|TXT|remappings.txt|—|v.0.0.01|Draft|§14|
|Описание: Remappings для Foundry: OpenZeppelin, forge-std, solmate.

|Публичный API:
- Файл конфигурации: ключи и значения, читаются скриптами деплоя и инициализации.
|↙ ПОТРЕБЛЯЕТ:
- — (нет зависимостей)
|↘ ПРЕДОСТАВЛЯЕТ:
- параметры сети и адреса для D.1.01.*
|Реализация: Текстовый файл, читается инструментами сборки.

|D.2.01.06|Deployment|Configs|JSON|package.json|—|v.0.0.01|Draft|§14|
|Описание: package.json для npm-зависимостей и скриптов.

|Публичный API:
- Файл конфигурации: ключи и значения, читаются скриптами деплоя и инициализации.
|↙ ПОТРЕБЛЯЕТ:
- — (нет зависимостей)
|↘ ПРЕДОСТАВЛЯЕТ:
- параметры сети и адреса для D.1.01.*
|Реализация: JSON-файл, проверяется схемой и CI.

|D.2.01.07|Deployment|Configs|TXT|.gitignore|—|v.0.0.01|Draft|§14|
|Описание: .gitignore. Исключает node_modules, out, cache, .env, секреты, отчёты аудита.

|Публичный API:
- Файл конфигурации: ключи и значения, читаются скриптами деплоя и инициализации.
|↙ ПОТРЕБЛЯЕТ:
- — (нет зависимостей)
|↘ ПРЕДОСТАВЛЯЕТ:
- параметры сети и адреса для D.1.01.*
|Реализация: Текстовый файл, читается инструментами сборки.

|D.2.01.08|Deployment|Configs|JSON|.solhint.json|—|v.0.0.01|Draft|§14|
|Описание: Конфигурация Solhint для линтинга Solidity.

|Публичный API:
- Файл конфигурации: ключи и значения, читаются скриптами деплоя и инициализации.
|↙ ПОТРЕБЛЯЕТ:
- — (нет зависимостей)
|↘ ПРЕДОСТАВЛЯЕТ:
- параметры сети и адреса для D.1.01.*
|Реализация: JSON-файл, проверяется схемой и CI.

|D.2.01.09|Deployment|Configs|JSON|.prettierrc|—|v.0.0.01|Draft|§14|
|Описание: Конфигурация Prettier для Solidity. Отступы 4, ширина 100.

|Публичный API:
- Файл конфигурации: ключи и значения, читаются скриптами деплоя и инициализации.
|↙ ПОТРЕБЛЯЕТ:
- — (нет зависимостей)
|↘ ПРЕДОСТАВЛЯЕТ:
- параметры сети и адреса для D.1.01.*
|Реализация: JSON-файл, проверяется схемой и CI.

|D.2.01.10|Deployment|Configs|Makefile|Makefile|—|v.0.0.01|Draft|§14|
|Описание: Makefile с командами сборки, тестов, деплоя, верификации.
|Публичный API:
- make build
- make test
- make test-fuzz
- make test-invariant
- make test-gas
- make deploy-amoy
- make deploy-mainnet
- make verify
- make clean
|↙ ПОТРЕБЛЯЕТ:
- D.2.01.04 foundry.toml
- D.2.01.03 .env
- S.2.01.01 build.sh
- S.2.01.02 test.sh
- S.2.01.03 deploy.sh
- S.2.01.04 verify.sh
|↘ ПРЕДОСТАВЛЯЕТ:
- Унифицированный интерфейс для разработчиков
|Реализация: Каждая цель вызывает соответствующий shell-скрипт или forge команду.
|Примечания: `make deploy-mainnet` требует ручного подтверждения.

|D.2.01.11|Deployment|Configs|INI|.editorconfig|—|v.0.0.01|Draft|§14|
|Описание: Единый стиль кода для редакторов. Отступы, кодировка, переводы строк.

|Публичный API:
- Файл конфигурации: ключи и значения, читаются скриптами деплоя и инициализации.
|↙ ПОТРЕБЛЯЕТ:
- — (нет зависимостей)
|↘ ПРЕДОСТАВЛЯЕТ:
- параметры сети и адреса для D.1.01.*
|Реализация: INI-файл настроек редактора.

|D.2.01.12|Deployment|Configs|TXT|.nvmrc|—|v.0.0.01|Draft|§14|
|Описание: Фиксация версии Node.js для dApp и скриптов.

|Публичный API:
- Файл конфигурации: ключи и значения, читаются скриптами деплоя и инициализации.
|↙ ПОТРЕБЛЯЕТ:
- — (нет зависимостей)
|↘ ПРЕДОСТАВЛЯЕТ:
- параметры сети и адреса для D.1.01.*
|Реализация: Текстовый файл, читается инструментами сборки.

|D.2.01.13|Deployment|Configs|JSON|config/levels.json|—|v.0.0.01|Draft|§14|
|Описание: Каноническая таблица уровней для деплоя (3 уровня: 0..50k по 0.002, 50k..250k 0.002→0.004, 250k..1.25M 0.004→0.008). Именно её читает Initialize.s.sol. Точно бьёт в цели калибровки R=100/700/6700.
|Публичный API:
- JSON: {count, levels:[{S_start,S_end,P_start,P_end,maxBalance}]}; читается script/Initialize.s.sol.
|↙ ПОТРЕБЛЯЕТ: D.2.01.01 (сеть), E.3.01.02 (калибровка).
|↘ ПРЕДОСТАВЛЯЕТ: C.2.01.09 Levels (инициализация), T.1.01.*, T.3.*.
|Реализация: JSON; значения в 18 decimals.
|D.2.01.14|Deployment|Configs|JSON|config/calibration-targets.json|—|v.0.0.01|Draft|§14|
|Описание: Цели калибровки кривой: R(S) в трёх точках (50k→100, 250k→700, 1.25M→6700), диапазоны P0 и alpha, границы S_breaks. Используется e/03_calibration/tune_params.py.
|Публичный API:
- JSON: levels_count, targets[], P0_range, P0_steps, alpha_range, alpha_steps, S_breaks.
|↙ ПОТРЕБЛЯЕТ: — (внешние требования к экономике).
|↘ ПРЕДОСТАВЛЯЕТ: E.3.01.02 (params_output), D.2.01.13 (levels.json).
|Реализация: JSON; вход для калибровочного скрипта.
|D.3.01.01|Deployment|Docs|Markdown|README.md|—|v.0.0.01|Draft|§14|
|Описание: Корневой README. Описание проекта, архитектуры, инструкции по сборке, тестам, деплою.

|Публичный API:
- Документ; публичного API нет.
|↙ ПОТРЕБЛЯЕТ:
- — (нет зависимостей)
|↘ ПРЕДОСТАВЛЯЕТ:
- внешнее описание проекта
|Реализация: Markdown-документ.

|E.1.01.01|Economics|Core|Math spec|e/01_core/price_function.md|—|v.0.0.01|Draft|§3.1|
|Описание: Спецификация P_i(S) = a_i + b_i*(S − S_start). Формальное описание, границы, монотонность, непрерывность.

|Публичный API:
- Документ-спецификация: формулы, границы, доказательства.
|↙ ПОТРЕБЛЯЕТ:
- — (нет зависимостей)
|↘ ПРЕДОСТАВЛЯЕТ:
- основание для C.2.01.* и R.1.01.01
|Реализация: Math spec-файл.

|E.1.01.02|Economics|Core|Math spec|e/01_core/integral_function.md|E.1.01.01|v.0.0.01|Planned|§3.2|
|Описание: Спецификация R_i(S) = a_i*(S−S_start) + (b_i/2)*(S−S_start)^2. Аналитическое решение.

|Публичный API:
- Документ-спецификация: формулы, границы, доказательства.
|↙ ПОТРЕБЛЯЕТ:
- E.1.01.01
|↘ ПРЕДОСТАВЛЯЕТ:
- основание для C.2.01.* и R.1.01.01
|Реализация: Math spec-файл.

|E.1.01.03|Economics|Core|Table|e/01_core/levels_table.md|E.1.01.02|v.0.0.01|Planned|§3.3|
|Описание: Таблица уровней предложения. S_start, S_end, P_start, P_end, b_i, maxBalance. Иммутабельна.

|Публичный API:
- Документ-спецификация: формулы, границы, доказательства.
|↙ ПОТРЕБЛЯЕТ:
- E.1.01.02
|↘ ПРЕДОСТАВЛЯЕТ:
- основание для C.2.01.* и R.1.01.01
|Реализация: Table-файл.

|E.1.01.04|Economics|Core|Math spec|e/01_core/delta_s_solver.md|E.1.01.02|v.0.0.01|Planned|§5.5|
|Описание: Аналитическое решение R(S+ΔS) − R(S) = X относительно ΔS. Используется в buyFromCurve.

|Публичный API:
- Документ-спецификация: формулы, границы, доказательства.
|↙ ПОТРЕБЛЯЕТ:
- E.1.01.02
|↘ ПРЕДОСТАВЛЯЕТ:
- основание для C.2.01.* и R.1.01.01
|Реализация: Math spec-файл.

|E.1.01.05|Economics|Core|Math spec|e/01_core/pool_price_formula.md|E.1.01.02|v.0.0.02|Planned|§5.3|
|Описание: Формула обновления poolPrice. Симметричный коридор.
Формулы:
- Обновление при sellToPool:
  q = min(ΔP/S_curve, maxSoldPct)
  poolPrice_raw = poolPrice * (1 + k*q)
  ceiling = P(S) * (1 + maxGap)
  poolPrice_new = min(poolPrice_raw, ceiling)
- Обновление при buyFromCurve / buyFromCurveFor (новая нижняя граница):
  floor = P(newS) / (1 + maxGap)
  если poolPrice < floor: poolPrice = floor
- Обновление при redeemFromCurve (defensive):
  ceiling = P(newS) * (1 + maxGap)
  floor = P(newS) / (1 + maxGap)
  если poolPrice > ceiling: poolPrice = ceiling
  иначе если poolPrice < floor: poolPrice = floor
Диапазон:
- poolPrice всегда в [P(S)/(1+maxGap), P(S)*(1+maxGap)].
- Нижняя граница enforced в buyFromCurve и buyFromCurveFor при росте S_curve.
- Верхняя граница enforced в redeemFromCurve и sellToPool.
- redeemFromCurve применяет обе границы (defensive).
- Инициализация: initialPoolPrice ∈ [P(S_0)/(1+maxGap), P(S_0)*(1+maxGap)].
Следствие:
- Арбитраж между кривой и пулом ограничен MAX_GAP = 10% в обе стороны (buy pool → redeem curve; buy curve → sell pool).
- Чистый арбитраж ≤ 10% − buyFee − redeemFee.
|Публичный API:
- Документ-спецификация: формулы, границы, доказательства.
|↙ ПОТРЕБЛЯЕТ:
- E.1.01.02 integral_function.md (формула R)
|↘ ПРЕДОСТАВЛЯЕТ:
- Формулу для CurveController и PoolController
|Реализация: Markdown-документ.
|Примечания: ИСПРАВЛЕНО 12-я ИТЕРАЦИЯ: добавлена нижняя граница (floor). Ранее описывалась только верхняя (ceiling). Симметричный коридор — критичен для ограничения арбитража в обе стороны.

|E.1.01.06|Economics|Core|Proof|e/01_core/invariant_proof.md|E.1.01.02|v.0.0.02|Planned|§6|
|Описание: Доказательство reserve ≥ R(S_curve) для всех операций: buyFromCurve, redeemFromCurve, sellToPool, buyFromPool.
Утверждение: reserve ≥ R(S_curve) после любой операции.
Обозначения:
- R(S): интеграл P от 0 до S (curveBacking).
- reserve: фактический баланс USDC в ReserveManager (18-dec).
- freeReserve = reserve − R(S_curve) ≥ 0.
Раздел «Доказательство для buyFromCurve»:
- S_new = S + ΔS, где ΔS = deltaSForBuy(S, X_net_18).
- По определению deltaSForBuy: R(S_new) − R(S) = X_net_18.
- reserve_new = reserve_old + X_18, где X_18 = X_net_18 + fee_18.
- reserve_new − R(S_new) = (reserve_old + X_18) − (R(S) + X_net_18) = freeReserve_old + fee_18 ≥ 0.
- Инвариант держится. fee_18 (buyFee) остаётся в резерве.
Раздел «Доказательство для buyFromCurveFor»:
- Аналогично buyFromCurve, но X_18 нормализуется: X_18 = toWei(toUSDC(X_18)).
- reserve_new = reserve_old + toUSDC(X_18) * 1e12 = reserve_old + X_18 (после нормализации).
- Инвариант держится.
Раздел «Доказательство для redeemFromCurve (с sellTeamFee)» (ОБНОВЛЕНО 13-я ИТЕРАЦИЯ (ревизия 4)):
- deltaS сжигается, amount_18 = amountForRedeem(S, deltaS).
- По определению: R(S) − R(S_new) = amount_18.
- Комиссии: fee_18 = redeemFee, early_fee_18 = earlySellFee (если активен), sell_team_fee_18 = sellTeamFee.
- user_amount_18 = amount_18 − fee_18 − early_fee_18 − sell_team_fee_18.
- reserve_new = reserve_old − user_amount_18 − sell_team_fee_18
             = reserve_old − (amount_18 − fee_18 − early_fee_18 − sell_team_fee_18) − sell_team_fee_18
             = reserve_old − (amount_18 − fee_18 − early_fee_18).
- reserve_new − R(S_new) = (reserve_old − (amount_18 − fee_18 − early_fee_18)) − (R(S) − amount_18)
                        = freeReserve_old + fee_18 + early_fee_18 ≥ 0.
- Инвариант держится. sellTeamFee НЕ влияет на инвариант: он вычитается из user_amount и переводится в treasury, но reserve_new симметрично уменьшается на sell_team_fee_18 и user_amount_18. Итоговое уменьшение reserve = amount_18 − fee_18 − early_fee_18, что НЕ зависит от sellTeamFee.
- freeReserve растёт на fee_18 + early_fee_18 (redeemFee и earlySellFee остаются в reserve).
- sellTeamFee уходит в treasury, не влияя на freeReserve.
Раздел «Доказательство для sellToPool (с sellTeamFee)» (ОБНОВЛЕНО 13-я ИТЕРАЦИЯ (ревизия 4)):
- deltaP продаётся в пул. amount_gross_18 = deltaP * poolPrice / PRECISION.
- Комиссии: fee_18 = redeemFee, sell_team_fee_18 = sellTeamFee.
- amount_user_18 = amount_gross_18 − fee_18 − sell_team_fee_18.
- reserve_new = reserve_old − amount_user_18 − sell_team_fee_18
             = reserve_old − (amount_gross_18 − fee_18 − sell_team_fee_18) − sell_team_fee_18
             = reserve_old − (amount_gross_18 − fee_18).
- R(S) не меняется (S_curve не меняется).
- reserve_new − R(S) = (reserve_old − (amount_gross_18 − fee_18)) − R(S)
                    = freeReserve_old − (amount_gross_18 − fee_18).
- sellToPool ревертит с InsufficientFreeReserve, если amount_user_18 + sell_team_fee_18 > freeReserve. Это эквивалентно amount_gross_18 − fee_18 > freeReserve.
- Инвариант держится. sellTeamFee НЕ влияет на инвариант: уменьшение reserve = amount_gross_18 − fee_18, что НЕ зависит от sellTeamFee.
- freeReserve уменьшается на amount_gross_18 − fee_18. sellTeamFee уходит в treasury, не влияя на итоговое уменьшение freeReserve.
Раздел «Доказательство для buyFromPool»:
- Каскадная покупка. X_6 от пользователя.
- X_18 = fromUSDC(X_6), fee_18 = buyFee, X_net_18 = X_18 − fee_18.
- tokens_from_pool = min(pool, tokensNeeded), X_pool_used_18 = tokens_from_pool * poolPrice / PRECISION.
- X_remaining_18 = X_net_18 − X_pool_used_18.
- Часть через пул: R(S) не меняется, S_curve не меняется. reserve_new = reserve_old + X_pool_used_18.
- Часть через кривую (если X_remaining_18 > 0): см. buyFromCurveFor.
- fee_18 → reserveManager на шаге 11a. Fee увеличивает reserve.
- sweep-dust: остаток USDC (≤ 2 wei-6) → reserveManager. Увеличивает reserve.
- Инвариант держится.
Раздел «Сводка»:
- buyFromCurve, buyFromCurveFor: инвариант держится за счёт fee_18 (buyFee).
- redeemFromCurve: инвариант держится за счёт fee_18 + early_fee_18 (redeemFee + earlySellFee). sellTeamFee не влияет.
- sellToPool: инвариант держится за счёт InsufficientFreeReserve check. sellTeamFee не влияет.
- buyFromPool: инвариант держится за счёт fee_18 (buyFee) + каскад через buyFromCurveFor.
- sellTeamFee нигде не нарушает инвариант reserve ≥ R(S_curve): уменьшение reserve в sell-функциях не зависит от sellTeamFee.
|Публичный API:
- Документ-спецификация: формулы, границы, доказательства.
|↙ ПОТРЕБЛЯЕТ:
- E.1.01.02 integral_function.md (формула R)
- E.1.01.05 pool_price_formula.md (обновление poolPrice)
- C.3.01.01 CurveController (redeemFromCurve с sellTeamFee)
- C.3.01.02 PoolController (sellToPool с sellTeamFee, buyFromPool с sweep-dust)
|↘ ПРЕДОСТАВЛЯЕТ:
- Формальное доказательство для аудита
|Реализация: Markdown-документ.
|Примечания: ИСПРАВЛЕНО 13-я ИТЕРАЦИЯ (ревизия 4): в разделы «Доказательство для redeemFromCurve» и «Доказательство для sellToPool» добавлены блоки про sellTeamFee. Показано, что sellTeamFee не нарушает инвариант reserve ≥ R(S_curve): уменьшение reserve в sell-функциях не зависит от sellTeamFee. Добавлен раздел «Сводка». Версия поднята с v.0.0.01 до v.0.0.02.
РАНЕЕ: доказательство reserve ≥ R(S_curve) для всех операций.

|E.1.01.07|Economics|Core|Proof|e/01_core/pool_price_proof.md|E.1.01.05|v.0.0.02|Planned|§5.3|
|Описание: Доказательство границ poolPrice.
Утверждение 1 (ceiling): poolPrice ≤ P(S)*(1+maxGap) при любых операциях, включая уменьшение S_curve.
- Доказательство: в redeemFromCurve и sellToPool poolPrice явно ограничивается ceiling = P(newS)*(1+maxGap). В buyFromCurve/buyFromCurveFor S_curve растёт, P(S) растёт, ceiling растёт — poolPrice не может превысить новое ceiling, если он не превышал старое.
Утверждение 2 (floor): poolPrice ≥ P(S)/(1+maxGap) при любых операциях, включая рост S_curve.
- Доказательство: в buyFromCurve и buyFromCurveFor S_curve растёт, P(newS) > P(S), floor = P(newS)/(1+maxGap) > P(S)/(1+maxGap). Если poolPrice < новый floor, он поднимается до floor (_enforcePoolPriceFloor). Если poolPrice ≥ нового floor — не меняется. В redeemFromCurve и sellToPool S_curve уменьшается (или не меняется), floor не растёт — poolPrice ≥ старого floor ≥ нового floor. Defensive floor в redeemFromCurve дополнительно гарантирует.
Следствие:
- poolPrice всегда в симметричном коридоре [P(S)/(1+maxGap), P(S)*(1+maxGap)].
- Арбитраж между кривой и пулом ограничен MAX_GAP в обе стороны.
|Публичный API:
- Документ-спецификация: формулы, границы, доказательства.
|↙ ПОТРЕБЛЯЕТ:
- E.1.01.05 pool_price_formula.md
|↘ ПРЕДОСТАВЛЯЕТ:
- Формальное доказательство для аудита
|Реализация: Markdown-документ.
|Примечания: ИСПРАВЛЕНО 12-я ИТЕРАЦИЯ: добавлено Утверждение 2 (floor). Ранее доказывалась только верхняя граница.

|E.2.01.01|Economics|Simulation|Python|e/02_simulation/base_model.py|E.1.01.02|v.0.0.01|Draft|§13|
|Описание: Базовая Python-модель bonding curve. Эталон для верификации Solidity.
|Публичный API:
- class BondingCurve: __init__(P0, S0, alpha, levels)
- def P(S) -> float
- def R(S) -> float
- def deltaS_for_buy(S, X) -> float
- def amount_for_redeem(S, deltaS) -> float
- def buy(S, X) -> (S_new, tokens)
- def redeem(S, deltaS) -> (S_new, amount)
|↙ ПОТРЕБЛЯЕТ:
- E.1.01.02 integral_function.md (формула R)
|↘ ПРЕДОСТАВЛЯЕТ:
- Эталонные значения для сравнения с Solidity
|Реализация: Чистый Python 3.11, numpy, scipy. Все расчёты в float64.
|Примечания: Используется в S.1.01.03 verify_math.py для кросс-проверки.

|E.2.01.02|Economics|Simulation|Python|e/02_simulation/crash_mass_exit.py|E.2.01.01|v.0.0.02|Draft|§13.4|
|Описание: Crash-тест массового выхода. 10%, 25%, 50%, 80%, 100% держателей. Проверка reserve ≥ R(S_curve), treasury_monotonic.
|Публичный API:
- def run(scenario: str, sell_team_fee_bp: int = 10) -> dict
- def main() -> None
|↙ ПОТРЕБЛЯЕТ:
- E.2.01.01 base_model.py
|↘ ПРЕДОСТАВЛЯЕТ:
- Отчёт по инвариантам, резерву, пулу, treasury_balance
|Реализация: Симулирует продажи, логирует reserve, freeReserve, poolPrice, treasury_balance.
Возвращает dict:
  {
    "scenario": str,
    "reserve_history": list[float],
    "freeReserve_history": list[float],
    "poolPrice_history": list[float],
    "treasury_balance_history": list[float],                       // НОВОЕ
    "invariants": {
        "reserve_ge_R": bool,
        "treasury_monotonic": bool                                 // НОВОЕ
    },
    "final_state": {
        "reserve": float,
        "freeReserve": float,
        "poolPrice": float,
        "treasury_balance": float                                  // НОВОЕ
    }
  }
|Примечания: ИСПРАВЛЕНО 13-я ИТЕРАЦИЯ (ревизия 4):
- Добавлен параметр sell_team_fee_bp (default 10).
- Добавлено отслеживание treasury_balance в истории и финальном состоянии.
- Добавлен инвариант treasury_monotonic: treasury_balance не должен убывать ни на одном шаге.
- Проверка reserve ≥ R(S_curve) на каждом шаге — сохранена с ранней итерации.
Ранее в E.2.01.02 не было tracking treasury — несмотря на то что E.2.01.05 (crash_pool.py) было обновлено, остальные crash-тесты остались без sellTeamFee. Версия поднята с v.0.0.01 до v.0.0.02.

|E.2.01.03|Economics|Simulation|Python|e/02_simulation/crash_whale.py|E.2.01.01|v.0.0.02|Draft|§13.4|
|Описание: Crash-тест кита. 10%, 25%, 50% предложения. Проверка maxBalance, maxSellPctPerDay, treasury_monotonic.
|Публичный API:
- def run(whale_pct: float, sell_team_fee_bp: int = 10) -> dict
- def main() -> None
|↙ ПОТРЕБЛЯЕТ:
- E.2.01.01 base_model.py
|↘ ПРЕДОСТАВЛЯЕТ:
- Отчёт по обходу лимитов, treasury_balance
|Реализация: Симулирует продажи крупного держателя. Логирует reserve, freeReserve, treasury_balance.
Возвращает dict:
  {
    "whale_pct": float,
    "reserve_history": list[float],
    "freeReserve_history": list[float],
    "treasury_balance_history": list[float],                       // НОВОЕ
    "invariants": {
        "maxBalance_respected": bool,
        "maxSellPctPerDay_respected": bool,
        "reserve_ge_R": bool,
        "treasury_monotonic": bool                                 // НОВОЕ
    },
    "final_state": {
        "reserve": float,
        "freeReserve": float,
        "treasury_balance": float                                  // НОВОЕ
    }
  }
|Примечания: ИСПРАВЛЕНО 13-я ИТЕРАЦИЯ (ревизия 5):
- Добавлен параметр sell_team_fee_bp (default 10).
- Добавлено отслеживание treasury_balance в истории и финальном состоянии.
- Добавлен инвариант treasury_monotonic.
- Проверка maxBalance, maxSellPctPerDay — сохранена с ранней итерации.
Ранее в E.2.01.03 не было tracking treasury — несмотря на то что E.2.01.05 (crash_pool.py) и E.2.01.02 (crash_mass_exit.py) были обновлены, whale-тест остался без sellTeamFee. Версия поднята с v.0.0.01 до v.0.0.02.

|E.2.01.04|Economics|Simulation|Python|e/02_simulation/crash_cycles.py|E.2.01.01|v.0.0.02|Draft|§13.4|
|Описание: Crash-тест повторяющихся циклов. 1000+ BUY/SELL. Проверка накопления ошибок округления и treasury_monotonic.
|Публичный API:
- def run(cycles: int, sell_team_fee_bp: int = 10) -> dict
- def main() -> None
|↙ ПОТРЕБЛЯЕТ:
- E.2.01.01 base_model.py
|↘ ПРЕДОСТАВЛЯЕТ:
- Отчёт по ошибкам округления, treasury_balance
|Реализация: Симулирует N циклов BUY/SELL. Логирует treasury_balance на каждом цикле.
Возвращает dict:
  {
    "cycles": int,
    "rounding_error_max": float,                                   // максимум |S_calc − S_actual|
    "treasury_balance_history": list[float],                       // НОВОЕ
    "invariants": {
        "rounding_error_below_epsilon": bool,
        "reserve_ge_R": bool,
        "totalSupply_eq_S_curve": bool,
        "treasury_monotonic": bool                                 // НОВОЕ
    },
    "final_state": {
        "S_curve": float,
        "reserve": float,
        "treasury_balance": float,                                 // НОВОЕ
        "total_sell_team_fee_collected": float                     // НОВОЕ
    }
  }
|Примечания: ИСПРАВЛЕНО 13-я ИТЕРАЦИЯ (ревизия 5):
- Добавлен параметр sell_team_fee_bp (default 10).
- Добавлено отслеживание treasury_balance в истории и финальном состоянии.
- Добавлен инвариант treasury_monotonic.
- Добавлено поле total_sell_team_fee_collected — суммарный доход команды в USDC за 1000+ циклов.
КРИТИЧНО: crash_cycles.py — единственный тест, который явно проверяет накопление ошибок округления при 1000+ операциях. Без tracking treasury невозможно проверить, накапливается ли пыль на treasury balance или корректно ли отбрасывается при toUSDC. Ранее в E.2.01.04 не было tracking treasury. Версия поднята с v.0.0.01 до v.0.0.02.

|E.2.01.05|Economics|Simulation|Python|e/02_simulation/crash_pool.py|E.2.01.01|v.0.0.03|Draft|§13.4|
|Описание: Crash-тест пула. sellToPool/buyFromPool/buyFromCurve/redeemFromCurve циклы. Проверка poolPrice (симметричный коридор), freeReserve, treasury_balance.
|Публичный API:
- def run(cycles: int, sell_team_fee_bp: int = 10) -> dict
- def main() -> None
|↙ ПОТРЕБЛЯЕТ:
- E.2.01.01 base_model.py
|↘ ПРЕДОСТАВЛЯЕТ:
- Отчёт по poolPrice, freeReserve, treasury_balance
|Реализация: Симулирует sellToPool/buyFromPool/buyFromCurve/redeemFromCurve циклы. Логирует poolPrice, freeReserve, treasury_balance на каждом шаге.
Возвращает dict:
  {
    "cycles": int,
    "poolPrice_history": list[float],
    "freeReserve_history": list[float],
    "treasury_balance_history": list[float],                       // НОВОЕ
    "invariants": {
        "poolPrice_ceiling": bool,                                 // poolPrice <= P(S)*(1+maxGap)
        "poolPrice_floor": bool,                                   // poolPrice >= P(S)/(1+maxGap)
        "reserve_ge_R": bool,                                      // reserve >= R(S)
        "totalSupply_eq_S_curve": bool,
        "treasury_monotonic": bool                                 // treasury_balance никогда не убывает  // НОВОЕ
    },
    "final_state": {
        "poolPrice": float,
        "freeReserve": float,
        "treasury_balance": float,                                 // НОВОЕ
        "total_sell_team_fee_collected": float                     // НОВОЕ
    }
  }
|Примечания: ИСПРАВЛЕНО 13-я ИТЕРАЦИЯ (ревизия 2):
- Добавлен параметр sell_team_fee_bp (default 10).
- Добавлено отслеживание treasury_balance в истории и финальном состоянии.
- Добавлен инвариант treasury_monotonic: treasury_balance не должен убывать ни на одном шаге.
- Добавлено поле total_sell_team_fee_collected — суммарный доход команды в USDC за симуляцию.
- Проверка обоих границ poolPrice (floor, ceiling) — с 12-й итерации.
РАНЕЕ 12-я ИТЕРАЦИЯ: добавлены сценарии buyFromCurve (поднимает floor) и redeemFromCurve (применяет обе границы defensive). Проверяются обе границы коридора.

|E.2.01.06|Economics|Simulation|Python|e/02_simulation/crash_levels.py|E.2.01.01|v.0.0.02|Draft|§13.4|
|Описание: Crash-тест переходов через уровни. Проверка непрерывности цены и treasury_monotonic.
|Публичный API:
- def run(transitions: list, sell_team_fee_bp: int = 10) -> dict
- def main() -> None
|↙ ПОТРЕБЛЯЕТ:
- E.2.01.01 base_model.py
|↘ ПРЕДОСТАВЛЯЕТ:
- Отчёт по непрерывности P(S), treasury_balance
|Реализация: Симулирует покупки на границах уровней. Логирует P(S) и treasury_balance на каждой границе.
Возвращает dict:
  {
    "transitions": list,
    "price_discontinuity_max": float,                              // максимум |P(S_end) − P(S_start_next)|
    "treasury_balance_history": list[float],                       // НОВОЕ
    "invariants": {
        "price_continuity_below_epsilon": bool,
        "reserve_ge_R": bool,
        "treasury_monotonic": bool                                 // НОВОЕ
    },
    "final_state": {
        "S_curve": float,
        "current_level": int,
        "treasury_balance": float                                  // НОВОЕ
    }
  }
|Примечания: ИСПРАВЛЕНО 13-я ИТЕРАЦИЯ (ревизия 5):
- Добавлен параметр sell_team_fee_bp (default 10).
- Добавлено отслеживание treasury_balance в истории и финальном состоянии.
- Добавлен инвариант treasury_monotonic.
- Проверка |P(S_end) − P(S_start_next)| < ε — сохранена с ранней итерации.
Ранее в E.2.01.06 не было tracking treasury. Версия поднята с v.0.0.01 до v.0.0.02.

|E.2.01.07|Economics|Simulation|Python|e/02_simulation/crash_full_cycle.py|E.2.01.01|v.0.0.02|Draft|§13.4|
|Описание: Crash-тест полного цикла. mint → pool → pool buy → curve redeem → mint → level transition → pool → redeem → sellTeamFee accumulation. Возвращает dict с результатами и флагами инвариантов.
|Публичный API:
- def run(sell_team_fee_bp: int = 10) -> dict
- def main() -> None
|↙ ПОТРЕБЛЯЕТ:
- E.2.01.01 base_model.py
|↘ ПРЕДОСТАВЛЯЕТ:
- Отчёт по инвариантам после каждого шага
- Отчёт по protocol revenue (treasury_balance)
|Реализация: Полный цикл операций. Возвращает словарь с историей и финальным состоянием.
Возвращает dict:
  {
    "steps": [...],
    "invariants": {
        "reserve_ge_R": bool,
        "totalSupply_eq_S_curve": bool,
        "poolPrice_ceiling": bool,
        "poolPrice_floor": bool,
        "treasury_monotonic": bool                                 // НОВОЕ
    },
    "final_state": {
        "poolPrice": float,
        "freeReserve": float,
        "reserve": float,
        "S_curve": float,
        "treasury_balance": float,                                 // НОВОЕ
        "total_sell_team_fee_collected": float                     // НОВОЕ
    }
  }
|Примечания: ИСПРАВЛЕНО 13-я ИТЕРАЦИЯ (ревизия 4):
- Добавлен параметр sell_team_fee_bp (default 10).
- Добавлен инвариант treasury_monotonic в invariants.
- Добавлены treasury_balance и total_sell_team_fee_collected в final_state.
- Проверка всех инвариантов после каждой операции — сохранена с ранней итерации.
Ранее в E.2.01.07 не было tracking treasury — несмотря на то что E.2.01.05 (crash_pool.py) было обновлено, полный цикл остался без sellTeamFee. Версия поднята с v.0.0.01 до v.0.0.02.

|E.3.01.01|Economics|Calibration|Python|e/03_calibration/tune_params.py|E.2.01.01|v.0.0.01|Draft|§7|
|Описание: Скрипт калибровки P0, S0, alpha. Подбор оптимальных значений.
|Публичный API:
- def tune(targets: dict) -> dict  # {"P0": float, "S0": float, "alpha": float, "levels": [...], "forecast": [...]}
- def main() -> None
|↙ ПОТРЕБЛЯЕТ:
- E.2.01.01 base_model.py
|↘ ПРЕДОСТАВЛЯЕТ:
- Оптимальные P0, S0, alpha, таблицу уровней, прогноз роста
- E.3.01.02 params_output.json
- E.3.01.03 params_output.csv
|Реализация: Grid search или scipy.optimize. Возвращает словарь со всеми параметрами.
|Примечания: Целевые сборы задаются в targets.

|E.3.01.02|Economics|Calibration|JSON|e/03_calibration/params_output.json|E.3.01.01|v.0.0.01|Draft|§7|
|Описание: Результат калибровки в JSON. P0, S0, alpha, таблица уровней, прогноз роста.

|Публичный API:
- Результат калибровки: параметры кривой и прогноз роста; читается скриптами E.3.01.*.
|↙ ПОТРЕБЛЯЕТ:
- E.3.01.01
|↘ ПРЕДОСТАВЛЯЕТ:
- параметры для C.2.01.03 Constants
|Реализация: JSON-файл, проверяется схемой и CI.

|E.3.01.03|Economics|Calibration|CSV|e/03_calibration/params_output.csv|E.3.01.01|v.0.0.01|Draft|§7|
|Описание: Результат калибровки в CSV для анализа в Excel.

|Публичный API:
- Результат калибровки: параметры кривой и прогноз роста; читается скриптами E.3.01.*.
|↙ ПОТРЕБЛЯЕТ:
- E.3.01.01
|↘ ПРЕДОСТАВЛЯЕТ:
- параметры для C.2.01.03 Constants
|Реализация: CSV-файл.

|G.1.01.01|Governance|Snapshot|JSON|governance/snapshot/space.json|—|v.0.0.01|Draft|§10|
|Описание: Конфигурация Snapshot space. Название, сеть, стратегии, администраторы.

|Публичный API:
- Конфигурация Snapshot: space, стратегии, валидация предложений.
|↙ ПОТРЕБЛЯЕТ:
- — (нет зависимостей)
|↘ ПРЕДОСТАВЛЯЕТ:
- площадку голосования по параметрам
|Реализация: JSON-файл, проверяется схемой и CI.

|G.1.01.02|Governance|Snapshot|JSON|governance/snapshot/strategy.json|G.1.01.01|v.0.0.01|Draft|§10|
|Описание: Стратегия голосования Snapshot. Квадратичное: votingWeight = sqrt(stakedXartIA).

|Публичный API:
- Конфигурация Snapshot: space, стратегии, валидация предложений.
|↙ ПОТРЕБЛЯЕТ:
- G.1.01.01
|↘ ПРЕДОСТАВЛЯЕТ:
- площадку голосования по параметрам
|Реализация: JSON-файл, проверяется схемой и CI.

|G.1.01.03|Governance|Snapshot|JSON|governance/snapshot/validation.json|G.1.01.01|v.0.0.01|Draft|§10|
|Описание: Правила валидации предложений. Минимальный порог, кворум, сроки.

|Публичный API:
- Конфигурация Snapshot: space, стратегии, валидация предложений.
|↙ ПОТРЕБЛЯЕТ:
- G.1.01.01
|↘ ПРЕДОСТАВЛЯЕТ:
- площадку голосования по параметрам
|Реализация: JSON-файл, проверяется схемой и CI.

|G.2.01.01|Governance|Proposals|Markdown|governance/proposals/params-template.md|—|v.0.0.01|Draft|§10.3|
|Описание: Шаблон предложения по изменению параметров.

|Публичный API:
- Шаблон предложения: заголовок, мотивация, спецификация, голосование, timelock.
|↙ ПОТРЕБЛЯЕТ:
- — (нет зависимостей)
|↘ ПРЕДОСТАВЛЯЕТ:
- предложения для Governance.propose()
|Реализация: Markdown-документ.

|G.2.01.02|Governance|Proposals|Markdown|governance/proposals/emergency-template.md|G.2.01.01|v.0.0.01|Planned|§10.3|
|Описание: Шаблон экстренного предложения. Для Circuit Breaker, приостановки операций.

|Публичный API:
- Шаблон предложения: заголовок, мотивация, спецификация, голосование, timelock.
|↙ ПОТРЕБЛЯЕТ:
- G.2.01.01
|↘ ПРЕДОСТАВЛЯЕТ:
- предложения для Governance.propose()
|Реализация: Markdown-документ.

|G.2.01.03|Governance|Proposals|Markdown|governance/proposals/upgrade-template.md|G.2.01.01|v.0.0.01|Planned|§10.3|
|Описание: Шаблон предложения по апгрейду контрактов.

|Публичный API:
- Шаблон предложения: заголовок, мотивация, спецификация, голосование, timelock.
|↙ ПОТРЕБЛЯЕТ:
- G.2.01.01
|↘ ПРЕДОСТАВЛЯЕТ:
- предложения для Governance.propose()
|Реализация: Markdown-документ.

|G.2.01.04|Governance|Proposals|Markdown|governance/proposals/budget-template.md|G.2.01.01|v.0.0.01|Planned|§10.3|
|Описание: Шаблон бюджетного предложения. Распределение Treasury, финансирование проектов.

|Публичный API:
- Шаблон предложения: заголовок, мотивация, спецификация, голосование, timelock.
|↙ ПОТРЕБЛЯЕТ:
- G.2.01.01
|↘ ПРЕДОСТАВЛЯЕТ:
- предложения для Governance.propose()
|Реализация: Markdown-документ.

|I.1.01.01|Infra|CI/CD|YAML|.github/workflows/test.yml|T.3.01.08|v.0.0.01|Draft|§13|
|Описание: GitHub Actions для тестов. forge test, fuzz, invariant. Покрытие ≥ 95%.
|Публичный API:
- on: pull_request, push (main)
- jobs.test: forge test, forge coverage, upload artifacts
|↙ ПОТРЕБЛЯЕТ:
- D.2.01.04 foundry.toml
- T.1.*, T.2.*, T.3.*, T.4.*, T.5.*, T.6.*, T.7.*
|↘ ПРЕДОСТАВЛЯЕТ:
- Отчёт покрытия, статус тестов
|Реализация: Кэширует зависимости, запускает forge test --fuzz-runs 10000.
|Примечания: ИЗМЕНЕНИЕ: добавлены T.7.* (utils) в зависимости. Падает, если покрытие < 95%.

|I.1.01.02|Infra|CI/CD|YAML|.github/workflows/deploy.yml|D.1.01.01|v.0.0.01|Draft|§14|
|Описание: GitHub Actions для деплоя. Ручное подтверждение для mainnet.
|Публичный API:
- on: workflow_dispatch (с выбором сети)
- jobs.deploy: forge script Deploy.s.sol
|↙ ПОТРЕБЛЯЕТ:
- D.1.01.01 Deploy.s.sol
- D.2.01.03 .env
|↘ ПРЕДОСТАВЛЯЕТ:
- Развёрнутые контракты, отчёт
|Реализация: manual approval через environment.
|Примечания: mainnet требует 2 approvals.

|I.1.01.03|Infra|CI/CD|YAML|.github/workflows/audit.yml|—|v.0.0.01|Draft|§12.3|
|Описание: GitHub Actions для аудита. Slither, Mythril.
|Публичный API:
- on: schedule (weekly), workflow_dispatch
- jobs.audit: slither, mythril, upload SARIF
|↙ ПОТРЕБЛЯЕТ:
- C.0.*, C.1.*, C.2.*, C.3.*, C.4.*, C.5.*, C.6.*, C.7.*, C.8.*, C.9.*, C.10.*
|↘ ПРЕДОСТАВЛЯЕТ:
- Отчёт аудита в GitHub Security
|Реализация: Использует official Slither action.
|Примечания: ИЗМЕНЕНИЕ: расширено на все контракты C.0–C.10. Fail on high severity.

|I.1.01.04|Infra|CI/CD|Markdown|.github/ISSUE_TEMPLATE.md|—|v.0.0.01|Draft|—|
|Описание: Шаблон issue. Описание, шаги воспроизведения, ожидаемое поведение.

|Публичный API:
- GitHub-конфигурация: шаблоны issue/PR, зависимости, политики репозитория.
|↙ ПОТРЕБЛЯЕТ:
- — (нет зависимостей)
|↘ ПРЕДОСТАВЛЯЕТ:
- проверки и шаблоны для PR
|Реализация: Markdown-документ.

|I.1.01.05|Infra|CI/CD|Markdown|.github/PULL_REQUEST_TEMPLATE.md|—|v.0.0.01|Planned|—|
|Описание: Шаблон pull request. Чеклист: тесты, документация, аудит.

|Публичный API:
- GitHub-конфигурация: шаблоны issue/PR, зависимости, политики репозитория.
|↙ ПОТРЕБЛЯЕТ:
- — (нет зависимостей)
|↘ ПРЕДОСТАВЛЯЕТ:
- проверки и шаблоны для PR
|Реализация: Markdown-документ.

|I.1.01.06|Infra|CI/CD|YAML|.github/dependabot.yml|—|v.0.0.01|Draft|—|
|Описание: Dependabot. Автообновление OpenZeppelin, forge-std, solmate.

|Публичный API:
- GitHub-конфигурация: шаблоны issue/PR, зависимости, политики репозитория.
|↙ ПОТРЕБЛЯЕТ:
- — (нет зависимостей)
|↘ ПРЕДОСТАВЛЯЕТ:
- проверки и шаблоны для PR
|Реализация: YAML-конфигурация, применяется в CI/инфраструктуре.

|I.1.01.07|Infra|CI/CD|YAML|.github/workflows/release.yml|—|v.0.0.01|Draft|—|
|Описание: GitHub Actions для релизов. Тегирование, публикация артефактов, changelog.
|Публичный API:
- on: push (tags v*)
- jobs.release: build, create release, upload ABI
|↙ ПОТРЕБЛЯЕТ:
- R.3.01.03 changelog.md
- D.2.01.06 package.json
|↘ ПРЕДОСТАВЛЯЕТ:
- GitHub Release с артефактами
|Реализация: Использует softprops/action-gh-release.
|Примечания: ABI публикуются как артефакты релиза.

|I.2.01.01|Infra|Meta|TXT|LICENSE|—|v.0.0.01|Draft|—|
|Описание: Лицензия проекта. **AGPL-3.0** — сильный копилефт: производные работы и сетевые сервисы обязаны оставаться открытыми. Выбор по духу Хартии: прозрачность кода важнее закрытости.

|Публичный API:
- Метаданные репозитория: лицензия, правила участия, безопасность, changelog.
|↙ ПОТРЕБЛЯЕТ:
- — (нет зависимостей)
|↘ ПРЕДОСТАВЛЯЕТ:
- правила участия и юридическую обвязку репозитория
|Реализация: Текстовый файл, читается инструментами сборки.

|I.2.01.02|Infra|Meta|Markdown|CONTRIBUTING.md|—|v.0.0.01|Planned|—|
|Описание: Руководство для контрибьюторов. Стиль кода, процесс review.

|Публичный API:
- Метаданные репозитория: лицензия, правила участия, безопасность, changelog.
|↙ ПОТРЕБЛЯЕТ:
- — (нет зависимостей)
|↘ ПРЕДОСТАВЛЯЕТ:
- правила участия и юридическую обвязку репозитория
|Реализация: Markdown-документ.

|I.2.01.03|Infra|Meta|Markdown|CODE_OF_CONDUCT.md|—|v.0.0.01|Planned|—|
|Описание: Кодекс поведения. Правила общения, процедура разрешения конфликтов.

|Публичный API:
- Метаданные репозитория: лицензия, правила участия, безопасность, changelog.
|↙ ПОТРЕБЛЯЕТ:
- — (нет зависимостей)
|↘ ПРЕДОСТАВЛЯЕТ:
- правила участия и юридическую обвязку репозитория
|Реализация: Markdown-документ.

|I.2.01.04|Infra|Meta|Markdown|SECURITY.md|—|v.0.0.01|Draft|§12|
|Описание: GitHub security policy. Как сообщить об уязвимости, bug bounty, контакты.

|Публичный API:
- Метаданные репозитория: лицензия, правила участия, безопасность, changelog.
|↙ ПОТРЕБЛЯЕТ:
- — (нет зависимостей)
|↘ ПРЕДОСТАВЛЯЕТ:
- правила участия и юридическую обвязку репозитория
|Реализация: Markdown-документ.

|I.2.01.05|Infra|Meta|Markdown|CHANGELOG.md|R.3.01.03|v.0.0.01|Draft|—|
|Описание: User-facing changelog. Версии, даты, ключевые изменения, ссылки на аудиты.

|Публичный API:
- Метаданные репозитория: лицензия, правила участия, безопасность, changelog.
|↙ ПОТРЕБЛЯЕТ:
- R.3.01.03
|↘ ПРЕДОСТАВЛЯЕТ:
- правила участия и юридическую обвязку репозитория
|Реализация: Markdown-документ.

|L.1.01.01|Legal|Whitepaper|Markdown|legal/whitepaper.md|R.1.01.01|v.0.0.02|Draft|§17|
|Описание: White Paper на английском. Архитектура, экономика, utility токена. Раскрытие protocol revenue. Без обещаний прибыли.
Содержание (обязательные разделы):
Раздел «1. Introduction»:
- Описание XartIA как bonding curve протокола.
- Utility токена XRT: средство обмена внутри протокола, доступ к bonding curve.
- Явное указание: токен НЕ является ценной бумагой, НЕ обещает прибыль, НЕ является инвестиционным инструментом.
Раздел «2. Architecture»:
- Bonding curve, уровни предложения, интеграл R(S).
- Внутренний пул (PoolController), симметричный коридор poolPrice.
- Резерв (ReserveManager), freeReserve, Circuit Breaker.
- Роли: Safe Multisig 3/5, Timelock 7 дней.
Раздел «3. Token economics»:
- XRT: 18 decimals, эмиссия через bonding curve.
- teamTokens: 0.5% от ΔS на покупках → Vesting (cliff 365 дней, duration 730 дней).
- sellTeamFee: 0.1% (default) USDC от суммы продажи → treasury.                                  // НОВОЕ 13-я ИТЕРАЦИЯ (ревизия 2)
  - Governance-параметр, диапазон 0–0.5%.
  - treasury — immutable адрес, задаётся при деплое. Обычно совпадает с Safe Multisig.
  - Назначение: финансирование операционных расходов протокола (разработка, аудит, инфраструктура).
  - НЕ распределяется между держателями XRT. НЕ является дивидендом. НЕ создаёт ожидания прибыли.
- buyFee (0.5%) и redeemFee (0.5%): остаются в ReserveManager, увеличивают freeReserve.
- earlySellFee (0–5%, по умолчанию 0): антифлип-механизм для redeemFromCurve.
Раздел «4. User journey»:
- Покупка через кривую (buyFromCurve) или пул (buyFromPool).
- Продажа через кривую (redeemFromCurve) или пул (sellToPool).
- Round-trip cost: 1.1% без earlySellFee.
Раздел «5. Governance»:
- Safe Multisig 3/5 → Governance → Timelock (7 дней) → целевой контракт.
- Параметры: buyFee, redeemFee, earlySellFee, earlySellPeriod, maxPurchasePct, minimalPurchase, maxSellPctPerDay, circuitBreaker.threshold, sellTeamFee.
Раздел «6. Security»:
- Immutable контракты, без upgradeability.
- Аудит, bug bounty.
- Инварианты: reserve >= R(S_curve), totalSupply == S_curve, poolPrice в симметричном коридоре.
Раздел «7. Legal disclaimers»:
- Токен НЕ является security в смысле Howey Test (США) — см. L.1.01.03 token-classification.md.
- Токен НЕ подпадает под MiCA как финансовый инструмент (требует юридического заключения).
- Protocol revenue (sellTeamFee) — операционный доход протокола, НЕ распределяется между держателями.
- Отсутствие обещаний прибыли, доходности, роста цены.
- Пользователь несёт риск потери средств.
- Юрисдикционные ограничения: см. L.3.01.01 jurisdiction.pdf.
Раздел «8. Roadmap» (краткий):
- Ссылка на R.3.01.07 roadmap.md.
|Публичный API:
- Документ; публичного API нет.
|↙ ПОТРЕБЛЯЕТ:
- R.1.01.01 xartia_4.2.md (техническая спецификация)
- C.2.01.03 Constants (TEAM_PERCENT, sellTeamFee default)
- L.1.01.03 token-classification.md (юридическая квалификация)
|↘ ПРЕДОСТАВЛЯЕТ:
- Публичный документ для инвесторов, пользователей, регуляторов
|Реализация: Markdown-документ на английском.
|Примечания: НОВОЕ 13-я ИТЕРАЦИЯ (ревизия 2): добавлен раздел про sellTeamFee как protocol revenue. КРИТИЧНО для Howey/MiCA: наличие revenue-канала усиливает риск квалификации токена как security. Явно указано, что sellTeamFee НЕ распределяется между держателями и НЕ создаёт ожидания прибыли. Юридическое заключение L.3.01.01 должно учесть этот канал. Без юридического заключения деплой на mainnet не рекомендован.

|L.1.01.02|Legal|Whitepaper|Markdown|legal/whitepaper-ru.md|L.1.01.01|v.0.0.02|Draft|§17|
|Описание: White Paper на русском. Перевод с адаптацией. Содержит те же разделы, что L.1.01.01, включая раскрытие protocol revenue (sellTeamFee).
Содержание: полный перевод L.1.01.01 с адаптацией юридических формулировок под русскоязычную аудиторию.
Раздел «3. Token economics» (русская версия):
- sellTeamFee: 0.1% (по умолчанию) USDC от суммы продажи → treasury.
  - Governance-параметр, диапазон 0–0.5%.
  - treasury — неизменяемый адрес, задаётся при деплое. Обычно совпадает с Safe Multisig.
  - Назначение: финансирование операционных расходов протокола (разработка, аудит, инфраструктура).
  - НЕ распределяется между держателями XRT. НЕ является дивидендом. НЕ создаёт ожиданий прибыли.
Раздел «7. Legal disclaimers» (русская версия):
- Токен НЕ является ценной бумагой.
- Protocol revenue (sellTeamFee) — операционный доход протокола, НЕ распределяется между держателями.
- Отсутствие обещаний прибыли, доходности, роста цены.
- Юрисдикционные ограничения.
|Публичный API:
- Документ; публичного API нет.
|↙ ПОТРЕБЛЯЕТ:
- L.1.01.01 whitepaper.md (оригинал)
- L.1.01.03 token-classification.md
|↘ ПРЕДОСТАВЛЯЕТ:
- Публичный документ для русскоязычной аудитории
|Реализация: Markdown-документ на русском. Синхронизирован с L.1.01.01.
|Примечания: НОВОЕ 13-я ИТЕРАЦИЯ (ревизия 2): синхронизирован с L.1.01.01 — добавлено раскрытие sellTeamFee. КРИТИЧНО: юридические формулировки должны пройти review юриста перед публикацией. Особенно раздел «Legal disclaimers» — некорректная формулировка может ухудшить юридическую позицию.

|L.1.01.03|Legal|Whitepaper|Markdown|legal/token-classification.md|L.1.01.01|v.0.0.02|Draft|§17.2|
|Описание: Юридическая квалификация токена. Howey Test, MiCA, utility. Учёт protocol revenue (sellTeamFee) как фактора риска.
Содержание:
Раздел «1. Общая характеристика токена XRT»:
- Утилитарный токен протокола XartIA.
- Функции: покупка/продажа через bonding curve и пул, участие в governance (Snapshot, off-chain).
- Отсутствие: права на дивиденды, права на долю в прибыли, права голоса в компании, права на активы.
Раздел «2. Howey Test (США)»:
2.1. Investment of money: пользователь платит USDC → формально удовлетворяет.
2.2. Common enterprise: bonding curve + резерв + пул — общий enterprise. Умеренно удовлетворяет.
2.3. Expectation of profits: КРИТИЧЕСКИЙ ТЕСТ. Учитывая:
  - Наличие bonding curve с P(S), растущей по уровням, может создавать ожидание роста цены.
  - Protocol revenue (sellTeamFee 0.1%) — доход команды, НЕ распределяется между держателями.
  - teamTokens (0.5% от ΔS) — эмиссия в Vesting, НЕ создаёт ожиданий прибыли для держателей.
  - Отсутствие формальных обещаний прибыли в whitepaper.
  Вывод: risk-flagged, требует юридического заключения.
2.4. Efforts of others: команда развивает протокол. Формально удовлетворяет.
2.5. Итог: XRT имеет риск квалификации как security в США. Требуется:
  - Юридическое заключение L.3.01.01.
  - Регистрация по Reg D / Reg S при листинге в США.
  - Или геофенсинг США.
Раздел «3. MiCA (ЕС)»:
3.1. Классификация: utility token vs asset-referenced token vs e-money token.
3.2. XRT не привязан к активу, не является e-money → utility token.
3.3. Требования MiCA для utility token: white paper, notification, ongoing obligations.
3.4. Protocol revenue (sellTeamFee) усиливает риск квалификации как financial instrument (MiFID II).
3.5. Требуется: юридическое заключение L.3.01.01, регистрация в ESMA при работе в ЕС.
Раздел «4. Protocol revenue (sellTeamFee) как фактор риска» (НОВОЕ 13-я ИТЕРАЦИЯ (ревизия 2)):
- sellTeamFee (0.1% USDC с продаж) — это protocol revenue, не распределяемый между держателями.
- НО: наличие revenue-канала может быть интерпретировано регулятором как признак common enterprise с expectation of profits.
- Ключевой аргумент защиты: держатели XRT НЕ получают долю в revenue. treasury используется на операционные расходы (разработка, аудит, инфраструктура), а не на выплаты держателям.
- Рекомендация: явно прописать в whitepaper и Terms, что treasury — операционный фонд, не распределяется.
- Аудит юридического заключения должен специально рассмотреть этот канал.
Раздел «5. Рекомендации»:
- Получить юридическое заключение до деплоя на mainnet (L.3.01.01).
- Геофенсинг: ограничить доступ для США, если заключение признаёт security-риск.
- Terms of Use (L.2.01.01) должны явно указывать отсутствие обещаний прибыли.
- Disclaimer (L.2.01.03) должен повторять ключевые пункты.
- Мониторинг регуляторных изменений (SEC, MiCA, местные регуляторы).
Раздел «6. Открытые вопросы» (ответы — в духе Хартии и логики):
- Является ли bonding curve с P(S) достаточным основанием для expectation of profits?
  Ответ: нет. Кривая задаёт цену эмиссии, но не обещает прибыль: рост возможен только
  за счёт новых покупателей, а держатели не получают доли revenue. В white paper и
  Terms фиксируем: «цена определяется спросом и предложением, доходность не гарантируется»;
  это же повторяет дисклеймер.
- Влияет ли sellTeamFee на квалификацию, если не распределяется?
  Ответ: наличие комиссии само по себе — нет; риск возникает, если она распределяется
  между держателями. Поэтому sellTeamFee идёт в treasury на операционные расходы
  (разработка, аудит, инфраструктура), что прямо прописано в L.1.01.01 и L.2.01.01.
- Как регуляторы рассматривают teamTokens в Vesting (эмиссия vs распределение)?
  Ответ: как отложенное вознаграждение команды, а не распределение прибыли. Cliff 365
  дней и duration 730 дней снижают риск «обещания дохода»; в дисклеймере — отдельный
  пункт о том, что vesting не является выплатой держателям.
- Нужна ли регистрация в каждой юрисдикции?
  Ответ: нет, пока нет активного маркетинга и фиатного выкупа в этой юрисдикции.
  Достаточно квалификации в юрисдикции оператора (L.3.01.01) и геофенсинга для
  США/ЕС, если заключение признаёт риск security. Расширение — по мере выхода на
  новые рынки, а не заранее.
|Публичный API:
- Документ; публичного API нет.
|↙ ПОТРЕБЛЯЕТ:
- L.1.01.01 whitepaper.md
- R.1.01.01 xartia_4.2.md (техническая спецификация)
- C.2.01.03 Constants (TEAM_PERCENT, sellTeamFee)
|↘ ПРЕДОСТАВЛЯЕТ:
- Юридическую квалификацию для внутреннего использования
- Материал для внешнего юридического заключения L.3.01.01
|Реализация: Markdown-документ. Draft — не является юридическим заключением.
|Примечания: НОВОЕ 13-я ИТЕРАЦИЯ (ревизия 2): добавлен раздел «Protocol revenue (sellTeamFee) как фактор риска». КРИТИЧНО: sellTeamFee усиливает Howey-риск. Держатели XRT не получают долю в revenue — это ключевой аргумент защиты, должен быть явно прописан. Юридическое заключение L.3.01.01 должно специально рассмотреть этот канал. Без заключения mainnet деплой не рекомендован. Документ — Draft, не является юридическим заключением.

|L.2.01.01|Legal|Terms|Markdown|legal/terms.md|—|v.0.0.01|Draft|§17.1|
|Описание: Terms of Use. Условия использования, отказ от ответственности.

|Публичный API:
- Документ; публичного API нет.
|↙ ПОТРЕБЛЯЕТ:
- — (нет зависимостей)
|↘ ПРЕДОСТАВЛЯЕТ:
- юридическую позицию и раскрытие рисков
|Реализация: Markdown-документ.

|L.2.01.02|Legal|Privacy|Markdown|legal/privacy.md|—|v.0.0.01|Draft|§17.1|
|Описание: Privacy Policy. Какие данные собираются, права пользователя (GDPR).

|Публичный API:
- Документ; публичного API нет.
|↙ ПОТРЕБЛЯЕТ:
- — (нет зависимостей)
|↘ ПРЕДОСТАВЛЯЕТ:
- юридическую позицию и раскрытие рисков
|Реализация: Markdown-документ.

|L.2.01.03|Legal|Disclaimer|Markdown|legal/disclaimer.md|—|v.0.0.01|Draft|§17.1|
|Описание: Дисклеймер. Токен не ценная бумага, не обещает прибыль.

|Публичный API:
- Документ; публичного API нет.
|↙ ПОТРЕБЛЯЕТ:
- — (нет зависимостей)
|↘ ПРЕДОСТАВЛЯЕТ:
- юридическую позицию и раскрытие рисков
|Реализация: Markdown-документ.

|L.2.01.04|Legal|Cookies|Markdown|legal/cookies.md|—|v.0.0.01|Draft|§17.1|
|Описание: Cookie Policy. Какие cookies используются в dApp, как отключить.

|Публичный API:
- Документ; публичного API нет.
|↙ ПОТРЕБЛЯЕТ:
- — (нет зависимостей)
|↘ ПРЕДОСТАВЛЯЕТ:
- юридическую позицию и раскрытие рисков
|Реализация: Markdown-документ.

|L.3.01.01|Legal|Opinion|PDF|legal/opinion/jurisdiction.pdf|L.1.01.01|v.0.0.01|Draft|§17.2|
|Описание: Юридическое заключение по юрисдикциям. MiCA (ЕС), SEC (США).

|Публичный API:
- Документ; публичного API нет.
|↙ ПОТРЕБЛЯЕТ:
- L.1.01.01
|↘ ПРЕДОСТАВЛЯЕТ:
- юридическую позицию и раскрытие рисков
|Реализация: PDF-документ.

|L.4.01.01|Legal|Audit|PDF|legal/audit-report.pdf|C.1.01.01, C.2.01.01, C.2.01.09, C.3.01.01, C.3.01.02, C.4.01.01, C.5.01.01, C.6.01.01, C.7.01.01, C.7.01.02, C.8.01.01, C.10.01.01|v.0.0.01|Draft|§17|
|Описание: Отчёт внешнего аудита. Уязвимости, рекомендации.

|Публичный API:
- Документ; публичного API нет.
|↙ ПОТРЕБЛЯЕТ:
- C.1.01.01, C.2.01.01, C.2.01.09, C.3.01.01, C.3.01.02, C.4.01.01, C.5.01.01, C.6.01.01, C.7.01.01, C.7.01.02, C.8.01.01, C.10.01.01
|↘ ПРЕДОСТАВЛЯЕТ:
- юридическую позицию и раскрытие рисков
|Реализация: PDF-документ.

|O.1.01.01|Operations|Monitoring|JSON|ops/monitoring/dashboard.json|—|v.0.0.02|Draft|§16|
|Описание: Конфигурация дашборда. Панели: reserve, freeReserve, poolPrice, S_curve, уровень, Circuit Breaker, treasury balance, sellTeamFee.
|Публичный API:
- panels:
  - reserve (18-dec, source: ReserveManager.reserve())
  - freeReserve (18-dec, source: ReserveManager.freeReserve())
  - curveBacking (18-dec, source: ReserveManager.curveBacking())
  - poolPrice (18-dec, source: PoolState.poolPrice())
  - S_curve (18-dec, source: ReserveManager.S_curve())
  - currentLevel (uint8, source: Levels.getLevel(S_curve()))
  - circuitBreakerActive (bool, source: CircuitBreaker.active())
  - treasuryBalance (6-dec, source: IERC20(usdc).balanceOf(treasury))       // НОВОЕ
  - sellTeamFeeCurrent (bp, source: CurveController.sellTeamFee())         // НОВОЕ
  - roundTripCost (bp, source: buyFee + redeemFee + sellTeamFee)           // НОВОЕ
|↙ ПОТРЕБЛЯЕТ:
- C.4.01.01 ReserveManager (reserve, freeReserve, curveBacking, S_curve)
- C.3.01.01 CurveController (buyFee, redeemFee, sellTeamFee, treasury)
- C.3.01.02 PoolController (poolPrice, pool)
- C.2.01.09 Levels (getLevel)
- C.6.01.01 CircuitBreaker (active)
- C.1.01.01 XartIAToken (totalSupply)
|↘ ПРЕДОСТАВЛЯЕТ:
- JSON-конфигурацию для Grafana / Prometheus
|Реализация: JSON-документ. Каждая панель — PromQL-выражение по метрикам из O.1.01.04.
|Примечания: НОВОЕ 13-я ИТЕРАЦИЯ (ревизия 2): добавлены панели treasuryBalance, sellTeamFeeCurrent, roundTripCost. Treasury balance — критичен для контроля protocol revenue и обнаружения аномалий (см. O.1.01.02 alerts.yaml → treasury_balance_anomaly). sellTeamFeeCurrent — для отслеживания governance-изменений. roundTripCost — для UX-мониторинга нагрузки на пользователя.

|O.1.01.02|Operations|Monitoring|YAML|ops/monitoring/alerts.yaml|O.1.01.01|v.0.0.03|Draft|§16.2|
|Описание: Правила алертов. Нарушение инвариантов, Circuit Breaker, аномалии, гейт инициализации, pull-модель, симметричный коридор, protocol revenue.
Правила:
- reserve_ge_curveBacking_violation: критический — инвариант reserve ≥ R(S_curve) сломан. Pause() немедленно.
- CircuitBreaker_triggered: critical — сработал CB. Разбор причины.
- NotInitialized_revert: warning — попытка торговли до initializePoolPrice. Возможен баг в скрипте деплоя или атака.
- MaxCurveForExceeded_series: warning — серия ревертов от одного адреса. Возможна попытка эксплойта pull-модели.
- PoolPrice_floor_triggered: warning — частые обновления floor = манипуляция или аномальный рост S_curve.
- PoolPrice_ceiling_triggered: warning — частые обновления ceiling = манипуляция или массовый выход.
- BuyFromPool_tokensFromCurve_gt_0: info — каскадная покупка. Проверить соответствие newReserve росту (Tenderly trace).
- Allowance_reset_failed: warning — allowance(PoolController → CurveController) != 0 после транзакции. Возможен баг в PoolController.
- USDC_left_in_poolController: critical — balanceOf(PoolController) > 0 после транзакции. Признак утечки fee или каскада.
- setPoolController_called: critical — one-time вызов. Должен произойти только один раз в deploy. Любой повторный вызов — атака.
- treasury_balance_anomaly: warning — резкий рост treasury balance вне ожидаемых операций.     // НОВОЕ
    Условие: delta(treasury_balance) > threshold И нет соответствующих SellTeamFee-событий в окне.
    Возможен: (a) внешний перевод в treasury (donation, не угроза), (b) баг в PoolController (двойное списание sellTeamFee),
    (c) эксплойт. Требуется ручная проверка.
- treasury_balance_decrease: critical — уменьшение treasury balance.                                // НОВОЕ
    Условие: delta(treasury_balance) < 0.
    Treasury — immutable, sellTeamFee только растёт. Уменьшение = компрометация treasury или баг.
    Немедленный pause() через PAUSER_ROLE, эскалация в incident-response.
- sellTeamFee_changed: info — governance-изменение sellTeamFee.                                  // НОВОЕ
    Условие: событие SellTeamFeeUpdated.
    Информационный алерт. Проверить, что изменение прошло через Timelock (7 дней) и Safe Multisig.
- sellTeamFee_out_of_bounds: critical — sellTeamFee вне bounds [0, 50].                           // НОВОЕ
    Условие: sellTeamFee > 50.
    Невозможно при корректной работе (registerParams bounds), но проверяется как defense-in-depth.
|Публичный API:
- Конфигурация мониторинга: алерты, дашборды, сбор метрик.
|↙ ПОТРЕБЛЯЕТ:
- O.1.01.01 dashboard.json
- C.3.01.01 CurveController (события SellTeamFeeUpdated, treasury())
- C.3.01.02 PoolController (события SellToPool с sellTeamFee)
- C.8.01.01 XartIAFactory (события Deploy)
|↘ ПРЕДОСТАВЛЯЕТ:
- YAML-правила для Prometheus Alertmanager
|Реализация: YAML-документ. Каждое правило — PromQL-выражение по метрикам из O.1.01.04.
|Примечания: НОВОЕ 13-я ИТЕРАЦИЯ (ревизия 2): добавлены правила treasury_balance_anomaly, treasury_balance_decrease, sellTeamFee_changed, sellTeamFee_out_of_bounds. treasury_balance_decrease — critical: treasury только растёт, уменьшение = атака или баг. sellTeamFee_changed — info для отслеживания governance-изменений.
РАНЕЕ 12-я ИТЕРАЦИЯ: добавлены правила NotInitialized_revert, MaxCurveForExceeded_series, PoolPrice_floor_triggered, Allowance_reset_failed, USDC_left_in_poolController, setPoolController_called.

|O.1.01.03|Operations|Monitoring|JSON|ops/monitoring/grafana.json|O.1.01.01|v.0.0.01|Draft|§16|
|Описание: Конфигурация Grafana. JSON-дашборды для метрик в реальном времени.

|Публичный API:
- Конфигурация мониторинга: алерты, дашборды, сбор метрик.
|↙ ПОТРЕБЛЯЕТ:
- O.1.01.01
|↘ ПРЕДОСТАВЛЯЕТ:
- наблюдаемость инвариантов и аномалий
|Реализация: JSON-файл, проверяется схемой и CI.

|O.1.01.04|Operations|Monitoring|YAML|ops/monitoring/prometheus.yaml|O.1.01.01|v.0.0.01|Draft|§16|
|Описание: Конфигурация Prometheus. Сбор метрик через RPC.

|Публичный API:
- Конфигурация мониторинга: алерты, дашборды, сбор метрик.
|↙ ПОТРЕБЛЯЕТ:
- O.1.01.01
|↘ ПРЕДОСТАВЛЯЕТ:
- наблюдаемость инвариантов и аномалий
|Реализация: YAML-конфигурация, применяется в CI/инфраструктуре.

|O.1.01.05|Operations|Monitoring|YAML|ops/monitoring/tenderly.yaml|O.1.01.01|v.0.0.01|Draft|§16.2|
|Описание: Tenderly alerts. Симуляции транзакций, real-time уведомления.

|Публичный API:
- Конфигурация мониторинга: алерты, дашборды, сбор метрик.
|↙ ПОТРЕБЛЯЕТ:
- O.1.01.01
|↘ ПРЕДОСТАВЛЯЕТ:
- наблюдаемость инвариантов и аномалий
|Реализация: YAML-конфигурация, применяется в CI/инфраструктуре.

|O.2.01.01|Operations|Indexer|TypeScript|ops/indexer/subgraph.ts|C.8.01.01, C.10.01.01|v.0.0.02|Draft|§16.1|
|Описание: Subgraph для The Graph. Индексирует Buy, BuyFromPool, SellToPool, Redeem, PoolPriceUpdated, PoolPriceInitialized, LevelChanged, CircuitBreakerTriggered, SellTeamFeeUpdated. Обновляет сущности Buy, Sell, Redeem, PoolPrice, Level, User, Treasury, SellTeamFeeUpdate.
|Публичный API:
- export function handleBuy(event: Buy): void
- export function handleBuyFromPool(event: BuyFromPool): void
- export function handleSellToPool(event: SellToPool): void
- export function handleRedeem(event: Redeem): void
- export function handlePoolPriceUpdated(event: PoolPriceUpdated): void
- export function handlePoolPriceInitialized(event: PoolPriceInitialized): void
- export function handleLevelChanged(event: LevelChanged): void
- export function handleCircuitBreakerTriggered(event: CircuitBreakerTriggered): void
- export function handleSellTeamFeeUpdated(event: SellTeamFeeUpdated): void          // НОВОЕ
|↙ ПОТРЕБЛЯЕТ:
- C.8.01.01 XartIAFactory (адреса, treasury())
- C.10.01.01 Events (схема событий: Buy, BuyFromPool, SellToPool, Redeem, PoolPriceUpdated, PoolPriceInitialized, LevelChanged, CircuitBreakerTriggered, SellTeamFeeUpdated)
- O.2.01.03 schema.graphql (сущности: Buy, Sell, Redeem, PoolPrice, Level, User, Treasury, SellTeamFeeUpdate, ProtocolStats)
- O.2.01.02 subgraph.yaml (mapping, eventHandlers)
|↘ ПРЕДОСТАВЛЯЕТ:
- Индексированные данные для GraphQL запросов
- Историю protocol revenue (Treasury)
- Историю governance-изменений sellTeamFee (SellTeamFeeUpdate)
|Реализация: AssemblyScript (The Graph).
handleBuy(event):
  (1) Создаёт сущность Buy.
  (2) Обновляет User.buys.
  (3) Если в одной транзакции есть BuyFromPool — не суммировать (см. R.2.01.04, «Двойная эмиссия при каскаде»).
handleBuyFromPool(event):
  (1) Создаёт сущность BuyFromPool.
  (2) Обновляет User.buys.
  (3) Используется как источник истины для полной суммы покупки (usdcIn = X_18).
handleSellToPool(event):
  (1) Создаёт сущность Sell.
  (2) Сохраняет sellTeamFee в поле Sell.sellTeamFee.
  (3) Обновляет сущность Treasury (баланс увеличился на sellTeamFee).
  (4) Обновляет User.sells.
handleRedeem(event):
  (1) Создаёт сущность Redeem.
  (2) Сохраняет sellTeamFee в поле Redeem.sellTeamFee.
  (3) Обновляет сущность Treasury (баланс увеличился на sellTeamFee).
  (4) Обновляет User.redeems.
handleSellTeamFeeUpdated(event):
  (1) Создаёт сущность SellTeamFeeUpdate { id, oldFee, newFee, timestamp, block }.
  (2) Обновляет сущность ProtocolStats: currentSellTeamFee = event.newFee, lastUpdatedAt, lastUpdatedBlock.
      // ИСПРАВЛЕНО 13-я ИТЕРАЦИЯ (ревизия 5): ранее «обновляет глобальную переменную currentSellTeamFee»
      // без указания, где она хранится. Теперь явно: ProtocolStats в O.2.01.03.
|Примечания: ИСПРАВЛЕНО 13-я ИТЕРАЦИЯ (ревизия 4): добавлен handleSellTeamFeeUpdated — событие SellTeamFeeUpdated появилось в C.10.01.01 в 13-й итерации, но индексатор его не обрабатывал. Ранее в публичном API subgraph.ts не было этого handler'а, в ↙ ПОТРЕБЛЯЕТ не было C.10.01.01 Events.SellTeamFeeUpdated, в сущностях не было SellTeamFeeUpdate. Версия поднята с v.0.0.01 до v.0.0.02.
Также уточнено: handleSellToPool и handleRedeem обновляют Treasury (интеграция с O.2.01.03 schema.graphql → type Treasury).
РАНЕЕ: обработка Buy/BuyFromPool — с учётом «двойной эмиссии при каскаде» (см. R.2.01.04).

|O.2.01.02|Operations|Indexer|YAML|ops/indexer/subgraph.yaml|O.2.01.01|v.0.0.02|Draft|§16.1|
|Описание: Конфигурация subgraph. Сеть, адреса, начальный блок, mapping, eventHandlers.
Публичный API (структура):
- specVersion
- schema: file: ./schema.graphql
- dataSources:
  - kind: ethereum/contract
    name: CurveController
    network: polygon | amoy
    source: { address, abi, startBlock }
    mapping:
      eventHandlers:
        - event: Buy(...)
          handler: handleBuy
        - event: Redeem(...)
          handler: handleRedeem
        - event: SellTeamFeeUpdated(uint256,uint256)   // НОВОЕ 13-я ИТЕРАЦИЯ (ревизия 4)
          handler: handleSellTeamFeeUpdated
        - event: PoolPriceUpdated(uint256,uint256)
          handler: handlePoolPriceUpdated
        - event: LevelChanged(uint256,uint256)
          handler: handleLevelChanged
        - event: CircuitBreakerTriggered(uint256,uint256)
          handler: handleCircuitBreakerTriggered
  - kind: ethereum/contract
    name: PoolController
    network: polygon | amoy
    source: { address, abi, startBlock }
    mapping:
      eventHandlers:
        - event: BuyFromPool(...)
          handler: handleBuyFromPool
        - event: SellToPool(...)
          handler: handleSellToPool
        - event: PoolPriceUpdated(uint256,uint256)
          handler: handlePoolPriceUpdated
  - kind: ethereum/contract
    name: PoolState
    network: polygon | amoy
    source: { address, abi, startBlock }
    mapping:
      eventHandlers:
        - event: PoolPriceInitialized(uint256)
          handler: handlePoolPriceInitialized
|Публичный API:
- Конфигурация subgraph: сеть, адреса, события, mapping.
|↙ ПОТРЕБЛЯЕТ:
- O.2.01.01 subgraph.ts (mapping handlers)
- O.2.01.03 schema.graphql (сущности)
- C.8.01.01 XartIAFactory (адреса: curveController, poolController, poolState)
- C.10.01.01 Events (схема событий)
|↘ ПРЕДОСТАВЛЯЕТ:
- Конфигурацию для graph-cli
|Реализация: YAML-документ.
|Примечания: ИСПРАВЛЕНО 13-я ИТЕРАЦИЯ (ревизия 4): добавлен eventHandler для SellTeamFeeUpdated в dataSource CurveController. Ранее событие SellTeamFeeUpdated существовало в C.10.01.01, но не было в subgraph.yaml — индексатор не мог его обрабатывать. Версия поднята с v.0.0.01 до v.0.0.02.
Примечание: PoolPriceUpdated эмитится и CurveController'ом (через PoolState.setPoolPrice), и PoolController'ом (через PoolState.setPoolPrice). В dataSource CurveController и PoolController — оба handler'а, что даёт корректную индексацию независимо от того, кто вызвал обновление цены.

|O.2.01.03|Operations|Indexer|GraphQL|ops/indexer/schema.graphql|—|v.0.0.03|Draft|§16.1|
|Описание: GraphQL schema. Сущности: Buy, BuyFromPool, Sell, Redeem, PoolPrice, Level, User, Treasury, SellTeamFeeUpdate, ProtocolStats.
|Публичный API:
- type Buy { id, buyer, usdcIn, tokensOut, fee, teamTokens, newScurve, newReserve, newLevel, timestamp, block }
- type BuyFromPool { id, buyer, usdcIn, tokensFromPool, tokensFromCurve, fee, newPool, newPoolPrice, newScurve, newReserve, timestamp, block }
- type Sell { id, seller, tokensIn, usdcOut, fee, sellTeamFee, newPool, newPoolPrice, newReserve, timestamp, block }
- type Redeem { id, seller, tokensIn, usdcOut, fee, earlyFee, sellTeamFee, newScurve, newReserve, newLevel, timestamp, block }
- type PoolPrice { id, price, timestamp, block }
- type Level { id, level, timestamp, block }
- type User { id, buys, sells, redeems, balance }
- type Treasury { id, balance, totalCollected, lastUpdatedAt, lastUpdatedBlock }
- type SellTeamFeeUpdate { id, oldFee, newFee, timestamp, block }
- type ProtocolStats { id, currentSellTeamFee, currentBuyFee, currentRedeemFee, roundTripCost, lastUpdatedAt, lastUpdatedBlock }   // НОВОЕ
|↙ ПОТРЕБЛЯЕТ: — (нет зависимостей)
- O.2.01.01 subgraph.ts (mapping использует сущности)
|↘ ПРЕДОСТАВЛЯЕТ:
- GraphQL API для frontend и аналитики
- Историю protocol revenue (Treasury)
- Историю governance-изменений sellTeamFee (SellTeamFeeUpdate)
- Текущие значения параметров для frontend (ProtocolStats)
|Реализация: The Graph schema DSL.
type Sell {
  id: ID!
  seller: Bytes!
  tokensIn: BigInt!
  usdcOut: BigInt!
  fee: BigInt!
  sellTeamFee: BigInt!
  newPool: BigInt!
  newPoolPrice: BigInt!
  newReserve: BigInt!
  timestamp: BigInt!
  block: BigInt!
}
type Redeem {
  id: ID!
  seller: Bytes!
  tokensIn: BigInt!
  usdcOut: BigInt!
  fee: BigInt!
  earlyFee: BigInt!
  sellTeamFee: BigInt!
  newScurve: BigInt!
  newReserve: BigInt!
  newLevel: BigInt!
  timestamp: BigInt!
  block: BigInt!
}
type Treasury {
  id: ID!                     // всегда "treasury"
  balance: BigInt!            // текущий накопленный USDC (6-dec)
  totalCollected: BigInt!     // всего собрано с момента начала индексации
  lastUpdatedAt: BigInt!
  lastUpdatedBlock: BigInt!
}
type SellTeamFeeUpdate {
  id: ID!
  oldFee: BigInt!
  newFee: BigInt!
  timestamp: BigInt!
  block: BigInt!
}
type ProtocolStats {
  id: ID!                     // всегда "stats"
  currentSellTeamFee: BigInt! // текущая ставка (bp)
  currentBuyFee: BigInt!      // текущая ставка (bp)
  currentRedeemFee: BigInt!   // текущая ставка (bp)
  roundTripCost: BigInt!      // buyFee + redeemFee + sellTeamFee (bp)
  lastUpdatedAt: BigInt!
  lastUpdatedBlock: BigInt!
}
|Примечания: ИСПРАВЛЕНО 13-я ИТЕРАЦИЯ (ревизия 5): добавлена сущность ProtocolStats для хранения текущих значений sellTeamFee, buyFee, redeemFee и roundTripCost. Ранее subgraph.ts в handleSellTeamFeeUpdated «обновлял глобальную переменную currentSellTeamFee», но в схеме не было сущности, где она хранится. Frontend не мог получить текущую ставку без сканирования всей истории SellTeamFeeUpdate. Версия поднята с v.0.0.02 до v.0.0.03.
ЦИКЛ УСТРАНЁН: schema.graphql не зависит от subgraph.ts. Только subgraph.ts зависит от schema.graphql. Индексы по полям для быстрых запросов.

|O.2.01.04|Operations|Indexer|JSON|ops/indexer/networks.json|O.2.01.01|v.0.0.01|Draft|§16.1|
|Описание: Мультисетевая конфигурация subgraph. Polygon, Amoy.

|Публичный API:
- Конфигурация subgraph: сеть, адреса, события, mapping.
|↙ ПОТРЕБЛЯЕТ:
- O.2.01.01
|↘ ПРЕДОСТАВЛЯЕТ:
- индексирование событий для дашбордов
|Реализация: JSON-файл, проверяется схемой и CI.

|O.3.01.01|Operations|Docs|Markdown|ops/runbook.md|—|v.0.0.01|Planned|§16.2|
|Описание: Runbook оператора. Ежедневные, еженедельные, ежемесячные задачи.

|Публичный API:
- Документ оператора: процедуры, метрики, пороги.
|↙ ПОТРЕБЛЯЕТ:
- — (нет зависимостей)
|↘ ПРЕДОСТАВЛЯЕТ:
- процедуры для оператора
|Реализация: Markdown-документ.

|O.3.01.02|Operations|Docs|Markdown|ops/incident-response.md|O.3.01.01|v.0.0.01|Planned|§16.2|
|Описание: Incident Response Plan. Классификация, эскалация, коммуникация.

|Публичный API:
- Документ оператора: процедуры, метрики, пороги.
|↙ ПОТРЕБЛЯЕТ:
- O.3.01.01
|↘ ПРЕДОСТАВЛЯЕТ:
- процедуры для оператора
|Реализация: Markdown-документ.

|O.3.01.03|Operations|Docs|Markdown|ops/upgrade-guide.md|O.3.01.01|v.0.0.01|Planned|§16.2|
|Описание: Руководство по апгрейду. Процедура, тестирование, миграция.

|Публичный API:
- Документ оператора: процедуры, метрики, пороги.
|↙ ПОТРЕБЛЯЕТ:
- O.3.01.01
|↘ ПРЕДОСТАВЛЯЕТ:
- процедуры для оператора
|Реализация: Markdown-документ.

|O.3.01.04|Operations|Docs|Markdown|ops/emergency-procedures.md|O.3.01.02|v.0.0.01|Planned|§16.2|
|Описание: Экстренные процедуры. Эксплойт, падение резерва, Circuit Breaker.

|Публичный API:
- Документ оператора: процедуры, метрики, пороги.
|↙ ПОТРЕБЛЯЕТ:
- O.3.01.02
|↘ ПРЕДОСТАВЛЯЕТ:
- процедуры для оператора
|Реализация: Markdown-документ.

|O.3.01.05|Operations|Docs|Markdown|ops/backup.md|—|v.0.0.01|Planned|§16.2|
|Описание: Процедура бэкапа. Ключи, конфиги, состояние контрактов.

|Публичный API:
- Документ оператора: процедуры, метрики, пороги.
|↙ ПОТРЕБЛЯЕТ:
- — (нет зависимостей)
|↘ ПРЕДОСТАВЛЯЕТ:
- процедуры для оператора
|Реализация: Markdown-документ.

|O.4.01.01|Operations|Metrics|Markdown|ops/metrics.md|—|v.0.0.02|Planned|§16.3|
|Описание: Описание метрик. Формулы, нормы, пороги. Покрытие резерва, ликвидность, poolPrice, protocol revenue.
Содержание:
Раздел «Метрики резерва»:
- reserve (18-dec): ReserveManager.reserve(). Фактический баланс USDC × 1e12.
- curveBacking (18-dec): R(S_curve). Минимально необходимый резерв.
- freeReserve (18-dec): reserve − curveBacking. Буфер для sellToPool.
- reserve_coverage_ratio: reserve / curveBacking. Норма ≥ 1.0. Circuit Breaker срабатывает при freeReserve / reserve < threshold.
Раздел «Метрики пула»:
- pool (18-dec): PoolState.pool(). Токенов XartIA в пуле.
- poolPrice (18-dec): PoolState.poolPrice(). Норма: [P(S)/(1+MAX_GAP), P(S)*(1+MAX_GAP)].
- pool_price_deviation: |poolPrice − P(S)| / P(S). Норма ≤ MAX_GAP = 10%.
Раздел «Метрики кривой»:
- S_curve (18-dec): ReserveManager.S_curve(). Текущее предложение.
- current_level (uint8): Levels.getLevel(S_curve()).
- totalSupply (18-dec): XartIAToken.totalSupply(). Инвариант: totalSupply == S_curve.
Раздел «Метрики protocol revenue» (НОВОЕ 13-я ИТЕРАЦИЯ (ревизия 2)):
- treasury_balance (6-dec): IERC20(usdc).balanceOf(treasury). Накопленный sellTeamFee в USDC. Норма: монотонно неубывающая (treasury не тратит).
  Пороги алертов: см. O.1.01.02 → treasury_balance_anomaly, treasury_balance_decrease.
- sellTeamFee_current (bp): CurveController.sellTeamFee(). Текущая ставка. Норма: [0, 50] bp. Default: 10 bp (0.1%).
- sellTeamFee_30d_avg (bp): средневзвешенное значение sellTeamFee за 30 дней. Для аналитики governance-активности.
- sellTeamFee_total_collected_30d (6-dec): сумма SellTeamFee из событий Redeem и SellToPool за 30 дней.
  Полезно для оценки операционного дохода команды.
- teamTokens_minted_30d (18-dec): сумма TeamFee-событий за 30 дней. Сравнение с sellTeamFee_total_collected_30d показывает баланс между токенной и USDC-частями дохода.
Раздел «Метрики пользователя» (НОВОЕ):
- round_trip_cost (bp): buyFee + redeemFee + sellTeamFee. Норма: 110 bp (1.1%) без earlySellFee.
  Отображается в dApp UI (см. W.1.01.02 → getRoundTripCost()).
- early_sell_penalty_active (bool): block.timestamp < lastBuyTime[user] + earlySellPeriod.
- effective_minimal_x6 (6-dec): CurveController.effectiveMinimalX6(). Минимальная покупка.
Раздел «Метрики газа»:
- gas_buy_curve: ≤ 250 000.
- gas_redeem_curve: ≤ 250 000.
- gas_buy_pool: ≤ 200 000.
- gas_sell_pool: ≤ 200 000.
- gas_level_transition: ≤ 300 000.
Раздел «Метрики инвариантов»:
- reserve_ge_curveBacking (bool): должен быть true всегда.
- totalSupply_eq_S_curve (bool): должен быть true всегда.
- poolBalance_eq_pool (bool): IXartIAToken(token).balanceOf(poolController) == poolState.pool().
- usdcCustody (bool): PrecisionLib.toWei(balanceOf(reserveManager)) == reserve().
- poolController_usdc_zero (bool): IERC20(usdc).balanceOf(poolController) == 0.                          // НОВОЕ
  Инвариант после sweep-dust. Нарушение = баг или атака.
|Публичный API:
- Документ оператора: процедуры, метрики, пороги.
|↙ ПОТРЕБЛЯЕТ:
- C.4.01.01 ReserveManager (reserve, freeReserve, curveBacking, S_curve)
- C.3.01.01 CurveController (buyFee, redeemFee, sellTeamFee, treasury, effectiveMinimalX6)
- C.3.01.02 PoolController (poolPrice, pool)
- C.2.01.09 Levels (getLevel)
- C.6.01.01 CircuitBreaker (active, threshold)
- C.1.01.01 XartIAToken (totalSupply)
- C.10.01.01 Events (TeamFee, Redeem, SellToPool, SellTeamFeeUpdated)
- O.1.01.04 prometheus.yaml (источник данных)
|↘ ПРЕДОСТАВЛЯЕТ:
- Описание метрик для операторов и аналитиков
|Реализация: Markdown-документ.
|Примечания: НОВОЕ 13-я ИТЕРАЦИЯ (ревизия 2): добавлен раздел «Метрики protocol revenue» (treasury_balance, sellTeamFee_current, sellTeamFee_30d_avg, sellTeamFee_total_collected_30d, teamTokens_minted_30d), «Метрики пользователя» (round_trip_cost, early_sell_penalty_active, effective_minimal_x6). Расширен раздел «Метрики инвариантов»: poolController_usdc_zero — новый инвариант после sweep-dust (11b).

|R.1.01.01|Registry|Specification|Markdown|docs/spec/xartia_4.2.md|—|v.0.0.06|Planned|§0|
|Описание: Спецификация XartIA 4.2. Математика, архитектура, механика, инварианты.
Подраздел «Семантика maxBalance»: (без изменений с 7-й итерации)
- maxBalance_i — максимальный баланс одного пользователя в момент, когда S_curve в границах уровня i.
- Проверяется только maxBalance финального уровня (level_new = Levels.getLevel(newS)).
- Пример: maxBalance_1 = 50000, maxBalance_2 = 250000. Покупка до 60000 токенов при переходе 1→2 проходит.
Подраздел «Область применения earlySellFee»:
- earlySellFee применяется ТОЛЬКО в redeemFromCurve.
- sellToPool применяет redeemFee + sellTeamFee, но НЕ earlySellFee.
- Обоснование: sellToPool использует poolPrice, ограниченный симметричным коридором [P(S)/(1+MAX_GAP), P(S)*(1+MAX_GAP)].
- Следствие: пользователь может купить на кривой и продать в пул без earlySellFee, но прибыль ограничена MAX_GAP и торговыми издержками.
Подраздел «Симметричный коридор poolPrice»:
- poolPrice всегда в [P(S)/(1+MAX_GAP), P(S)*(1+MAX_GAP)].
- Ceiling enforced в redeemFromCurve и sellToPool.
- Floor enforced в buyFromCurve и buyFromCurveFor при росте S_curve.
- redeemFromCurve применяет и ceiling, и floor (defensive).
- Арбитраж ограничен MAX_GAP = 10% в обе стороны.
Подраздел «Гейт инициализации»:
- До initializePoolPrice poolState.poolPrice() == 0.
- Все торговые функции (buyFromCurve, redeemFromCurve, buyFromCurveFor, buyFromPool, sellToPool) ревертят с NotInitialized.
- Factory.initializePoolPrice требует S_curve() == 0.
Подраздел «buyFromCurveFor: pull-модель и immutable poolController»:
- buyFromCurveFor САМ тянет USDC через safeTransferFrom(msg.sender, reserveManager, X_6). Caller должен approve.
- Защита: require(msg.sender == poolController), immutable.
- X_18 нормализуется: X_18 = toWei(toUSDC(X_18)) перед расчётом ΔS.
- Лимит: X_18 <= freeReserve * MAX_CURVE_FOR_PCT / BASIS_POINTS (20%). Применяется только при S_curve() > 0 (genesis-исключение).
Подраздел «Двойная эмиссия при каскаде buyFromPool → buyFromCurveFor» (ВОССТАНОВЛЕНО 13-я ИТЕРАЦИЯ (ревизия 2)):
При вызове PoolController.buyFromPool с недостаточным пулом:
  1. PoolController переводит USDC X_6 от пользователя на свой баланс (шаг 11).
  2. fee_18 → reserveManager (шаг 11a). Fee уходит в резерв немедленно, не застревает в PoolController.
  3. Если tokens_from_pool > 0: X_pool_used_6 → reserveManager (шаг 13); tokens_from_pool → пользователю.
  4. Если X_remaining_18 > 0: PoolController делает forceApprove(curveController, X_remaining_6) и вызывает CurveController.buyFromCurveFor (шаг 14). CurveController сам тянет X_remaining_6 через safeTransferFrom (pull-модель).
  5. CurveController эмитит Buy(buyer, normalized X_18, ΔS_curve, fee=0, teamTokens, newS, ...).
  6. PoolController сбрасывает allowance в 0 (шаг 14). Sweep-dust: остаток USDC (≤ 2 wei-6) → reserveManager (шаг 14b).
  7. PoolController эмитит BuyFromPool(buyer, X_18, tokens_from_pool, tokens_from_curve, fee_18, ...).
ВАЖНО для индексатора:
  - usdcIn в Buy (при каскаде) = toWei(toUSDC(X_remaining_18)) — нормализованное значение. Может отличаться от «сырого» X_remaining_18 на пыль < 1e-6 USDC.
  - usdcIn в BuyFromPool = X_18 (полная сумма).
  - Соотношение: X_18 = fee_18 + X_pool_used_18 + X_remaining_18.
  - BuyFromPool — источник истины для полной картины покупки: полная сумма X_18, полная fee_18.
  - Buy с fee=0 в контексте каскада — промежуточное событие. НЕ суммировать с BuyFromPool.
  - При индексации: если в одной транзакции есть и Buy, и BuyFromPool, использовать только BuyFromPool для агрегатов (объём, fee). Buy в этом случае используется только для получения ΔS_curve (tokensFromCurve).
  - Sweep-dust (шаг 11b) не эмитит событие: остаток USDC уходит в reserveManager молча.
    Индексатор, отслеживающий reserve, увидит рост без соответствующего Buy/BuyFromPool — это нормально,
    пыль < 2 wei-6 USDC.
    // ДОБАВЛЕНО 13-я ИТЕРАЦИЯ (ревизия 5)
Подраздел «Доход команды» (НОВОЕ 13-я ИТЕРАЦИЯ):
- Команда получает доход из ДВУХ источников:
  1. teamTokens — минтинг 0.5% от ΔS на каждой покупке (buyFromCurve, buyFromCurveFor). Уходит в Vesting (immutable beneficiary = safe). Cliff 365 дней, duration 730 дней. Не является fee: пользователь платит за ΔS, получает ΔS − teamTokens.
  2. sellTeamFee — USDC-комиссия 0.1% (default) с gross amount на каждой продаже (redeemFromCurve, sellToPool). Уходит в immutable treasury через reserveManager.pay.
- Параметры:
  - TEAM_PERCENT = 50 (0.5% от ΔS). Константа, не governance-параметр.
  - sellTeamFee ∈ [0, 50] bp. Governance-параметр (PARAM_SELL_TEAM_FEE). Default = 10 bp (0.1%).
- Обоснование sellTeamFee: доход команды структурно привязан к росту (teamTokens минтится только на покупках). В медвежий рынок покупок мало — добавление sellTeamFee сглаживает просадку. 0.1% достаточно для операционного дохода, но не отпугивает объём.
- treasury — immutable, задаётся в Factory.deploy. Обычно = safe, но может быть отдельный адрес для разделения governance и operations.
Подраздел «Распределение комиссий с продаж» (НОВОЕ 13-я ИТЕРАЦИЯ):
- При redeemFromCurve gross amount_18 делится:
  - redeemFee (0.5%) → остаётся в reserve (увеличивает freeReserve).
  - earlySellFee (0–5%) → остаётся в reserve, только если в earlySellPeriod.
  - sellTeamFee (0–0.5%) → treasury (USDC).
  - user_amount = amount_18 − redeemFee − earlySellFee − sellTeamFee.
- При sellToPool gross amount_gross_18 делится:
  - redeemFee (0.5%) → остаётся в reserve.
  - sellTeamFee (0–0.5%) → treasury.
  - user_amount = amount_gross − redeemFee − sellTeamFee.
- Инвариант reserve >= R(S_curve) держится: reserve уменьшается на (amount − redeemFee − earlyFee) в redeem и на (amount_gross − redeemFee) в sellToPool — то же самое, что без sellTeamFee. R(S) меняется соответственно.
Подраздел «Timelock»:
- TIMELOCK_DELAY = 7 days.
Подраздел «Round-trip cost» (НОВОЕ 13-я ИТЕРАЦИЯ):
- Базовый buy + immediate redeem: buyFee (0.5%) + redeemFee (0.5%) + sellTeamFee (0.1%) = 1.1% (без earlySellFee).
- Buy + sellToPool: buyFee (0.5%) + redeemFee (0.5%) + sellTeamFee (0.1%) = 1.1% (earlySellFee не применяется).
- С активным earlySellFee (например 5% в первые 30 дней): до 6.1% round-trip.
|Публичный API:
- Элемент реестра/документации; публичного API нет.
|↙ ПОТРЕБЛЯЕТ: — (нет зависимостей)
|↘ ПРЕДОСТАВЛЯЕТ:
- Формальную спецификацию
|Реализация: Markdown-документ.
|Примечания: ИСПРАВЛЕНО 13-я ИТЕРАЦИЯ (ревизия 3): версия поднята с v.0.0.04 до v.0.0.05 — синхронизация с фактическим содержанием после реставрации раздела «Двойная эмиссия при каскаде» (ревизия 2) и добавления подразделов «Доход команды», «Распределение комиссий с продаж», «Round-trip cost».
ИСПРАВЛЕНО 13-я ИТЕРАЦИЯ (ревизия 2): восстановлено полное пошаговое описание подраздела «Двойная эмиссия при каскаде buyFromPool → buyFromCurveFor» (7 шагов + блок «ВАЖНО для индексатора»). В предыдущей ревизии 13-й итерации описание было сжато до 4 буллетов — потеряна детализация порядка операций и семантика sweep-dust.
НОВОЕ 13-я ИТЕРАЦИЯ: добавлены подразделы «Доход команды», «Распределение комиссий с продаж», «Round-trip cost». Обновлён подраздел «Область применения earlySellFee».
ИСПРАВЛЕНО 13-я ИТЕРАЦИЯ (ревизия 5): в блок «ВАЖНО для индексатора» подраздела «Двойная эмиссия при каскаде» добавлен пункт про sweep-dust. Ранее блок содержал 6 пунктов, но не содержал важного для индексатора предупреждения о том, что sweep-dust не эмитит событие. В R.2.01.04 это предупреждение есть, в R.1.01.01 — отсутствовало. Индексатор, читающий только R.1.01.01, не понимал бы, почему reserve растёт без события. Версия поднята с v.0.0.05 до v.0.0.06.

|R.1.01.02|Registry|Specification|Markdown|docs/spec/tz.md|R.1.01.01|v.0.0.01|Planned|§1–21|
|Описание: Техническое задание. Требования к контрактам, тестам, деплою.

|Публичный API:
- Элемент реестра/документации; публичного API нет.
|↙ ПОТРЕБЛЯЕТ:
- R.1.01.01
|↘ ПРЕДОСТАВЛЯЕТ:
- элемент проекта
|Реализация: Markdown-документ.

|R.1.01.03|Specification|Doc|Markdown|XartIA 5.0.md|R.1.01.01|v.0.0.01|Draft|—|
|Описание: XartIA 5.0 — стабильная учётная единица: пол 1.00 в USD + NAV (P = max(1.00, R/S)), тиры резерва T1/T2/T3, казна 3-из-5 с ротацией 180 дней, конвертация выручки Шлюза 60/30/10, стресс-тесты. Заменяет bonding curve как цель.
|Публичный API:
- Документ-спецификация; публичного API нет.
|↙ ПОТРЕБЛЯЕТ: R.1.01.01 (4.2, архив), L.1.01.01 (whitepaper).
|↘ ПРЕДОСТАВЛЯЕТ: основание для контрактов казны и привязки к Шлюзу.
|Реализация: Markdown; экономическая модель и политика.
|R.2.01.01|Registry|Architecture|Markdown|docs/tech/architecture.md|R.1.01.01|v.0.0.01|Planned|§2|
|Описание: Описание архитектуры. Схема взаимодействия контрактов, потоки данных, роли.

|Публичный API:
- Элемент реестра/документации; публичного API нет.
|↙ ПОТРЕБЛЯЕТ:
- R.1.01.01
|↘ ПРЕДОСТАВЛЯЕТ:
- элемент проекта
|Реализация: Markdown-документ.

|R.2.01.02|Registry|API|Markdown|docs/tech/api.md|C.8.01.01|v.0.0.01|Planned|§2|
|Описание: API документация. Публичные функции, события, ошибки.

|Публичный API:
- Элемент реестра/документации; публичного API нет.
|↙ ПОТРЕБЛЯЕТ:
- C.8.01.01
|↘ ПРЕДОСТАВЛЯЕТ:
- элемент проекта
|Реализация: Markdown-документ.

|R.2.01.03|Registry|Architecture|Markdown|docs/tech/contracts.md|R.2.01.01|v.0.0.01|Planned|§15.1|
|Описание: Документация контрактов. Роль, функции, инварианты каждого.

|Публичный API:
- Элемент реестра/документации; публичного API нет.
|↙ ПОТРЕБЛЯЕТ:
- R.2.01.01
|↘ ПРЕДОСТАВЛЯЕТ:
- элемент проекта
|Реализация: Markdown-документ.

|R.2.01.04|Registry|Architecture|Markdown|docs/tech/events.md|C.10.01.01|v.0.0.04|Planned|§15.1|
|Описание: Документация событий. Параметры, примеры для индексации, семантика sellTeamFee и usdcIn.
Содержание:
- Buy(buyer, usdcIn, tokensOut, fee, teamTokens, newScurve, newReserve, newLevel) — buyFromCurve и buyFromCurveFor.
- BuyFromPool(buyer, usdcIn, tokensFromPool, tokensFromCurve, fee, newPool, newPoolPrice, newScurve, newReserve) — buyFromPool.
- SellToPool(seller, tokensIn, usdcOut, fee, sellTeamFee, newPool, newPoolPrice, newReserve) — sellToPool.
- Redeem(seller, tokensIn, usdcOut, fee, earlyFee, sellTeamFee, newScurve, newReserve, newLevel) — redeemFromCurve.
Раздел «Семантика полей SellToPool и Redeem» (НОВОЕ 13-я ИТЕРАЦИЯ):
- usdcOut — что получил пользователь (net amount): amount_gross − fee − (earlyFee) − sellTeamFee.
- fee — redeemFee (0.5% по умолчанию). Остаётся в reserve (увеличивает freeReserve). Не уходит наружу.
- earlyFee — earlySellFee (только Redeem, 0 если не в earlySellPeriod). Остаётся в reserve.
- sellTeamFee — часть gross amount, переводимая в treasury (immutable адрес). Не остаётся в reserve.
- Соотношение (Redeem): amount_18 = fee + earlyFee + sellTeamFee + usdcOut.
- Соотношение (SellToPool): amount_gross_18 = fee + sellTeamFee + usdcOut.
- Индексатору: для агрегатов объёма использовать usdcOut + fee + earlyFee + sellTeamFee (или amount_18/amount_gross_18 из самого трейса). Для доходов протокола: fee + earlyFee → freeReserve; sellTeamFee → treasury.
Раздел «Единая семантика minP»:
- minimalPurchase — минимальная ЭФФЕКТИВНАЯ покупка (после удержания buyFee), в 6-dec USDC.
- effectiveMinimalX6() = ceil(minimalPurchase * BASIS_POINTS / (BASIS_POINTS − buyFee)).
- Пользователь должен заплатить X_6 >= effectiveMinimalX6() при buyFromCurve или buyFromPool.
- Пример: minimalPurchase = 1e6 (1 USDC), buyFee = 50 (0.5%) → effectiveMinimalX6 = 1 005 026 (1.005026 USDC).
- buyFromCurveFor не проверяет minP — предполагается, что PoolController уже проверил X_6 >= effectiveMinimalX6().
Раздел «Нормализация X_18 в Buy при каскаде»:
- В buyFromCurveFor X_18 нормализуется: X_18 = toWei(toUSDC(X_18)).
- Причина: X_18 от PoolController может быть не кратен 1e12. Без нормализации возможен revert ReserveInvariantViolation.
- Следствие для индексатора: Buy.usdcIn при каскаде — нормализованное значение. Может отличаться от X_remaining_18 на пыль < 1e-6 USDC.
- BuyFromPool.usdcIn (X_18) — источник истины для полной суммы.
Раздел «Двойная эмиссия при каскаде buyFromPool → buyFromCurveFor» (ВОССТАНОВЛЕНО 13-я ИТЕРАЦИЯ (ревизия 2)):
При вызове PoolController.buyFromPool с недостаточным пулом:
  1. PoolController переводит USDC X_6 от пользователя на свой баланс.
  2. fee_18 → reserveManager (шаг 11a). Fee уходит в резерв немедленно.
  3. Если tokens_from_pool > 0: X_pool_used_18 → reserveManager (шаг 13); tokens_from_pool → пользователю.
  4. Если X_remaining_18 > 0: forceApprove(curveController, X_remaining_6); CurveController.buyFromCurveFor сам тянет USDC через safeTransferFrom (шаг 14).
  5. CurveController эмитит Buy(buyer, normalized X_18, ΔS_curve, fee=0, teamTokens, newS, ...).
  6. PoolController сбрасывает allowance в 0. Sweep-dust: остаток USDC (≤ 2 wei-6) → reserveManager (шаг 14b).
  7. PoolController эмитит BuyFromPool(buyer, X_18, tokens_from_pool, tokens_from_curve, fee_18, ...).
ВАЖНО для индексатора:
  - usdcIn в Buy (при каскаде) = toWei(toUSDC(X_remaining_18)), НЕ «сырое» X_remaining_18.
  - usdcIn в BuyFromPool = X_18 (полная сумма).
  - Соотношение: X_18 = fee_18 + X_pool_used_18 + X_remaining_18.
  - BuyFromPool — источник истины для полной картины покупки: полная сумма X_18, полная fee_18.
  - Buy с fee=0 в контексте каскада — промежуточное событие. НЕ суммировать с BuyFromPool.
  - При индексации: если в одной транзакции есть и Buy, и BuyFromPool, использовать только BuyFromPool для агрегатов (объём, fee). Buy в этом случае используется только для получения ΔS_curve (tokensFromCurve).
  - Sweep-dust (шаг 11b) не эмитит событие: остаток USDC уходит в reserveManager молча. Индексатор, отслеживающий reserve, увидит рост без соответствующего Buy/BuyFromPool — это нормально, пыль < 2 wei-6 USDC.
Раздел «Обновление lastBuyTime»:
- lastBuyTime[user] обновляется при buyFromCurve, buyFromCurveFor и buyFromPool (шаг 14a).
- Единый учёт для earlySellFee — не зависит от того, куплено через кривую или пул.
- При каскаде lastBuyTime обновляется дважды в одной транзакции (в CurveController.buyFromCurveFor и PoolController.buyFromPool) — итоговое значение совпадает (block.timestamp).
Раздел «Событие Deploy»:
- Deploy(factory, token, curveController, poolController, safe, treasury, curveMathWrapper).
- treasury — адрес, куда идут sellTeamFee. Обычно = safe.
Раздел «Событие SellTeamFeeUpdated» (НОВОЕ 13-я ИТЕРАЦИЯ):
- SellTeamFeeUpdated(oldFee, newFee) — эмитится CurveController.setSellTeamFee при governance-изменении.
При sellTeamFee == 0 событие всё равно эмитит поле sellTeamFee = 0, но reserveManager.pay(treasury, ...) не вызывается. Индексатор должен обрабатывать sellTeamFee == 0 как отсутствие перевода.
|Публичный API:
- Элемент реестра/документации; публичного API нет.
|↙ ПОТРЕБЛЯЕТ:
- C.10.01.01 Events
- C.8.01.01 XartIAFactory (адреса)
- C.3.01.01 CurveController (семантика Buy при каскаде, нормализация X_18)
- C.3.01.02 PoolController (семантика BuyFromPool, sweep-dust, lastBuyTime)
|↘ ПРЕДОСТАВЛЯЕТ:
- Документацию событий для индексатора и frontend
|Реализация: Markdown-документ.
|Примечания: ИСПРАВЛЕНО 13-я ИТЕРАЦИЯ (ревизия 2): восстановлено полное описание раздела «Двойная эмиссия при каскаде» (7 шагов + «ВАЖНО для индексатора»). В предыдущей ревизии 13-й итерации раздел был сжат до одной строки — потеряна детализация порядка операций. Пользователь отметил потерю.
НОВОЕ 13-я ИТЕРАЦИЯ: добавлены разделы «Семантика полей SellToPool и Redeem», «Событие SellTeamFeeUpdated», «Событие Deploy» обновлён.

|R.2.01.05|Registry|Architecture|Markdown|docs/tech/deployment-guide.md|D.3.01.01|v.0.0.02|Planned|§14|
|Описание: Руководство по деплою. Пошаговая инструкция, конфигурация, верификация.
Раздел «Калибровка p0_initial_pool_price_6dec»:
- p0 должен быть в диапазоне [P(S_0) / (1+MAX_GAP), P(S_0) * (1+MAX_GAP)].
- Проверяется контрактом: Factory.initializePoolPrice → OutOfBounds при выходе за диапазон.
- Значение P(S_0) определяется калибровкой через E.3.01.01 tune_params.py.
- Если P(S_0) = 0.002 USDC и MAX_GAP = 10%: p0 ∈ [0.00182, 0.0022].
- Перед деплоем: запустить calibrate.py, обновить p0_initial_pool_price_6dec в config.
Раздел «Treasury в config» (НОВОЕ 13-я ИТЕРАЦИЯ (ревизия 3)):
- Поле `treasury` в `config/polygon.toml` и `config/amoy.toml`. Тип — address.
- Если treasury не задан (пустая строка) — `Deploy.s.sol` подставит safe (default). Рекомендуется явно указывать адрес, а не полагаться на default.
- Валидация в `Factory.deploy`:
  - `treasury != address(0)` — иначе InvalidAddress.
  - `treasury != address(this)` — иначе InvalidAddress (защита от деплоя на Factory).
  - `treasury.code.length > 0` — иначе InvalidAddress (защита от EOA; рекомендуется Safe Multisig).
- treasury получает `sellTeamFee` (USDC) с продаж (`redeemFromCurve`, `sellToPool`).
- treasury обычно совпадает с safe, но может быть отдельный адрес — например, отдельный Safe Multisig для операционных расходов, отделённый от governance-safe.
- Перед деплоем:
  - Убедиться, что treasury — это Safe Multisig 3/5 или аналогичный контракт с мультиподписью. EOA повышает риск компрометации ключа.
  - Убедиться, что treasury НЕ имеет delegate call и произвольных вызовов — treasury должен быть пассивным получателем USDC.
  - Убедиться, что treasury не имеет ролей ни в одном контракте протокола (нет PAUSER_ROLE, GOVERNANCE_ROLE и т.д.).
- После деплоя: проверить `factory.treasury() == config.treasury` и `curveController.treasury() == config.treasury`.
|Публичный API:
- Элемент реестра/документации; публичного API нет.
|↙ ПОТРЕБЛЯЕТ:
- D.3.01.01 README.md
- D.2.01.01 config/polygon.toml
- D.2.01.02 config/amoy.toml
- C.8.01.01 XartIAFactory (валидация treasury)
|↘ ПРЕДОСТАВЛЯЕТ:
- Пошаговое руководство для оператора деплоя
|Реализация: Markdown-документ.
|Примечания: НОВОЕ 13-я ИТЕРАЦИЯ (ревизия 3): раздел «Treasury в config» оформлен как структурированный раздел. Ранее был черновой заметкой из 2 строк после «Калибровка p0» — не имел заголовка и деталей. Добавлены: полная валидация, рекомендации по выбору treasury (Safe Multisig vs EOA), проверки перед и после деплоя.

|R.2.01.06|Registry|Architecture|Markdown|docs/tech/integration-guide.md|R.2.01.01|v.0.0.02|Planned|§15.2|
|Описание: Руководство по интеграции. dApp, кошелёк, биржа.
Раздел «sellTeamFee при интеграции» (НОВОЕ 13-я ИТЕРАЦИЯ (ревизия 3)):
- При интеграции с продажами (`redeemFromCurve`, `sellToPool`) учитывать, что user получает:
  - `redeemFromCurve`: `user_amount = amount_18 − redeemFee − earlySellFee − sellTeamFee`.
  - `sellToPool`: `user_amount = amount_gross − redeemFee − sellTeamFee` (earlySellFee не применяется).
  - НЕЛЬЗЯ рассчитывать `amount − redeemFee` без учёта sellTeamFee — иначе UI покажет пользователю завышенную сумму.
- treasury читается через `ICurveController.treasury()`. UI может отображать адрес treasury в разделе «Protocol revenue» или «Fees».
- `sellTeamFee` читается через `ICurveController.sellTeamFee()` (в basis points). Default = 10 bp (0.1%), bounds [0, 50].
- Для расчёта round-trip cost:
  - `buyFee = ICurveController.buyFee()` (bp).
  - `redeemFee = ICurveController.redeemFee()` (bp).
  - `sellTeamFee = ICurveController.sellTeamFee()` (bp).
  - `roundTripCost_bp = buyFee + redeemFee + sellTeamFee`. Базово 110 bp = 1.1% (без earlySellFee).
- Событие `SellTeamFeeUpdated(oldFee, newFee)` — для реактивного обновления UI при governance-изменении. Подписка через `curveController.on('SellTeamFeeUpdated', ...)`.
- Событие `Redeem(seller, tokensIn, usdcOut, fee, earlyFee, sellTeamFee, newScurve, newReserve, newLevel)` — содержит `sellTeamFee` для парсинга фактической суммы, ушедшей в treasury.
- Событие `SellToPool(seller, tokensIn, usdcOut, fee, sellTeamFee, newPool, newPoolPrice, newReserve)` — аналогично содержит `sellTeamFee`.
- Событие `Deploy(factory, token, curveController, poolController, safe, treasury, curveMathWrapper)` — содержит treasury для обнаружения при инициализации dApp.
- Адрес treasury неизменяем после деплоя. Если dApp кэширует treasury — кэш валиден на всё время жизни контракта.
- Для бирж: при расчёте объёмов учитывать, что `usdcOut` в событиях — уже net (после всех комиссий). Для восстановления gross использовать `usdcOut + fee + (earlyFee) + sellTeamFee`.
|Публичный API:
- Элемент реестра/документации; публичного API нет.
|↙ ПОТРЕБЛЯЕТ:
- R.2.01.01 architecture.md
- C.3.01.01 CurveController (sellTeamFee, treasury, события)
- C.3.01.02 PoolController (sellTeamFee в sellToPool)
- C.10.01.01 Events (SellTeamFeeUpdated, Redeem, SellToPool, Deploy)
|↘ ПРЕДОСТАВЛЯЕТ:
- Руководство для интеграторов (dApp, кошелёк, биржа)
|Реализация: Markdown-документ.
|Примечания: НОВОЕ 13-я ИТЕРАЦИЯ (ревизия 3): раздел «sellTeamFee при интеграции» оформлен как структурированный раздел. Ранее был черновой заметкой из 3 строк без заголовка. Добавлены: формулы расчёта user_amount для обеих sell-функций, рекомендации по UI, событие Deploy для обнаружения treasury, семантика usdcOut для бирж.

|R.2.01.07|Registry|Architecture|Markdown|docs/tech/api-reference.md|C.8.01.01|v.0.0.01|Planned|§2|
|Описание: API Reference. Автогенерируемая документация из NatSpec.

|Публичный API:
- Элемент реестра/документации; публичного API нет.
|↙ ПОТРЕБЛЯЕТ:
- C.8.01.01
|↘ ПРЕДОСТАВЛЯЕТ:
- элемент проекта
|Реализация: Markdown-документ.

|R.2.01.08|Registry|Architecture|Markdown|docs/tech/security-model.md|R.2.01.01|v.0.0.03|Planned|§12|
|Описание: Модель безопасности. Угрозы, митигации, роли, доступы, инварианты. Документирует dual-authority модель PoolState (Ownable + AccessControl), treasury security, симметричный коридор poolPrice, гейт инициализации и явные принятые риски.
Содержание (раздел «Dual-authority модель PoolState»):
- PoolState использует ДВЕ системы прав одновременно:
  1. Ownable — для initializePoolPrice() (одноразовая инициализация initialPrice).
  2. AccessControl — для setPool() и setPoolPrice() (регулярные обновления через роли POOL_WRITER_ROLE и PRICE_WRITER_ROLE).
- При деплое: owner = XartIAFactory, DEFAULT_ADMIN_ROLE = XartIAFactory (автоматически OpenZeppelin AccessControl).
- В finalize(): ownership передаётся на safe через transferOwnership; DEFAULT_ADMIN_ROLE у Factory отзывается через renounceRole.
- Итог после finalize: owner = safe (только для initializePoolPrice, но она уже вызвана); DEFAULT_ADMIN_ROLE = safe.
- Риск: если safe скомпрометирован, атакующий может через DEFAULT_ADMIN_ROLE выдать POOL_WRITER_ROLE/PRICE_WRITER_ROLE произвольным адресам, но не сможет повторно вызвать initializePoolPrice (AlreadyInitialized).
- Митигация: safe — Safe Multisig 3/5; доступ к нему ограничен.
- Аудит: обратить внимание на согласованность двух систем прав — нельзя ли обойти одну через другую.
Содержание (раздел «Treasury security») (НОВОЕ 13-я ИТЕРАЦИЯ (ревизия 3)):
- treasury — immutable адрес, задаётся при `Factory.deploy` (параметр `treasury`). Не может быть изменён после деплоя.
- treasury НЕ имеет ролей ни в одном контракте протокола: ни MINTER_ROLE, ни BURNER_ROLE, ни GOVERNANCE_ROLE, ни PAUSER_ROLE, ни DEFAULT_ADMIN_ROLE, ни POOL_CALLER_ROLE. Это пассивный получатель USDC.
- treasury НЕ имеет собственных функций в контрактах протокола. Только получает USDC через `ReserveManager.pay(treasury, amount_18)`.
- Поток USDC в treasury:
  - `redeemFromCurve`: `sellTeamFee = amount_18 * sellTeamFee / BASIS_POINTS` → `reserveManager.pay(treasury, sell_team_fee_18)`.
  - `sellToPool`: `sellTeamFee = amount_gross_18 * sellTeamFee / BASIS_POINTS` → `reserveManager.pay(treasury, sell_team_fee_18)`.
  - Прямой `safeTransfer` в treasury не используется — только через `ReserveManager.pay`, что требует CONTROLLER_ROLE у вызывающего.
- Свойство: treasury_balance монотонно неубывающий. Любое уменьшение = компрометация treasury или баг.
- Валидация в Factory.deploy:
  - `treasury != address(0)` — иначе InvalidAddress.
  - `treasury != address(this)` — иначе InvalidAddress.
  - `treasury.code.length > 0` — иначе InvalidAddress. Блокирует EOA (рекомендуется Safe Multisig).
- Риск: если treasury — EOA, компрометация ключа даёт атакующему доступ ко всему накопленному USDC. Митигация: treasury = Safe Multisig 3/5.
- Риск: если treasury — контракт с delegate call или произвольным вызовом, атакующий может вывести USDC через уязвимость treasury. Митигация: treasury = Safe Multisig без delegate call.
- Риск: если treasury — контракт, имеющий роли в протоколе, компрометация treasury расширяет вектор атаки. Митигация: проверка `hasRole(role, treasury) == false` для всех ролей; см. T.1.01.18.
- Мониторинг: alert `treasury_balance_decrease` (critical, O.1.01.02) — немедленный pause() при срабатывании.
- Аудит: проверить, что treasury не имеет ролей; проверить, что treasury = Safe Multisig; проверить, что treasury не имеет delegate call.
Содержание (раздел «Принятые риски»):
- Компрометация POOL_CALLER_ROLE: РИСК СНИЖЕН до низкого (11-я ИТЕРАЦИЯ).
  - buyFromCurveFor больше не использует POOL_CALLER_ROLE — защита через immutable poolController (require msg.sender == poolController).
  - buyFromCurveFor тянет USDC через safeTransferFrom(msg.sender, reserveManager, X_6) — минтинг без реального USDC невозможен.
  - MAX_CURVE_FOR_PCT = 2000 (20% freeReserve) ограничивает ущерб одного вызова.
  - Операционный мониторинг остаётся обязательным (см. R.2.01.09).
Содержание (раздел «Симметричный коридор poolPrice»):
- Нижняя граница (floor) enforced в buyFromCurve и buyFromCurveFor через _enforcePoolPriceFloor.
- Верхняя граница (ceiling) enforced в redeemFromCurve и sellToPool.
- redeemFromCurve применяет и ceiling, и floor (defensive).
- Следствие: арбитраж ограничен MAX_GAP = 10% в обе стороны.
Содержание (раздел «Гейт инициализации»):
- NotInitialized защищает окно между deploy и initializePoolPrice.
- Factory.initializePoolPrice требует S_curve() == 0 — исключает калибровку от неверного P(S).
Содержание (раздел «Timelock»):
- TIMELOCK_DELAY = 7 days. Обоснование: отраслевой стандарт для протоколов, управляющих средствами пользователей.
Содержание (раздел «Sweep-dust PoolController»):
- В PoolController.buyFromPool шаг (14b): sweep-dust — остаток USDC на балансе PoolController (≤ 2 wei-6 из-за floor-округления toUSDC) отправляется в reserveManager.
- Гарантирует инвариант balanceOf(PoolController) == 0 между транзакциями.
- Инвариант проверяется в O.4.01.01 (poolController_usdc_zero) и тестами T.1.01.04.
- Бонус: если кто-то случайно отправит USDC в PoolController, он уйдёт в резерв, а не зависнет.
|Публичный API:
- Элемент реестра/документации; публичного API нет.
|↙ ПОТРЕБЛЯЕТ:
- R.2.01.01 architecture.md
- C.2.01.12 PoolState (dual-authority модель)
- C.8.01.01 XartIAFactory (порядок передачи прав, валидация treasury)
- C.3.01.01 CurveController (симметричный коридор, sellTeamFee)
- C.3.01.02 PoolController (sellTeamFee, sweep-dust)
- C.2.01.03 Constants (MAX_CURVE_FOR_PCT, TIMELOCK_DELAY)
|↘ ПРЕДОСТАВЛЯЕТ:
- Модель безопасности для аудита
|Реализация: Markdown-документ.
|Примечания: НОВОЕ 13-я ИТЕРАЦИЯ (ревизия 3): раздел «Treasury security» оформлен как структурированный раздел. Ранее был черновой заметкой `**секция treasury security` внутри раздела «Dual-authority модель PoolState». Добавлены: потоки USDC в treasury, валидация в Factory.deploy, три вектора риска, митигации, ссылки на мониторинг и тесты. Также добавлен раздел «Sweep-dust PoolController» — инвариант balanceOf(PoolController) == 0.
ИЗМЕНЕНО 13-я ИТЕРАЦИЯ (ревизия 2): версия поднята с v.0.0.02 до v.0.0.03 — синхронизация с добавлением разделов treasury security и sweep-dust.
ИЗМЕНЕНО 11-я ИТЕРАЦИЯ: статус POOL_CALLER_ROLE снижен со «средний» до «низкий». Добавлены разделы «Симметричный коридор poolPrice», «Гейт инициализации», «Timelock». Ранее добавлены разделы «Dual-authority модель PoolState» и «Принятые риски» (7-я итерация).

|R.2.01.09|Registry|Architecture|Markdown|docs/tech/threat-model.md|R.2.01.08|v.0.0.03|Planned|§12|
|Описание: Модель угроз. STRIDE-анализ, векторы атак, контрмеры, остаточные риски.
Содержание (раздел 4.4 «Риски AccessControl»):
- Риск: компрометация POOL_CALLER_ROLE — ПЕРЕКВАЛИФИЦИРОВАН в 11-й ИТЕРАЦИИ.
  Вектор: роль больше не используется в buyFromCurveFor. Защита — immutable poolController.
  Остаточный риск: низкий. Роль остаётся в Roles.sol для обратной совместимости, но в CurveController не используется.
- Риск: компрометация PoolController (НОВЫЙ вектор в 11-й ИТЕРАЦИИ).
  Вектор: если PoolController скомпрометирован, атакующий может вызвать buyFromCurveFor.
  Митигации:
    (1) CurveController тянет USDC через safeTransferFrom — нужен реальный USDC на балансе PoolController.
    (2) Лимит MAX_CURVE_FOR_PCT = 2000 (20% freeReserve) за вызов.
    (3) immutable poolController — только один адрес может вызвать buyFromCurveFor.
    (4) Операционный мониторинг (обязательный): отслеживать BuyFromPool(tokensFromCurve > 0) и соответствие newReserve росту.
  Остаточный риск: низкий.
- Риск: компрометация GOVERNANCE_ROLE.
  Вектор: изменение управляемых параметров в обход Timelock.
  Митигация: (1) только Safe Multisig 3/5 может вызвать Governance.propose через onlySafe; (2) ParameterRegistry проверяет bounds; (3) Timelock задерживает исполнение на 7 дней.
  Остаточный риск: низкий.
- Риск: компрометация PAUSER_ROLE.
  Вектор: DoS — торговля остановлена.
  Митигация: unpause() требует GOVERNANCE_ROLE — атакующий не может возобновить торговлю самостоятельно.
  Остаточный риск: низкий.
- Риск: деплойер сохраняет роли после finalize.
  Вектор: если finalize() не отзывает DEFAULT_ADMIN_ROLE и временный GOVERNANCE_ROLE у Factory, деплойер сохраняет admin-права.
  Митигация: (1) finalize() явно отзывает DEFAULT_ADMIN_ROLE во всех 9 AccessControl-контрактах; (2) отзывает временный GOVERNANCE_ROLE в CurveController и PoolController; (3) проверяется тестом test_factory_has_no_roles_after_finalize (T.1.01.18).
  Остаточный риск: отсутствует при корректном finalize.
- Риск: компрометация treasury (НОВЫЙ вектор 13-я ИТЕРАЦИЯ (ревизия 3)).
  Вектор: treasury — immutable, не имеет ролей в протоколе. Прямая компрометация treasury как контракта протокола невозможна (treasury не участвует в логике). Косвенные векторы:
    (a) Если treasury = EOA — компрометация приватного ключа. Атакующий получает доступ к накопленному USDC (sellTeamFee). НО: treasury не имеет ролей, поэтому атака ограничена кражей treasury balance, экономика протокола не разрушается.
    (b) Если treasury = контракт с delegate call или произвольным вызовом — атакующий может вывести USDC через уязвимость treasury. Аналогично (a): ущерб ограничен treasury balance.
    (c) Если treasury = контракт, имеющий роли в протоколе (не должно быть) — атака расширяется до ролей. Митигация: валидация в аудите.
  Митигации:
    (1) treasury = Safe Multisig 3/5 (рекомендуется). См. R.2.01.05 deployment-guide.
    (2) treasury не имеет ролей ни в одном контракте протокола. Проверяется тестом T.1.01.18.
    (3) treasury = контракт (code.length > 0), не EOA. Валидация в Factory.deploy.
    (4) Мониторинг `treasury_balance_decrease` (critical, O.1.01.02) — немедленный pause() при срабатывании.
    (5) treasury не имеет delegate call / произвольных вызовов. Проверяется при аудите.
  Остаточный риск:
    - При treasury = Safe Multisig 3/5: низкий. Ущерб ограничен treasury balance; governance и резерв защищены.
    - При treasury = EOA: средний. Компрометация ключа = потеря treasury balance.
    - При treasury = контракт с delegate call: средний. Требует ручного review treasury.
Содержание (раздел «Риски инициализации»):
- Гейт NotInitialized закрывает окно между deploy и initializePoolPrice.
- S_curve() == 0 в initializePoolPrice исключает калибровку от неверного P(S).
Содержание (раздел «Timelock»):
- TIMELOCK_DELAY = 7 days. Обоснование: отраслевой стандарт, время на выход при невыгодном governance-решении.
Содержание (раздел «Sweep-dust»):
- Sweep-dust в PoolController.buyFromPool (шаг 14b) предотвращает накопление пыли USDC.
- Инвариант balanceOf(PoolController) == 0 между транзакциями.
- Нарушение (balanceOf > 0 после tx) = баг в PoolController или атака (обнаруживается alert `USDC_left_in_poolController`, critical, O.1.01.02).
|Публичный API:
- Элемент реестра/документации; публичного API нет.
|↙ ПОТРЕБЛЯЕТ:
- R.2.01.08 security-model.md
- C.8.01.01 XartIAFactory (роли и их назначение, валидация treasury)
- C.0.01.01 Roles
- C.3.01.01 CurveController (pull-модель buyFromCurveFor)
- C.3.01.02 PoolController (sweep-dust)
|↘ ПРЕДОСТАВЛЯЕТ:
- Модель угроз для аудита
|Реализация: Markdown-документ с STRIDE-анализом.
|Примечания: НОВОЕ 13-я ИТЕРАЦИЯ (ревизия 3): раздел «Компрометация treasury» оформлен как структурированный элемент STRIDE-анализа. Ранее был черновой заметкой `**вектор компрометации treasury` внутри раздела 4.4 «Риски AccessControl». Добавлены: три косвенных вектора (EOA / контракт с delegate call / контракт с ролями), митигации, градация остаточного риска. Также добавлен раздел «Sweep-dust» — связь с alert USDC_left_in_poolController.
ИЗМЕНЕНО 13-я ИТЕРАЦИЯ (ревизия 2): версия поднята с v.0.0.02 до v.0.0.03 — синхронизация с добавлением вектора компрометации treasury и раздела Sweep-dust.
ИЗМЕНЕНО 11-я ИТЕРАЦИЯ: POOL_CALLER_ROLE переквалифицирован в низкий риск. Добавлен новый вектор «Компрометация PoolController» с митигациями (pull-модель, immutable, MAX_CURVE_FOR_PCT, мониторинг). Добавлены разделы «Риски инициализации» и «Timelock».

|R.2.01.10|Registry|Architecture|Markdown|docs/tech/testing-guide.md|R.2.01.01|v.0.0.01|Planned|§13|
|Описание: Руководство по тестированию. Запуск, написание, интерпретация.

|Публичный API:
- Элемент реестра/документации; публичного API нет.
|↙ ПОТРЕБЛЯЕТ:
- R.2.01.01
|↘ ПРЕДОСТАВЛЯЕТ:
- элемент проекта
|Реализация: Markdown-документ.

|R.2.01.11|Registry|Architecture|Markdown|docs/tech/audit-checklist.md|R.2.01.08|v.0.0.04|Planned|§12.3|
|Описание: Чеклист для аудита. Пункты проверки, критерии приёмки.
Содержание:
... (существующие разделы: External-функции PoolController, Семантика maxBalance, SafeERC20, lastBuyTime и earlySellFee, Комиссии, poolPrice vs P(S) — симметричный коридор, buyFromCurveFor — pull-модель, Гейт инициализации, setPoolController)
Раздел «sellTeamFee и treasury» (НОВОЕ 13-я ИТЕРАЦИЯ):
- Проверить, что sellTeamFee применяется в redeemFromCurve и sellToPool, но НЕ в buyFromCurve/buyFromCurveFor.
- Проверить, что treasury — immutable, валидируется в конструкторах CurveController и PoolController (не address(0)).
- Проверить, что Factory.deploy валидирует treasury: != address(0), != address(this), code.length > 0.
- Проверить, что sellTeamFee хранится только в CurveController (single source of truth), PoolController читает через ICurveController.sellTeamFee().
- Проверить, что setSellTeamFee защищён onlyRole(GOVERNANCE_ROLE), bounds 0–50 bp, синхронизирован с registerParams (bounds [0, 50]).
- Проверить, что sellTeamFee переводится в treasury через reserveManager.pay(treasury, sell_team_fee_18) — не через прямой safeTransfer.
- Проверить, что при sellTeamFee == 0 вызов reserveManager.pay(treasury, ...) не выполняется (gas-оптимизация, не критично).
- Проверить инвариант reserve >= R(S_curve) после redeemFromCurve с sellTeamFee: reserve уменьшается на (amount_18 − redeemFee − earlyFee), R(S_new) уменьшается на amount_18, freeReserve увеличивается на redeemFee + earlyFee.
- Проверить инвариант reserve >= R(S_curve) после sellToPool с sellTeamFee: reserve уменьшается на (amount_gross − redeemFee), R(S) не меняется.
- Проверить, что totalSupply == S_curve держится (sellTeamFee не минтит токены).
- Проверить, что событие Redeem содержит поле sellTeamFee (между earlyFee и newScurve).
- Проверить, что событие SellToPool содержит поле sellTeamFee (между fee и newPool).
- Проверить, что событие SellTeamFeeUpdated эмитится при setSellTeamFee.
- Проверить, что событие Deploy содержит treasury.
- Проверить, что параметр PARAM_SELL_TEAM_FEE зарегистрирован в ParameterRegistry с target = curveController, setter = ICurveController.setSellTeamFee.selector, bounds [0, 50].
- Проверить, что в deploy() установлен setSellTeamFee(10) как default.
- Проверить, что sellTeamFee не влияет на freeReserve больше, чем ожидается (round-trip cost 1.1% без earlySellFee).
- Проверить тесты T.5.01.21 (SellTeamFee) и T.1.01.03/04 (unit).
Раздел «Распределение комиссий» (обновление):
- redeemFee → остаётся в reserve.
- earlySellFee → остаётся в reserve.
- sellTeamFee → treasury (USDC).
- teamTokens → Vesting (токены).
- Проверить, что ни один из этих потоков не нарушает инвариант reserve >= R(S_curve).
Раздел «Timelock»:
- Проверить, что TIMELOCK_DELAY = 7 days.
- Проверить, что queue() и execute() блокируют target без кода.
Раздел «Sweep-dust PoolController» (НОВОЕ 13-я ИТЕРАЦИЯ (ревизия 3)):
- Проверить, что buyFromPool имеет шаг (14b): sweep-dust остатка USDC → reserveManager.
- Проверить, что после любой транзакции balanceOf(PoolController) == 0.
- Проверить тесты: test_buyFromPool_zero_balance_after_tx, test_buyFromPool_dust_swept,
  test_buyFromPool_dust_accumulation_1000_tx.
- Проверить, что sweep-dust не эмитит событие (нормально: остаток < 2 wei-6).
- Проверить, что sweep-dust не нарушает инвариант reserve >= R(S_curve).
Раздел «Treasury security» (НОВОЕ 13-я ИТЕРАЦИЯ (ревизия 4)):
- Проверить, что treasury не имеет ролей ни в одном контракте протокола. Тест: T.1.01.18 test_treasury_has_no_roles.
- Проверить, что treasury = Safe Multisig 3/5 (не EOA). Factory.deploy валидирует code.length > 0, но не различает Safe vs произвольный контракт. Ручная проверка при аудите.
- Проверить, что treasury НЕ имеет delegate call и произвольных вызовов.
- Проверить, что treasury immutable после деплоя. Геттеры: Factory.treasury(), CurveController.treasury(), PoolController.treasury() — должны совпадать.
- Проверить, что alert treasury_balance_decrease (critical, O.1.01.02) настроен и триггерится при уменьшении баланса.
- Проверить, что treasury_balance в dashboard (O.1.01.01) отображается.
Раздел «Мониторинг и алерты» (расширение 13-я ИТЕРАЦИЯ):
- Проверить, что alert treasury_balance_anomaly настроен (резкий рост вне ожидаемых операций).
- Проверить, что alert treasury_balance_decrease настроен (critical, немедленный pause()).
- Проверить, что alert sellTeamFee_changed настроен (info при governance-изменении).
- Проверить, что alert sellTeamFee_out_of_bounds настроен (defense-in-depth).
- Проверить, что dashboard.json содержит панели treasuryBalance, sellTeamFeeCurrent, roundTripCost.
- Проверить, что metrics.md содержит разделы «Метрики protocol revenue» и «Метрики пользователя».
Раздел «Индексация (subgraph)» (НОВОЕ 13-я ИТЕРАЦИЯ (ревизия 4)):
- Проверить, что O.2.01.01 subgraph.ts обрабатывает SellTeamFeeUpdated (handleSellTeamFeeUpdated).
- Проверить, что O.2.01.03 schema.graphql содержит поле sellTeamFee в type Sell и type Redeem.
- Проверить, что schema.graphql содержит сущность Treasury.
- Проверить, что schema.graphql содержит сущность SellTeamFeeUpdate.
- Проверить, что O.2.01.02 subgraph.yaml содержит eventHandler для SellTeamFeeUpdated.
Раздел «Документация» (расширение 13-я ИТЕРАЦИЯ):
- Проверить, что L.1.01.01 whitepaper.md содержит раздел про sellTeamFee как protocol revenue.
- Проверить, что L.1.01.03 token-classification.md содержит раздел «Protocol revenue (sellTeamFee) как фактор риска».
- Проверить, что R.2.01.08 security-model.md содержит раздел «Treasury security».
- Проверить, что R.2.01.09 threat-model.md содержит вектор «Компрометация treasury».
- Проверить, что R.3.01.06 faq.md содержит раздел «Комиссии и protocol revenue».
|Публичный API:
- Элемент реестра/документации; публичного API нет.
|↙ ПОТРЕБЛЯЕТ:
- R.2.01.08 security-model.md
- R.2.01.09 threat-model.md
- R.1.01.01 xartia_4.2.md
- C.3.01.01 CurveController
- C.3.01.02 PoolController
- C.8.01.01 XartIAFactory
- C.10.01.01 Events
- O.1.01.02 alerts.yaml
- O.2.01.01 subgraph.ts
- O.2.01.03 schema.graphql
- L.1.01.03 token-classification.md
|↘ ПРЕДОСТАВЛЯЕТ:
- Чеклист для аудита
|Реализация: Markdown-документ.
|Примечания: ИСПРАВЛЕНО 13-я ИТЕРАЦИЯ (ревизия 4):
- Версия поднята с v.0.0.03 до v.0.0.04 — синхронизация с добавлением разделов «Treasury security», «Мониторинг и алерты», «Индексация (subgraph)», «Документация».
- Переформулирован раздел «Sweep-dust PoolController»: убрано противоречивое «НОВОЕ, пропущен ранее» → «НОВОЕ 13-я ИТЕРАЦИЯ (ревизия 3)».
- Добавлен раздел «Treasury security» — проверка ролей treasury (тест T.1.01.18), safe vs EOA, immutable, алерты.
- Добавлен раздел «Мониторинг и алерты» — 4 новых алерта protocol revenue.
- Добавлен раздел «Индексация (subgraph)» — handler SellTeamFeeUpdated, сущности Treasury и SellTeamFeeUpdate.
- Добавлен раздел «Документация» — синхронизация whitepaper, token-classification, security-model, threat-model, faq.
НОВОЕ 13-я ИТЕРАЦИЯ: раздел «sellTeamFee и treasury». Обновлён раздел «Распределение комиссий».

|R.3.01.01|Registry|Files|Markdown|docs/registry/files.md|—|v.0.0.01|Planned|—|
|Описание: Реестр файлов проекта. Полный список с ID, зависимостями, статусами. Единый источник истины о структуре проекта.

|Публичный API:
- Элемент реестра/документации; публичного API нет.
|↙ ПОТРЕБЛЯЕТ:
- — (нет зависимостей)
|↘ ПРЕДОСТАВЛЯЕТ:
- элемент проекта
|Реализация: Markdown-документ.

|R.3.01.02|Registry|Glossary|Markdown|docs/registry/glossary.md|R.1.01.01|v.0.0.02|Planned|§21|
|Описание: Глоссарий. Термины протокола XartIA — техническая, экономическая и операционная лексика.
Содержание:
Раздел «Bonding curve»:
- bonding curve: математическая кривая P(S), связывающая цену токена XRT с предложением S.
- S_curve: текущее предложение XRT, эмитированное через bonding curve. Хранится в ReserveManager.
- P(S): текущая цена по bonding curve. Кусочно-линейная, монотонно возрастающая.
- R(S): интеграл P от 0 до S. Минимально необходимый резерв (curveBacking) для покрытия всех токенов при цене P(S).
- level / уровень: сегмент bonding curve с линейной P(S). Таблица из MAX_LEVELS уровней. Иммутабельна после деплоя.
- maxBalance: максимальный баланс пользователя в границах уровня. Проверяется по финальному уровню после покупки.
- deltaSForBuy: решение R(S+ΔS) − R(S) = X относительно ΔS. Используется в buyFromCurve.
- amountForRedeem: R(S) − R(S−ΔS). Используется в redeemFromCurve.
Раздел «Пул и цена»:
- pool: количество токенов XRT, хранящихся в PoolController. Не влияет на S_curve.
- poolPrice: цена токена во внутреннем пуле. Хранится в 18 decimals. Ограничена симметричным коридором.
- симметричный коридор: poolPrice ∈ [P(S)/(1+MAX_GAP), P(S)*(1+MAX_GAP)].
- MAX_GAP: 10% (1000 / BASIS_POINTS). Полуширина коридора.
- floor: P(S)/(1+MAX_GAP). Нижняя граница poolPrice. Enforced в buyFromCurve и buyFromCurveFor.
- ceiling: P(S)*(1+MAX_GAP). Верхняя граница poolPrice. Enforced в redeemFromCurve и sellToPool.
Раздел «Резерв»:
- reserve: фактический баланс USDC в ReserveManager, приведённый к 18 decimals. reserve() = toWei(balanceOf(reserveManager)).
- curveBacking: R(S_curve). Минимально необходимый резерв.
- freeReserve: reserve − curveBacking. Буфер для продаж через пул.
- инвариант reserve >= R(S_curve): фундаментальное свойство протокола. Проверяется в updateScurve с revert.
Раздел «Комиссии и доход команды» (расширено 13-я ИТЕРАЦИЯ):
- buyFee: комиссия с покупок на кривой и в пуле. 0.5% (50 bp). Остаётся в резерве.
- redeemFee: комиссия с продаж (redeemFromCurve и sellToPool). 0.5% (50 bp). Остаётся в резерве.
- earlySellFee: штраф за раннюю продажу через redeemFromCurve. 0–5% (0–500 bp). Остаётся в резерве. Не применяется в sellToPool.
- earlySellPeriod: окно действия earlySellFee после последней покупки. 0–90 дней.
- teamTokens: 0.5% от ΔS, минтится в Vesting на каждой покупке (buyFromCurve, buyFromCurveFor). Распределение эмиссии, не fee.
- team percent: TEAM_PERCENT = 50 (0.5%). Константа.
- sellTeamFee: USDC-комиссия с продаж (redeemFromCurve и sellToPool). 0–0.5% (0–50 bp), default 0.1% (10 bp). Governance-параметр PARAM_SELL_TEAM_FEE. Уходит в treasury.
- treasury: immutable адрес, задаётся при Factory.deploy. Получает sellTeamFee в USDC. Не имеет ролей в протоколе. Обычно Safe Multisig 3/5.
- protocol revenue: sellTeamFee. Операционный доход команды. НЕ распределяется между держателями XRT.
- round-trip cost: суммарные потери пользователя при покупке и немедленной продаже. Базово buyFee + redeemFee + sellTeamFee = 1.1% (110 bp) без earlySellFee.
- channel separation: teamTokens (токены, Vesting) и sellTeamFee (USDC, treasury) — два независимых канала дохода команды.
Раздел «Внутренние механизмы»:
- sweep-dust: перевод остатка USDC (≤ 2 wei-6) с баланса PoolController в ReserveManager после buyFromPool. Гарантирует balanceOf(PoolController) == 0 между транзакциями.
- maxPurchasePct: лимит одной покупки на кривой как доля от S_curve. 0–10% (0–1000 bp).
- minimalPurchase: минимальная эффективная покупка (после buyFee). 6-dec USDC.
- effectiveMinimalX6: ceil(minimalPurchase * BASIS_POINTS / (BASIS_POINTS − buyFee)). Реальный минимум для пользователя.
- maxSellPctPerDay: суточный лимит продаж в пул как доля от S_curve. 0–5% (0–500 bp).
- Circuit Breaker: автоматическая пауза торговли при freeReserve/reserve < threshold.
- threshold: порог срабатывания Circuit Breaker. 5–20% (500–2000 bp).
Раздел «Роли и governance»:
- Safe Multisig: 3/5 мультиподпись. Владелец протокола после finalize.
- GOVERNANCE_ROLE: роль, выданная Timelock. Управляет параметрами через Governance → Timelock.
- PAUSER_ROLE: роль, выданная safe. Может вызвать pause() на CurveController и PoolController.
- POOL_WRITER_ROLE: role для setPool. Выдана PoolController.
- PRICE_WRITER_ROLE: role для setPoolPrice. Выдана CurveController и PoolController.
- CONTROLLER_ROLE: role для updateScurve и pay в ReserveManager. Выдана CurveController и PoolController.
- MINTER_ROLE / BURNER_ROLE: role для mint / burnFrom в XartIAToken. Выдана CurveController.
- POOL_CALLER_ROLE: legacy-роль. Больше не используется в CurveController (11-я итерация). Заменена immutable poolController.
- Timelock: задержка исполнения governance-решений. TIMELOCK_DELAY = 7 days.
- ParameterRegistry: реестр управляемых параметров с bounds. Ограничивает диапазон для Governance.propose.
Раздел «Инициализация»:
- NotInitialized: ошибка, возвращаемая торговыми функциями до вызова initializePoolPrice.
- гейт инициализации: poolState.poolPrice() == 0 до initializePoolPrice. Защищает окно между deploy и initializePoolPrice.
Раздел «Прецизионность»:
- PRECISION: 1e18. Точность XRT (18 decimals).
- USDC_PRECISION: 1e6. Точность USDC (6 decimals).
- BASIS_POINTS: 10000. 100% в базисных пунктах.
- toUSDC / fromUSDC / toWei / fromWei: конвертация между 6 и 18 decimals. PrecisionLib.
- нормализация X_18: X_18 = toWei(toUSDC(X_18)). Устраняет пыль в каскаде.
Раздел «Операционное»:
- sweep-dust: см. «Внутренние механизмы».
- reorg: реорганизация блокчейна. Обрабатывается в subgraph через event.block.number.
- invariant: свойство, которое должно держаться на каждом шаге. Проверяется в Foundry Invariant и Python-симуляциях.
|Публичный API:
- Элемент реестра/документации; публичного API нет.
|↙ ПОТРЕБЛЯЕТ:
- R.1.01.01 xartia_4.2.md (терминология)
|↘ ПРЕДОСТАВЛЯЕТ:
- Единый словарь терминов для документации, dApp, аудита
|Реализация: Markdown-документ.
|Примечания: ИСПРАВЛЕНО 13-я ИТЕРАЦИЯ (ревизия 3): добавлены термины treasury, sellTeamFee, protocol revenue, round-trip cost, teamTokens, sweep-dust, channel separation, floor, ceiling, нормализация X_18. Расширены разделы «Комиссии и доход команды» и «Роли и governance» (POOL_CALLER_ROLE отмечен как legacy).

|R.3.01.03|Registry|Files|Markdown|docs/registry/changelog.md|—|v.0.0.01|Planned|—|
|Описание: Developer changelog. Технические изменения, миграции, breaking changes.

|Публичный API:
- Элемент реестра/документации; публичного API нет.
|↙ ПОТРЕБЛЯЕТ:
- — (нет зависимостей)
|↘ ПРЕДОСТАВЛЯЕТ:
- элемент проекта
|Реализация: Markdown-документ.

|R.3.01.04|Registry|Files|Markdown|docs/registry/contributing.md|—|v.0.0.03|Planned|—|
|Описание: Руководство для контрибьюторов. Стиль кода, процесс review. Дополнительно — соглашение о стиле псевдокода в спецификациях.
Раздел «Стиль псевдокода»:
- Псевдокод в спецификациях (C.*, T.*) использует snake_case для локальных переменных, отражающих экономические величины USDC:
  - суффикс _6 — 6 decimals (USDC user-facing).
  - суффикс _18 — 18 decimals (внутренние вычисления).
  - суффикс _bp — basis points.
  - без суффикса — значения XartIA (18 decimals по умолчанию).
  - суффикс _user — то, что получает пользователь (net-amount после всех комиссий). Пример: amount_user_18 в sellToPool.
  - префикс normalized_ — значение после toWei(toUSDC(...)). Пример: normalized X_18 в buyFromCurveFor.
  - суффикс _gross — значение до вычета комиссий. Пример: amount_gross_18 в sellToPool.
- Solidity-имплементация использует camelCase: tokensFromPool, tokensFromCurve, XRemaining18, buyFeeBp, sellTeamFee, treasuryBalance.
- Псевдокод не является обязательным к буквальному переносу — это спецификация логики, а не готовый код.
- Комментарии к псевдокоду (например, «если S_curve() > 0», «если sell_team_fee_18 > 0») — обязательны к переносу в Solidity.
- Псевдокод для событий эмиссии: перечислять поля в порядке объявления события. Например: «эмиссия Redeem(seller, tokensIn, usdcOut, fee, earlyFee, sellTeamFee, newScurve, newReserve, newLevel)».
Раздел «Обязательные проверки при добавлении параметра»:
- При добавлении governance-параметра:
  1. Добавить bytes32-идентификатор PARAM_* в C.2.01.03 Constants.
  2. Добавить сеттер в целевой контракт с onlyRole(GOVERNANCE_ROLE) и bounds.
  3. Добавить вызов register() в Factory.registerParams (C.8.01.01).
  4. Добавить событие Updated в C.10.01.01 Events.
  5. Добавить поле в gеттеры (если публичный параметр).
  6. Добавить тесты: unit (bounds, emit, unauthorized), crash (registerParams.bounds).
  7. Обновить ParameterRegistry bounds-таблицу в T.5.01.17.
  8. Обновить audit-checklist (R.2.01.11).
Раздел «Обязательные проверки при добавлении immutable-поля»:
- При добавлении immutable в конструктор:
  1. Валидировать в конструкторе (например, address != address(0)).
  2. Добавить геттер в публичный API контракта.
  3. Добавить геттер в интерфейс (I*), если поле читается извне.
  4. Добавить в Factory.deploy (если контракт создаётся через Factory).
  5. Добавить тест test_constructor_sets_<field> в T.1.01.23–T.1.01.25.
  6. Обновить R.2.01.03 contracts.md.
  7. Обновить ABI-файлы W.1.01.03–W.1.01.10.                                    // НОВОЕ
Раздел «Обязательные проверки при добавлении события»:
- При добавлении события:
  1. Объявить в C.10.01.01 Events с комментарием семантики полей.
  2. Добавить эмиссию в контракт.
  3. Обновить R.2.01.04 events.md (описание полей, индексация).
  4. Обновить O.2.01.01 subgraph.ts (handle<Event>) и O.2.01.03 schema.graphql (если событие индексируется).
  5. Добавить тест test_event_<name> в T.1.01.17.
  6. Обновить dashboard.json (если событие отображается).
Раздел «Процесс review»:
- Все PR проходят обязательный review минимум одним другим разработчиком.
- При изменении контракта — обязательно обновить зависимости (↙ ПОТРЕБЛЯЕТ / ↘ ПРЕДОСТАВЛЯЕТ) в реестре.
- При изменении API — обязательно обновить интерфейс (I*) и ABI-файлы (W.1.01.03–W.1.01.10).
- При изменении событий — обязательно обновить индексатор и мониторинг.
- При изменении bounds — обязательно синхронизировать с registerParams и audit-checklist.
- CI должен пройти: forge test, forge coverage ≥ 95%, slither без high-severity.
|Публичный API:
- Элемент реестра/документации; публичного API нет.
|↙ ПОТРЕБЛЯЕТ:
- R.3.01.01 files.md
- R.2.01.03 contracts.md
- R.2.01.04 events.md
|↘ ПРЕДОСТАВЛЯЕТ:
- Соглашение для контрибьюторов
|Реализация: Markdown-документ.
|Примечания: ИСПРАВЛЕНО 13-я ИТЕРАЦИЯ (ревизия 3):
- В раздел «Стиль псевдокода» добавлены: суффикс _user, префикс normalized_, суффикс _gross.
- Добавлены разделы «Обязательные проверки при добавлении параметра», «Обязательные проверки при добавлении immutable-поля», «Обязательные проверки при добавлении события». Ранее этих разделов не было, хотя 13-я итерация внесла sellTeamFee (параметр + immutable treasury + события SellTeamFeeUpdated), и без чеклиста легко забыть обновить registerParams или events.md.
- Расширен раздел «Процесс review» — синхронизация зависимостей, интерфейсов, ABI, индексатора, bounds.
ИСПРАВЛЕНО 13-я ИТЕРАЦИЯ (ревизия 5): в раздел «Обязательные проверки при добавлении immutable-поля» добавлен пункт 7 про обновление ABI-файлов. В разделе «Процесс review» это уже упоминалось, но в конкретном чеклисте — нет, что приводило к рассинхронизации между контрактом и frontend ABI. Версия поднята с v.0.0.02 до v.0.0.03.

|R.3.01.05|Registry|Files|Markdown|docs/registry/security.md|R.2.01.08|v.0.0.01|Planned|§12|
|Описание: Расширенная документация безопасности. Модель угроз, контакты для раскрытия уязвимостей.

|Публичный API:
- Элемент реестра/документации; публичного API нет.
|↙ ПОТРЕБЛЯЕТ:
- R.2.01.08
|↘ ПРЕДОСТАВЛЯЕТ:
- элемент проекта
|Реализация: Markdown-документ.

|R.3.01.06|Registry|Files|Markdown|docs/registry/faq.md|R.1.01.01|v.0.0.02|Planned|§15.2|
|Описание: FAQ. Частые вопросы пользователей XartIA — покупка, продажа, вестинг, голосование, комиссии.
Содержание:
Раздел «Покупка»:
- Как купить XRT? Есть два способа: buyFromCurve (через bonding curve) и buyFromPool (через внутренний пул, если там есть токены).
- Какой минимум покупки? minimalPurchase (default 1 USDC) — минимальная ЭФФЕКТИВНАЯ сумма после удержания buyFee. Реальный минимум для пользователя — effectiveMinimalX6() (например, 1.005026 USDC при buyFee = 0.5%).
- Какая комиссия при покупке? buyFee = 0.5% (50 bp). Остаётся в резерве, увеличивает freeReserve.
- Есть ли лимит на покупку? maxPurchasePct = 5% (default) от S_curve за одну транзакцию. При S_curve = 0 (genesis) лимит не применяется.
- Что такое maxBalance? Максимальный баланс одного пользователя. Проверяется по финальному уровню после покупки, не по промежуточным.
Раздел «Продажа»:
- Как продать XRT? Два способа: redeemFromCurve (через кривую) и sellToPool (через пул).
- Какая комиссия при продаже? redeemFee = 0.5% + sellTeamFee = 0.1% (default) = 0.6% с gross amount. См. раздел «Комиссии и protocol revenue».
- Что такое earlySellFee? Штраф за продажу через redeemFromCurve в течение earlySellPeriod после последней покупки. Default 0%. Диапазон 0–5%.
- Применяется ли earlySellFee в sellToPool? НЕТ. sellToPool применяет только redeemFee + sellTeamFee. Это by design: poolPrice ограничен симметричным коридором.
- Какой лимит продаж в пул? maxSellPctPerDay = 2% (default) от S_curve в сутки на адрес.
- Что такое round-trip cost? Суммарные потери при покупке и немедленной продаже. Базово 1.1% = buyFee (0.5%) + redeemFee (0.5%) + sellTeamFee (0.1%). С активным earlySellFee — до 6.1%.
Раздел «Комиссии и protocol revenue» (НОВОЕ 13-я ИТЕРАЦИЯ):
- Какие комиссии я плачу?
  - buyFee: 0.5% с покупок (buyFromCurve, buyFromPool). Остаётся в резерве.
  - redeemFee: 0.5% с продаж (redeemFromCurve, sellToPool). Остаётся в резерве.
  - sellTeamFee: 0.1% (default) с продаж. Уходит в treasury.
  - earlySellFee: 0–5% (default 0%) при ранней продаже через redeemFromCurve. Остаётся в резерве.
- Что такое sellTeamFee?
  - USDC-комиссия с продаж. Default 0.1% (10 bp), диапазон 0–0.5% (0–50 bp).
  - Governance-параметр PARAM_SELL_TEAM_FEE. Изменяется через Safe Multisig → Timelock (7 дней).
  - Уходит в treasury — неизменяемый адрес, заданный при деплое.
- Куда идёт sellTeamFee? В treasury. Treasury — это операционный фонд протокола (разработка, аудит, инфраструктура).
- Распределяется ли sellTeamFee между держателями XRT? НЕТ. Treasury — операционный фонд, НЕ дивиденд. Держатели XRT не получают долю в protocol revenue.
- Что такое treasury? Неизменяемый адрес, заданный при деплое. Обычно совпадает с Safe Multisig 3/5, но может быть отдельный адрес. Проверить: curveController.treasury().
- Можно ли изменить treasury? НЕТ. Immutable после деплоя.
- Можно ли изменить sellTeamFee? ДА, через governance. Safe Multisig 3/5 → Governance → Timelock (7 дней) → CurveController.setSellTeamFee. Bounds 0–0.5%.
- В чём разница между teamTokens и sellTeamFee?
  - teamTokens: 0.5% от ΔS на покупках → Vesting (токены XRT). Cliff 365 дней, duration 730 дней.
  - sellTeamFee: 0.1% от gross amount на продажах → treasury (USDC, немедленно).
  - Это два независимых канала дохода команды.
- Как посмотреть накопленный protocol revenue? balanceOf(USDC, treasury). UI отображает в разделе «Fee display» (см. W.1.01.01).
Раздел «Вестинг»:
- Что такое Vesting? Учёт командных токенов (teamTokens).
- Когда разблокируются командные токены? Cliff 365 дней с момента первого addTokens. Затем линейная разблокировка 730 дней.
- Кто получает командные токены? Immutable beneficiary = safe. Safe Multisig 3/5.
- Может ли команда продать командные токены раньше? НЕТ. Vesting release() доступен только после cliff. Early sell невозможен.
Раздел «Голосование»:
- Как участвовать в governance? Через Snapshot (off-chain) с квадратичным голосованием: votingWeight = sqrt(stakedXartIA).
- Какие параметры управляются? buyFee, redeemFee, earlySellFee, earlySellPeriod, maxPurchasePct, minimalPurchase, maxSellPctPerDay, circuitBreaker.threshold, sellTeamFee.
- Какой Timelock? TIMELOCK_DELAY = 7 days. После голосования — 7 дней до исполнения.
- Кто может предложить? Safe Multisig 3/5 через Governance.propose. onlySafe.
Раздел «Безопасность»:
- Кто владеет протоколом? Safe Multisig 3/5 после finalize. Деплойер отзывает все роли.
- Есть ли upgradeability? НЕТ. Immutable контракты. Баг не исправляется, только pause + миграция.
- Что такое Circuit Breaker? Автоматическая пауза торговли при freeReserve/reserve < threshold (default 10%, bounds 5–20%).
- Кто может pause? PAUSER_ROLE (safe) может pause. unpause — только GOVERNANCE_ROLE (через Timelock).
- Что происходит при срабатывании Circuit Breaker? CircuitBreaker.active() = true. sellToPool блокируется. redeemFromCurve и buyFromCurve продолжают работать.
- Что если я потеряю доступ к кошельку? Протокол не custodial. Потеря ключа = потеря токенов. Восстановление невозможно.
Раздел «Юридическое»:
- XRT — ценная бумага? Юридическая квалификация: L.1.01.03 token-classification.md. Требует юридического заключения L.3.01.01.
- Обещает ли протокол прибыль? НЕТ. Whitepaper L.1.01.01 содержит явный disclaimer.
- В каких юрисдикциях доступен XRT? См. L.3.01.01 jurisdiction.pdf. Возможен геофенсинг США и ЕС.
- Что такое Terms of Use? Условия использования: L.2.01.01. Отказ от ответственности: L.2.01.03.
|Публичный API:
- Элемент реестра/документации; публичного API нет.
|↙ ПОТРЕБЛЯЕТ:
- R.1.01.01 xartia_4.2.md (технические детали)
- C.3.01.01 CurveController (buyFee, redeemFee, earlySellFee, sellTeamFee, treasury)
- C.3.01.02 PoolController (maxSellPctPerDay)
- C.5.01.01 Vesting (cliff, duration)
- L.1.01.01 whitepaper.md (юридические формулировки)
- L.1.01.03 token-classification.md
|↘ ПРЕДОСТАВЛЯЕТ:
- Публичный FAQ для пользователей
|Реализация: Markdown-документ.
|Примечания: НОВОЕ 13-я ИТЕРАЦИЯ (ревизия 3):
- Добавлен раздел «Комиссии и protocol revenue» с явными ответами про sellTeamFee, treasury, разницу teamTokens vs sellTeamFee.
- Обновлён раздел «Продажа» — упомянут sellTeamFee и round-trip cost.
- Обновлён раздел «Голосование» — sellTeamFee в списке управляемых параметров.
- Обновлён раздел «Вестинг» — уточнено, что Vesting получает только токены, не USDC.
- Расширен раздел «Безопасность» — Circuit Breaker, pause/unpause.
КРИТИЧНО для юридической позиции: FAQ должен явно указывать, что sellTeamFee НЕ распределяется между держателями и НЕ создаёт ожиданий прибыли. Это ключевой аргумент защиты против Howey/MiCA (см. L.1.01.03, раздел 4).

|R.3.01.07|Registry|Files|Markdown|docs/registry/roadmap.md|R.1.01.01|v.0.0.01|Planned|—|
|Описание: Дорожная карта проекта. Этапы, сроки, ключевые вехи.

|Публичный API:
- Элемент реестра/документации; публичного API нет.
|↙ ПОТРЕБЛЯЕТ:
- R.1.01.01
|↘ ПРЕДОСТАВЛЯЕТ:
- элемент проекта
|Реализация: Markdown-документ.

|R.4.01.01|Registry|Audit|Markdown|docs/audit/README.md|—|v.0.0.01|Planned|§12.3|
|Описание: Описание процесса аудита. Как проводится, кто участвует, как публикуются результаты.

|Публичный API:
- Элемент реестра/документации; публичного API нет.
|↙ ПОТРЕБЛЯЕТ:
- — (нет зависимостей)
|↘ ПРЕДОСТАВЛЯЕТ:
- элемент проекта
|Реализация: Markdown-документ.

|S.1.01.01|Scripts|Python|Python|scripts/python/simulate.py|E.2.01.01|v.0.0.01|Draft|§13|
|Описание: CLI-обёртка над E.2.01.01 для запуска симуляций.
|Публичный API:
- def main(scenario: str, params: dict) -> None
|↙ ПОТРЕБЛЯЕТ:
- E.2.01.01 base_model.py
|↘ ПРЕДОСТАВЛЯЕТ:
- Отчёт симуляции в stdout/JSON
|Реализация: argparse CLI.
|Примечания: Пример: python simulate.py --scenario mass_exit --pct 50.

|S.1.01.02|Scripts|Python|Python|scripts/python/calibrate.py|E.3.01.01|v.0.0.01|Draft|§7|
|Описание: CLI-обёртка над E.3.01.01 для калибровки.
|Публичный API:
- def main(targets: str, output: str) -> None
|↙ ПОТРЕБЛЯЕТ:
- E.3.01.01 tune_params.py
|↘ ПРЕДОСТАВЛЯЕТ:
- params_output.json, params_output.csv
|Реализация: argparse CLI.
|Примечания: Пример: python calibrate.py --targets targets.json --output out/.

|S.1.01.03|Scripts|Python|Python|scripts/python/verify_math.py|E.1.01.02|v.0.0.01|Draft|§4.6|
|Описание: Верификация математики. Сравнение Python-модели и Solidity через CurveMathWrapper.
|Публичный API:
- def verify(wrapper_address: str, test_cases: list) -> dict
|↙ ПОТРЕБЛЯЕТ:
- E.2.01.01 base_model.py
- C.2.01.13 CurveMathWrapper (адрес из deployments/<network>.json — curve_math_wrapper_address)
|↘ ПРЕДОСТАВЛЯЕТ:
- Отчёт расхождений
|Реализация: web3.py вызывает external view-функции wrapper'а и сравнивает с Python.
|Примечания: Адрес берётся из deployments/<network>.json.

|S.1.01.04|Scripts|Python|Python|scripts/python/plot_results.py|E.2.01.01|v.0.0.01|Draft|§13.4|
|Описание: Визуализация результатов. Графики цены, резерва, пула.
|Публичный API:
- def plot(results: dict, output: str) -> None
|↙ ПОТРЕБЛЯЕТ:
- E.2.01.01 base_model.py
|↘ ПРЕДОСТАВЛЯЕТ:
- PNG/SVG графики
|Реализация: matplotlib, seaborn.
|Примечания: Пример: python plot_results.py --input results.json --output charts/.

|S.1.01.05|Scripts|Python|Python|scripts/python/audit_math.py|E.1.01.02|v.0.0.01|Draft|§4.6|
|Описание: Аудит математики. Граничные случаи, overflow, округление.
|Публичный API:
- def audit() -> dict
|↙ ПОТРЕБЛЯЕТ:
- E.2.01.01 base_model.py
|↘ ПРЕДОСТАВЛЯЕТ:
- Отчёт о граничных случаях
|Реализация: Property-based testing через hypothesis.
|Примечания: Проверяет 10 000+ случайных значений.

|S.1.01.06|Scripts|Python|Python|scripts/python/gas_report.py|E.2.01.01|v.0.0.01|Draft|§13.5|
|Описание: Анализ газа. Отчёт по всем операциям, сравнение с лимитами ТЗ.
|Публичный API:
- def report(contract_address: str) -> dict
|↙ ПОТРЕБЛЯЕТ:
- E.2.01.01 base_model.py
- T.6.* gas-тесты
|↘ ПРЕДОСТАВЛЯЕТ:
- Отчёт по газу
|Реализация: Парсит результаты forge test --gas-report.
|Примечания: Fail, если газ > лимита ТЗ.

|S.2.01.01|Scripts|Shell|Shell|scripts/shell/build.sh|—|v.0.0.01|Draft|§14|
|Описание: Shell-скрипт сборки. forge build.
|Публичный API:
- ./build.sh
|↙ ПОТРЕБЛЯЕТ:
- D.2.01.04 foundry.toml
|↘ ПРЕДОСТАВЛЯЕТ:
- Скомпилированные контракты в out/
|Реализация: bash, set -e.
|Примечания: Кэширует артефакты.

|S.2.01.02|Scripts|Shell|Shell|scripts/shell/test.sh|T.1.01.01|v.0.0.01|Draft|§13|
|Описание: Shell-скрипт тестов. forge test, fuzz, invariant, покрытие.
|Публичный API:
- ./test.sh [unit|fuzz|invariant|all]
|↙ ПОТРЕБЛЯЕТ:
- T.1.*, T.2.*, T.3.*, T.4.*, T.5.*, T.6.*, T.7.*
|↘ ПРЕДОСТАВЛЯЕТ:
- Отчёт покрытия
|Реализация: bash, запускает forge test с разными флагами.
|Примечания: ИЗМЕНЕНИЕ: добавлены T.7.* (utils). Проверяет покрытие ≥ 95%.

|S.2.01.03|Scripts|Shell|Shell|scripts/shell/deploy.sh|D.1.01.01|v.0.0.01|Draft|§14|
|Описание: Shell-скрипт деплоя. Обёртка над forge script.
|Публичный API:
- ./deploy.sh [amoy|mainnet]
|↙ ПОТРЕБЛЯЕТ:
- D.1.01.01 Deploy.s.sol
- D.2.01.03 .env
|↘ ПРЕДОСТАВЛЯЕТ:
- Развёрнутые контракты
|Реализация: bash, вызывает forge script с RPC из .env.
|Примечания: mainnet требует подтверждения.

|S.2.01.04|Scripts|Shell|Shell|scripts/shell/verify.sh|D.1.01.04|v.0.0.01|Draft|§14|
|Описание: Shell-скрипт верификации. Публикация исходников на Polygonscan.
|Публичный API:
- ./verify.sh <address> <contract>
|↙ ПОТРЕБЛЯЕТ:
- D.1.01.04 Verify.s.sol
|↘ ПРЕДОСТАВЛЯЕТ:
- Верифицированные контракты
|Реализация: bash, forge verify-contract.
|Примечания: Требует POLYGONSCAN_API_KEY.

|T.1.01.01|Tests|Unit|Solidity|test/unit/XartIAToken.t.sol|C.1.01.01, T.7.01.01|v.0.0.01|Draft|§13.1|
|Описание: Unit-тесты XartIAToken. mint, burnFrom, роли, события, allowance, граничные случаи.
|Публичный API:
- function test_mint() public
- function test_burnFrom() public
- function test_burnFrom_revert_no_allowance() public
- function test_roles() public
- function test_grantRole() public
- function test_revert_unauthorized() public
|↙ ПОТРЕБЛЯЕТ:
- C.1.01.01 XartIAToken
- T.7.01.01 TestHelpers
|↘ ПРЕДОСТАВЛЯЕТ:
- Подтверждение корректности токена
|Реализация: Foundry Test. Использует vm.prank, vm.expectRevert.
|Примечания: НОВОЕ: тест на burnFrom без allowance — должен revert. Покрытие 100%.

|T.1.01.02|Tests|Unit|Solidity|test/unit/CurveMath.t.sol|C.2.01.01, T.7.01.01|v.0.0.01|Draft|§13.1|
|Описание: Unit-тесты CurveMath. P(S), R(S), deltaSForBuy, amountForRedeem, границы уровней.
|Публичный API:
- function test_P() public
- function test_R() public
- function test_deltaSForBuy() public
- function test_amountForRedeem() public
- function test_boundaries() public
|↙ ПОТРЕБЛЯЕТ:
- C.2.01.01 CurveMath
- T.7.01.01 TestHelpers
|↘ ПРЕДОСТАВЛЯЕТ:
- Подтверждение математики
|Реализация: Foundry Test.
|Примечания: Проверка против Python-модели.

|T.1.01.03|Tests|Unit|Solidity|test/unit/CurveController.t.sol|C.3.01.01, T.7.01.01, T.7.01.02|v.0.0.06|Draft|§13.1|
|Описание: Unit-тесты CurveController. Включая тесты на effectiveMinimalX6(), pull-модель buyFromCurveFor, симметричный коридор, гейт инициализации, immutable poolController, genesis-исключение MAX_CURVE_FOR_PCT, нормализацию X_18, sellTeamFee.
|Публичный API:
- function test_buyFromCurve() public
- function test_buyFromCurve_buyFee() public
- function test_buyFromCurve_minOut() public
- function test_buyFromCurve_minOut_zero() public
- function test_buyFromCurve_maxPurchasePct() public
- function test_buyFromCurve_genesis_no_maxPct() public
- function test_buyFromCurve_effectiveMinimalX6_enforced() public
- function test_buyFromCurve_maxBalance() public
- function test_buyFromCurve_teamTokens_order() public
- function test_buyFromCurve_revert_not_initialized() public
- function test_buyFromCurve_raises_poolPrice_floor() public
- function test_redeemFromCurve() public
- function test_redeemFromCurve_redeemFee() public
- function test_redeemFromCurve_earlySellFee() public
- function test_redeemFromCurve_revert_not_initialized() public
- function test_redeemFromCurve_applies_ceiling_and_floor() public
- function test_redeemFromCurve_sellTeamFee() public
- function test_redeemFromCurve_sellTeamFee_zero() public
- function test_redeemFromCurve_sellTeamFee_treasury_balance() public
- function test_redeemFromCurve_sellTeamFee_max_bound() public
- function test_redeemFromCurve_sellTeamFee_with_earlySellFee() public
- function test_redeemFromCurve_fee_decomposition() public
- function test_redeemFromCurve_reserve_invariant_with_sellTeamFee() public
- function test_setSellTeamFee() public
- function test_setSellTeamFee_bounds() public
- function test_setSellTeamFee_emit() public
- function test_setSellTeamFee_revert_unauthorized() public
- function test_buyFromCurveFor() public
- function test_buyFromCurveFor_minOut() public
- function test_buyFromCurveFor_no_minimalPurchase() public
- function test_buyFromCurveFor_buyEvent_usdcIn() public
- function test_buyFromCurveFor_revert_not_initialized() public
- function test_buyFromCurveFor_raises_poolPrice_floor() public
- function test_buyFromCurveFor_pulls_usdc() public
- function test_buyFromCurveFor_revert_no_approve() public
- function test_buyFromCurveFor_revert_unauthorized_sender() public
- function test_buyFromCurveFor_revert_max_curve_for_exceeded() public
- function test_buyFromCurveFor_genesis_no_max_curve_for() public
- function test_buyFromCurveFor_rounding_invariant_holds() public
- function test_buyFromCurveFor_limit_applies_to_normalized_X18() public
- function test_buyFromCurveFor_limit_epsilon_bypass_blocked() public
- function test_setPoolController_one_time() public
- function test_setLastBuyTime_revert_unauthorized() public
- function test_effectiveMinimalX6_default() public
- function test_effectiveMinimalX6_zero_fee() public
- function test_effectiveMinimalX6_max_fee() public
- function test_effectiveMinimalX6_monotonic() public
- function test_S_curve_proxy() public
- function test_reserve_proxy() public
|↙ ПОТРЕБЛЯЕТ:
- C.3.01.01 CurveController
- T.7.01.01 TestHelpers
- T.7.01.02 MockUSDC
|↘ ПРЕДОСТАВЛЯЕТ:
- Подтверждение контроллера
|Реализация: Foundry Test.
test_redeemFromCurve_sellTeamFee:
  (1) sellTeamFee = 10 (0.1%)
  (2) user покупает X_6 = 1000e6 → получает токены
  (3) warp past earlySellPeriod (если > 0)
  (4) user redeemFromCurve(deltaS)
  (5) проверить: user_amount_18 = amount_18 − redeemFee − 0 − sellTeamFee
  (6) проверить: treasury balance увеличился на toUSDC(sell_team_fee_18)
test_redeemFromCurve_sellTeamFee_zero:
  (1) setSellTeamFee(0)
  (2) redeemFromCurve — treasury не получает ничего
test_redeemFromCurve_sellTeamFee_treasury_balance:
  (1) treasuryBefore = balanceOf(treasury)
  (2) redeemFromCurve
  (3) treasuryAfter − treasuryBefore == toUSDC(amount_18 * sellTeamFee / BP)
test_redeemFromCurve_sellTeamFee_max_bound:
  (1) setSellTeamFee(50) — успех
  (2) setSellTeamFee(51) — vm.expectRevert(OutOfBounds)
test_redeemFromCurve_sellTeamFee_with_earlySellFee:
  (1) setEarlySellFee(100), setEarlySellPeriod(1 days)
  (2) сразу redeemFromCurve после покупки (early)
  (3) user_amount = amount_18 − redeemFee − earlyFee − sellTeamFee
test_redeemFromCurve_fee_decomposition:
  (1) amount_18 = 10000e18
  (2) redeemFee = 50, earlySellFee = 0, sellTeamFee = 10
  (3) redeem_fee = 50e18, sell_team_fee = 10e18
  (4) user_amount = 10000e18 − 50e18 − 0 − 10e18 = 9940e18
  (5) проверить: reserve_new = reserve_old − 10000e18 + 50e18 (redeemFee остаётся)
  (6) treasury += 10e18
test_redeemFromCurve_reserve_invariant_with_sellTeamFee:
  (1) reserveBefore = reserveManager.reserve()
  (2) curveBackingBefore = reserveManager.curveBacking()
  (3) redeemFromCurve с sellTeamFee
  (4) reserveAfter = reserveManager.reserve()
  (5) curveBackingAfter = reserveManager.curveBacking()
  (6) assertGe(reserveAfter, curveBackingAfter)
  (7) assertEq(reserveBefore − reserveAfter, amount_18 − redeemFee_18)
test_setSellTeamFee:
  (1) setSellTeamFee(20)
  (2) assertEq(sellTeamFee(), 20)
test_setSellTeamFee_bounds:
  (1) setSellTeamFee(0) — успех
  (2) setSellTeamFee(50) — успех
  (3) setSellTeamFee(51) — vm.expectRevert(OutOfBounds)
test_setSellTeamFee_emit:
  (1) vm.expectEmit()
  (2) emit SellTeamFeeUpdated(old, new)
  (3) setSellTeamFee(new)
test_setSellTeamFee_revert_unauthorized:
  (1) vm.prank(randomAddress)
  (2) vm.expectRevert(Unauthorized)
  (3) setSellTeamFee(20)
|Примечания: ИСПРАВЛЕНО 13-я ИТЕРАЦИЯ (ревизия 5): тесты конструктора test_constructor_sets_treasury и test_constructor_revert_treasury_zero перенесены в T.1.01.23 CurveControllerConstructor.t.sol. Ранее они были в этом файле, что нарушало структуру — для PoolController все конструктор-тесты в T.1.01.24, а для CurveController были разбросаны. Версия поднята с v.0.0.05 до v.0.0.06.
НОВОЕ 13-я ИТЕРАЦИЯ: тесты на sellTeamFee (базовый, zero, treasury balance, max bound, взаимодействие с earlySellFee, декомпозиция, проверка инварианта reserve), тесты на setSellTeamFee.

|T.1.01.04|Tests|Unit|Solidity|test/unit/PoolController.t.sol|C.3.01.02, T.7.01.01, T.7.01.02, T.7.01.06|v.0.0.06|Draft|§13.1|
|Описание: Unit-тесты PoolController. Единая семантика minP. Pull-модель в каскаде. fee_18 → reserveManager. Sweep-dust. sellTeamFee.
|Публичный API:
- function test_buyFromPool() public
- function test_buyFromPool_buyFee() public
- function test_buyFromPool_cascade() public
- function test_buyFromPool_cascade_empty_pool_success() public
- function test_buyFromPool_partial_pool_no_revert() public
- function test_buyFromPool_event_newScurve_withCascade() public
- function test_buyFromPool_event_newScurve_withoutCascade() public
- function test_buyFromPool_tokensFromCurve_assigned() public
- function test_buyFromPool_zero_poolPrice_revert() public
- function test_buyFromPool_revert_not_initialized() public
- function test_buyFromPool_effectiveMinimalX6_revert() public
- function test_buyFromPool_effectiveMinimalX6_pass() public
- function test_buyFromPool_no_cascade_updates_lastBuyTime() public
- function test_buyFromPool_cascade_updates_lastBuyTime() public
- function test_buyFromPool_cascade_approves_curve() public
- function test_buyFromPool_cascade_pulls_usdc() public
- function test_buyFromPool_cascade_allowance_reset() public
- function test_buyFromPool_fee_to_reserve() public
- function test_buyFromPool_empty_pool_fee_to_reserve() public
- function test_buyFromPool_full_pool_fee_to_reserve() public
- function test_buyFromPool_fee_decomposition() public
- function test_buyFromPool_zero_balance_after_tx() public
- function test_buyFromPool_dust_swept() public
- function test_buyFromPool_dust_accumulation_1000_tx() public
- function test_effectiveMinimalX6_proxy() public
- function test_sellToPool() public
- function test_sellToPool_redeemFee() public
- function test_sellToPool_sellTeamFee() public
- function test_sellToPool_sellTeamFee_zero() public
- function test_sellToPool_sellTeamFee_treasury_balance() public
- function test_sellToPool_sellTeamFee_reads_from_curve() public
- function test_sellToPool_fee_decomposition_with_sellTeamFee() public
- function test_sellToPool_freeReserve_check_includes_sellTeamFee() public
- function test_sellToPool_maxSellPctPerDay() public
- function test_sellToPool_dailyReset() public
- function test_sellToPool_freeReserve_insufficient() public
- function test_sellToPool_minOut() public
- function test_sellToPool_zero_poolPrice_revert() public
- function test_sellToPool_revert_not_initialized() public
- function test_sellToPool_zero_amount_revert() public
- function test_circuitBreaker_trigger_emit() public
- function test_buyFromPool_maxBalance_exceeded() public
|↙ ПОТРЕБЛЯЕТ:
- C.3.01.02 PoolController
- C.3.01.01 CurveController
- T.7.01.01 TestHelpers
- T.7.01.02 MockUSDC
- T.7.01.06 TimeHelpers
|↘ ПРЕДОСТАВЛЯЕТ:
- Подтверждение пула
|Реализация: Foundry Test.
test_sellToPool_sellTeamFee:
  (1) curveController.setSellTeamFee(10)
  (2) user имеет токены
  (3) sellToPool(deltaP)
  (4) amount_gross = deltaP * poolPrice / PRECISION
  (5) fee = amount_gross * redeemFee / BP
  (6) sell_team_fee = amount_gross * sellTeamFee / BP
  (7) user_amount = amount_gross − fee − sell_team_fee
  (8) проверить: user получил user_amount
  (9) проверить: treasury получил sell_team_fee
test_sellToPool_sellTeamFee_zero:
  (1) setSellTeamFee(0)
  (2) sellToPool — treasury не получает
test_sellToPool_sellTeamFee_treasury_balance:
  (1) treasuryBefore = balanceOf(treasury)
  (2) sellToPool
  (3) treasuryAfter − treasuryBefore == toUSDC(sell_team_fee_18)
test_sellToPool_sellTeamFee_reads_from_curve:
  (1) curveController.setSellTeamFee(20)
  (2) sellToPool использует 20 bp
  (3) setSellTeamFee(30) через curveController
  (4) следующий sellToPool использует 30 bp
test_sellToPool_fee_decomposition_with_sellTeamFee:
  (1) amount_gross = 10000e18, redeemFee = 50, sellTeamFee = 10
  (2) redeem_fee = 50e18, sell_team_fee = 10e18
  (3) user_amount = 10000e18 − 50e18 − 10e18 = 9940e18
  (4) reserve: −9940e18 (user) −10e18 (treasury) = −9950e18 = −(amount_gross − redeem_fee)
  (5) R(S) unchanged
test_sellToPool_freeReserve_check_includes_sellTeamFee:
  (1) freeReserve = amount_user_18 + sell_team_fee_18 − 1
  (2) vm.expectRevert(InsufficientFreeReserve)
  (3) sellToPool
  (4) freeReserve = amount_user_18 + sell_team_fee_18
  (5) sellToPool — успех
|Примечания: ИСПРАВЛЕНО 13-я ИТЕРАЦИЯ (ревизия 5): тесты конструктора test_constructor_sets_treasury и test_constructor_revert_treasury_zero удалены из этого файла — они дублировались с T.1.01.24 PoolControllerConstructor.t.sol. Единая структура: все конструктор-тесты в *Constructor.t.sol. Версия поднята с v.0.0.05 до v.0.0.06.
НОВОЕ 13-я ИТЕРАЦИЯ: тесты на sellTeamFee в sellToPool, чтение через curveController, декомпозиция, проверка freeReserve.

|T.1.01.05|Tests|Unit|Solidity|test/unit/ReserveManager.t.sol|C.4.01.01, T.7.01.01, T.7.01.02|v.0.0.01|Draft|§13.1|
|Описание: Unit-тесты ReserveManager. updateScurve, pay, checkInvariant, curveBacking, S_curve, revert. Все значения в 18-dec.
|Публичный API:
- function test_updateScurve() public
- function test_updateScurve_revert_invariant() public
- function test_pay() public
- function test_pay_revert_unauthorized() public
- function test_pay_revert_insufficient() public
- function test_freeReserve_no_underflow() public
- function test_curveBacking() public
- function test_curveBacking_18_dec() public                    // НОВОЕ: проверка единиц
- function test_reserve_18_dec() public                         // НОВОЕ: reserve() возвращает 18-dec
- function test_S_curve_proxy() public
- function test_constructor_sets_levels() public                // НОВОЕ
- function test_revert_no_receive() public
|↙ ПОТРЕБЛЯЕТ:
- C.4.01.01 ReserveManager
- T.7.01.01 TestHelpers
- T.7.01.02 MockUSDC
|↘ ПРЕДОСТАВЛЯЕТ:
- Подтверждение резерва
|Реализация: Foundry Test.
|Примечания: НОВОЕ: тесты на единицы измерения (reserve/curveBacking в 18-dec). НОВОЕ: test_constructor_sets_levels.

|T.1.01.06|Tests|Unit|Solidity|test/unit/Vesting.t.sol|C.5.01.01, T.7.01.01, T.7.01.06|v.0.0.01|Draft|§13.1|
|Описание: Unit-тесты Vesting.
|Публичный API:
- function test_constructor_sets_beneficiary() public
- function test_constructor_sets_cliff() public
- function test_constructor_sets_duration() public
- function test_addTokens() public
- function test_addTokens_revert_unauthorized() public
- function test_addTokens_revert_insufficient_balance() public
- function test_addTokens_first_sets_vestingStart() public
- function test_addTokens_multiple_share_schedule() public
- function test_release() public
- function test_release_revert_zero() public                          // НОВОЕ: releasable() == 0 → revert
- function test_release_after_cliff() public
- function test_cliff() public
- function test_linear_vesting() public
|↙ ПОТРЕБЛЯЕТ:
- C.5.01.01 Vesting
- T.7.01.01 TestHelpers
- T.7.01.06 TimeHelpers
|↘ ПРЕДОСТАВЛЯЕТ:
- Подтверждение вестинга
|Реализация: Foundry Test.
test_release_revert_zero:
  (1) addTokens(1000e18) — vestingStart = now
  (2) сразу release() без warp
  (3) vm.expectRevert(InvalidAmount)
  (4) vesting.release()
|Примечания: НОВОЕ: test_release_revert_zero — проверяет require(amount > 0, InvalidAmount) в release(). До cliff vestedAmount() == 0 → releasable() == 0 → revert.

|T.1.01.07|Tests|Unit|Solidity|test/unit/CircuitBreaker.t.sol|C.6.01.01, C.4.01.01, T.7.01.01, T.7.01.02|v.0.0.01|Draft|§13.1|
|Описание: Unit-тесты CircuitBreaker.
|Публичный API:
- function test_constructor_sets_threshold() public
- function test_constructor_sets_reserveManager() public          // НОВОЕ
- function test_constructor_revert_invalid_bounds() public
- function test_active_below_threshold() public
- function test_active_above_threshold() public
- function test_setThreshold() public
- function test_setThreshold_emit() public
- function test_setThreshold_revert_bounds() public
- function test_zero_reserve() public
- function test_freeReserve_underflow() public
|↙ ПОТРЕБЛЯЕТ:
- C.6.01.01 CircuitBreaker
- C.4.01.01 ReserveManager
- T.7.01.01 TestHelpers
- T.7.01.02 MockUSDC
|↘ ПРЕДОСТАВЛЯЕТ:
- Подтверждение CB
|Реализация: Foundry Test.
|Примечания: НОВОЕ: test_constructor_sets_reserveManager. Зависимость C.4.01.01 и T.7.01.02 добавлена для тестов, читающих reserve/freeReserve.

|T.1.01.08|Tests|Unit|Solidity|test/unit/Governance.t.sol|C.7.01.01, T.7.01.01, T.7.01.03|v.0.0.02|Draft|§13.1|
|Описание: Unit-тесты Governance. propose, execute, cancel, timelock, иммутабельность.
|Публичный API:
- function test_propose() public
- function test_execute() public
- function test_cancel() public
- function test_timelock() public
- function test_immutability() public
|↙ ПОТРЕБЛЯЕТ:
- C.7.01.01 Governance
- C.7.01.02 Timelock
- C.2.01.03 Constants (TIMELOCK_DELAY)
- T.7.01.01 TestHelpers
- T.7.01.03 MockSafe
|↘ ПРЕДОСТАВЛЯЕТ:
- Подтверждение governance
|Реализация: Foundry Test. Использует TIMELOCK_DELAY из Constants (7 days), не хардкодит 48 hours.
|Примечания: ИСПРАВЛЕНО 12-я ИТЕРАЦИЯ: комментарий «Проверка 48-часовой задержки» устарел — TIMELOCK_DELAY = 7 days (11-я итерация). Тест использует константу из Constants, не хардкод.

|T.1.01.09|Tests|Unit|Solidity|test/unit/LevelMath.t.sol|C.2.01.02, T.7.01.01|v.0.0.01|Draft|§13.1|
|Описание: Unit-тесты LevelMath. a_i, b_i, P_i, R_i, границы уровня.
|Публичный API:
- function test_a() public
- function test_b() public
- function test_P_i() public
- function test_R_i() public
- function test_inBounds() public
|↙ ПОТРЕБЛЯЕТ:
- C.2.01.02 LevelMath
- T.7.01.01 TestHelpers
|↘ ПРЕДОСТАВЛЯЕТ:
- Подтверждение математики уровня
|Реализация: Foundry Test.
|Примечания: Проверка границ.

|T.1.01.10|Tests|Unit|Solidity|test/unit/Constants.t.sol|C.2.01.03, T.7.01.01|v.0.0.01|Draft|§13.1|
|Описание: Unit-тесты Constants. Значения, иммутабельность.
|Публичный API:
- function test_values() public
|↙ ПОТРЕБЛЯЕТ:
- C.2.01.03 Constants
- T.7.01.01 TestHelpers
|↘ ПРЕДОСТАВЛЯЕТ:
- Подтверждение констант
|Реализация: Foundry Test.
|Примечания: Проверка PRECISION, BASIS_POINTS.

|T.1.01.11|Tests|Unit|Solidity|test/unit/Levels.t.sol|C.2.01.09, T.7.01.01|v.0.0.01|Draft|§13.1|
|Описание: Unit-тесты Levels. getLevel, getBounds, getMaxBalance, инициализация.
|Публичный API:
- function test_getLevel() public
- function test_getBounds() public
- function test_getMaxBalance() public
- function test_init() public
- function test_reinit_revert() public
|↙ ПОТРЕБЛЯЕТ:
- C.2.01.09 Levels
- T.7.01.01 TestHelpers
|↘ ПРЕДОСТАВЛЯЕТ:
- Подтверждение таблицы уровней
|Реализация: Foundry Test.
|Примечания: Проверка однократной инициализации.

|T.1.01.12|Tests|Unit|Solidity|test/unit/Timelock.t.sol|C.7.01.02, T.7.01.01, T.7.01.06|v.0.0.02|Draft|§13.1|
|Описание: Unit-тесты Timelock. Включая CallFailed и InvalidParam для target без кода. Проверка TIMELOCK_DELAY = 7 days.
|Публичный API:
- function test_queue() public
- function test_queue_revert_already_queued() public
- function test_queue_revert_target_no_code() public
- function test_execute_clears_entry() public
- function test_execute_revert_not_queued() public
- function test_execute_revert_call_failed() public
- function test_execute_revert_target_no_code() public
- function test_cancel_clears_entry() public
- function test_cancel_revert_not_queued() public
- function test_delay() public
- function test_queue_after_execute() public
|↙ ПОТРЕБЛЯЕТ:
- C.7.01.02 Timelock
- C.2.01.03 Constants (TIMELOCK_DELAY)
- T.7.01.01 TestHelpers
- T.7.01.06 TimeHelpers
- T.7.01.10 CallFailTarget
|↘ ПРЕДОСТАВЛЯЕТ:
- Подтверждение Timelock
|Реализация: Foundry Test.
test_delay:
  (1) assertEq(timelock.delay(), TIMELOCK_DELAY)
  (2) assertEq(TIMELOCK_DELAY, 7 days)
test_queue_revert_target_no_code:
  vm.expectRevert(InvalidParam)
  timelock.queue(param, 100, address(EOA), someSelector)
test_execute_revert_target_no_code:
  (1) queue с валидным target
  (2) vm.etch(address(target), "")   // симулируем потерю кода
  (3) warp для прохождения delay
  (4) vm.expectRevert(InvalidParam)
  (5) timelock.execute(param)
|Примечания: НОВОЕ 7-я ИТЕРАЦИЯ: добавлены тесты на target.code.length == 0. vm.etch(target, "") — стандартный способ Foundry для симуляции потери кода. На Polygon PoS после Dencun selfdestruct не удаляет код, поэтому vm.etch — единственный рабочий способ.

|T.1.01.13|Tests|Unit|Solidity|test/unit/XartIAFactory.t.sol|C.8.01.01, C.0.01.01, T.7.01.01, T.7.01.03|v.0.0.03|Draft|§13.1|
|Описание: Unit-тесты XartIAFactory. Проверяет deploy с отказами (safe=EOA, treasury=EOA, threshold вне bounds), setPoolController, initializePoolPrice с двусторонними bounds, finalize.
|Публичный API:
- function test_deploy() public
- function test_deploy_with_args() public
- function test_deploy_returns_three_addresses() public
- function test_deploy_stores_state_variables() public
- function test_deploy_initial_params_set() public
- function test_deploy_calls_setPoolController() public
- function test_deploy_sets_treasury() public                                         // НОВОЕ
- function test_deploy_sets_sellTeamFee_default() public                              // НОВОЕ
- function test_deploy_revert_safe_is_eoa() public
- function test_deploy_revert_safe_is_zero() public
- function test_deploy_revert_safe_is_this() public
- function test_deploy_revert_usdc_is_zero() public
- function test_deploy_revert_treasury_is_eoa() public                                // НОВОЕ
- function test_deploy_revert_treasury_is_zero() public                               // НОВОЕ
- function test_deploy_revert_treasury_is_this() public                               // НОВОЕ
- function test_deploy_revert_threshold_out_of_bounds() public
- function test_initializeLevels() public
- function test_initializeLevels_revert_after_finalize() public
- function test_initializeLevels_revert_not_owner() public
- function test_initializePoolPrice() public
- function test_initializePoolPrice_revert_empty_levels() public
- function test_initializePoolPrice_revert_zero_P_S0() public
- function test_initializePoolPrice_revert_nonzero_Scurve() public
- function test_initializePoolPrice_revert_below_lower_bound() public
- function test_initializePoolPrice_revert_above_upper_bound() public
- function test_initializePoolPrice_pass_at_lower_bound() public
- function test_initializePoolPrice_pass_at_upper_bound() public
- function test_registerParams() public
- function test_registerParams_sellTeamFee_bounds() public                             // НОВОЕ
- function test_finalize() public
- function test_finalize_allOwnables() public
- function test_finalize_revokes_roles() public
- function test_finalize_revokes_default_admin_from_factory() public
- function test_finalize_transfers_curveController_ownership() public                 // НОВОЕ
- function test_finalize_revert_safe_is_eoa() public
- function test_finalize_revert_safe_not_admin() public
- function test_finalize_revert_safe_not_pauser() public
- function test_finalize_emit() public
- function test_deploy_emits_event() public
|↙ ПОТРЕБЛЯЕТ:
- C.8.01.01 XartIAFactory
- C.0.01.01 Roles
- C.2.01.04 Errors (InvalidAddress, OutOfBounds, InvalidParam)
- C.2.01.03 Constants (PARAM_SELL_TEAM_FEE)
- T.7.01.01 TestHelpers
- T.7.01.03 MockSafe
- OpenZeppelin: IAccessControl
|↘ ПРЕДОСТАВЛЯЕТ:
- Подтверждение фабрики
|Реализация: Foundry Test.
test_deploy_sets_treasury:
  (1) factory.deploy(safe, treasury, 1000, usdc)
  (2) assertEq(factory.treasury(), treasury)
  (3) assertEq(curveController.treasury(), treasury)
  (4) assertEq(poolController.treasury(), treasury)
test_deploy_sets_sellTeamFee_default:
  (1) factory.deploy(...)
  (2) assertEq(curveController.sellTeamFee(), 10)
test_deploy_revert_treasury_is_eoa:
  (1) vm.expectRevert(InvalidAddress)
  (2) factory.deploy(safe, eoa, 1000, usdc)
test_deploy_revert_treasury_is_zero:
  (1) vm.expectRevert(InvalidAddress)
  (2) factory.deploy(safe, address(0), 1000, usdc)
test_deploy_revert_treasury_is_this:
  (1) vm.expectRevert(InvalidAddress)
  (2) factory.deploy(safe, address(factory), 1000, usdc)
test_registerParams_sellTeamFee_bounds:
  (1) factory.registerParams()
  (2) ParamInfo info = registry.get(PARAM_SELL_TEAM_FEE)
  (3) assertEq(info.target, curveController)
  (4) assertEq(info.setter, ICurveController.setSellTeamFee.selector)
  (5) assertEq(info.min, 0)
  (6) assertEq(info.max, 50)
test_finalize_transfers_curveController_ownership:
  (1) factory.finalize(safe)
  (2) assertEq(IOwnable(curveController).owner(), safe)
|Примечания: НОВОЕ 13-я ИТЕРАЦИЯ: добавлены тесты на treasury (валидация, проброс в контроллеры), default sellTeamFee = 10, registerParams для PARAM_SELL_TEAM_FEE, ownership CurveController после finalize.

|T.1.01.14|Tests|Unit|Solidity|test/unit/MathLib.t.sol|C.9.01.01, T.7.01.01|v.0.0.01|Draft|§13.1|
|Описание: Unit-тесты MathLib. mulDiv (округление вверх/вниз), sqrt, min, max.
|Публичный API:
- function test_mulDiv() public
- function test_mulDivUp() public
- function test_sqrt() public
- function test_min_max() public
|↙ ПОТРЕБЛЯЕТ:
- C.9.01.01 MathLib
- T.7.01.01 TestHelpers
|↘ ПРЕДОСТАВЛЯЕТ:
- Подтверждение утилит
|Реализация: Foundry Test.
|Примечания: Проверка округления.

|T.1.01.15|Tests|Unit|Solidity|test/unit/PrecisionLib.t.sol|C.9.01.02, T.7.01.01|v.0.0.01|Draft|§13.1|
|Описание: Unit-тесты PrecisionLib. Конвертация 18↔6 decimals, потеря точности.
|Публичный API:
- function test_toUSDC() public
- function test_fromUSDC() public
- function test_precision_loss() public
|↙ ПОТРЕБЛЯЕТ:
- C.9.01.02 PrecisionLib
- T.7.01.01 TestHelpers
|↘ ПРЕДОСТАВЛЯЕТ:
- Подтверждение конвертации
|Реализация: Foundry Test.
|Примечания: Проверка потери точности.

|T.1.01.16|Tests|Unit|Solidity|test/unit/Errors.t.sol|C.0.01.02, C.2.01.04, C.2.01.09, C.2.01.12, C.3.01.01, C.4.01.01, C.5.01.01, C.7.01.02, C.8.01.01, T.7.01.01, T.7.01.09|v.0.0.01|Draft|§13.1|
|Описание: Параметризованные unit-тесты Errors. Включая NotOwner, SafeNotAdmin, SafeNotPauser.
|Публичный API:
- function test_InvalidAmount() public
- function test_InvalidLevel() public
- function test_InvalidAddress() public
- function test_InvalidParam() public
- function test_OutOfBounds() public
- function test_ReserveInvariantViolation() public
- function test_InsufficientFreeReserve() public
- function test_InsufficientReserve() public
- function test_InsufficientVestingBalance() public
- function test_CircuitBreakerActive() public
- function test_MathOverflow() public                              // через T.7.01.09 ErrorsWrapper
- function test_Unauthorized() public
- function test_MaxBalanceExceeded() public
- function test_MaxPurchaseExceeded() public
- function test_MaxSellPerDayExceeded() public
- function test_MinimalPurchaseNotMet() public
- function test_DeadlineExpired() public
- function test_SlippageExceeded() public
- function test_AlreadyInitialized_Levels() public             // C.2.01.09
- function test_AlreadyInitialized_PoolState() public          // C.2.01.12
- function test_AlreadyInitialized_Registry() public           // C.0.01.02
- function test_NotOwner() public                              // на C.8.01.01 initializeLevels
- function test_SafeNotAdmin() public                          // на C.8.01.01 finalize
- function test_SafeNotPauser() public                         // на C.8.01.01 finalize
- function test_NotQueued() public                             // на C.7.01.02 Timelock
- function test_AlreadyQueued() public                         // на C.7.01.02 Timelock
- function test_CallFailed() public                            // на C.7.01.02 Timelock (через T.7.01.10)
|↙ ПОТРЕБЛЯЕТ:
- C.0.01.02 ParameterRegistry
- C.2.01.04 Errors
- C.2.01.09 Levels
- C.2.01.12 PoolState
- C.3.01.01 CurveController
- C.4.01.01 ReserveManager
- C.5.01.01 Vesting
- C.7.01.02 Timelock
- C.8.01.01 XartIAFactory
- T.7.01.01 TestHelpers
- T.7.01.09 ErrorsWrapper
- T.7.01.10 CallFailTarget
|↘ ПРЕДОСТАВЛЯЕТ:
- Подтверждение каждой ошибки
|Реализация: Foundry Test. Для каждой ошибки указан конкретный контракт.
|Примечания: УДАЛЕНО: test_Paused — ошибка Paused удалена из C.2.01.04. Зависимости C.0.01.02, C.2.01.09, C.2.01.12 добавлены для тестов AlreadyInitialized.

|T.1.01.17|Tests|Unit|Solidity|test/unit/Events.t.sol|C.10.01.01, T.7.01.01|v.0.0.01|Draft|§13.1|
|Описание: Unit-тесты Events. Эмиссия событий с правильными параметрами.
|Публичный API:
- function test_events() public
|↙ ПОТРЕБЛЯЕТ:
- C.10.01.01 Events
- T.7.01.01 TestHelpers
|↘ ПРЕДОСТАВЛЯЕТ:
- Подтверждение событий
|Реализация: Foundry Test. vm.expectEmit.
|Примечания: Проверка всех событий.

|T.1.01.18|Tests|Unit|Solidity|test/unit/AccessControl.t.sol|C.0.01.01, C.1.01.01, C.3.01.01, C.3.01.02, C.4.01.01, C.5.01.01, C.6.01.01, C.7.01.01, C.8.01.01, C.8.01.02, T.7.01.01|v.0.0.02|Draft|§13.1|
|Описание: Unit-тесты AccessControl для всех ролей. Проверка, что только назначенные роли могут вызывать защищённые функции. Проверка, что после finalize у Factory нет ни одной роли. Проверка, что treasury не имеет ролей.
|Публичный API:
- function test_minter_role() public
- function test_burner_role() public
- function test_controller_role() public
- function test_governance_role() public
- function test_pauser_role() public
- function test_default_admin_role() public
- function test_revert_unauthorized_all() public
- function test_factory_has_no_roles_after_finalize() public
- function test_treasury_has_no_roles() public
|↙ ПОТРЕБЛЯЕТ:
- C.0.01.01 Roles
- C.1.01.01 XartIAToken
- C.3.01.01 CurveController
- C.3.01.02 PoolController
- C.4.01.01 ReserveManager
- C.5.01.01 Vesting
- C.6.01.01 CircuitBreaker
- C.7.01.01 Governance
- C.8.01.01 XartIAFactory
- C.8.01.02 IXartIAFactory                                                    // НОВОЕ
- T.7.01.01 TestHelpers
- OpenZeppelin: IAccessControl
|↘ ПРЕДОСТАВЛЯЕТ:
- Подтверждение безопасности ролей
|Реализация: Foundry Test.
test_factory_has_no_roles_after_finalize:
  (1) factory = deployFullSystemFinalized()
  (2) проверка всех ролей во всех 9 AccessControl-контрактах:
      assertFalse(IAccessControl(token).hasRole(MINTER_ROLE, address(factory)))
      assertFalse(IAccessControl(token).hasRole(BURNER_ROLE, address(factory)))
      assertFalse(IAccessControl(token).hasRole(DEFAULT_ADMIN_ROLE, address(factory)))
      assertFalse(IAccessControl(curveController).hasRole(GOVERNANCE_ROLE, address(factory)))
      assertFalse(IAccessControl(curveController).hasRole(PAUSER_ROLE, address(factory)))
      ... (все роли во всех 9 контрактах)
test_treasury_has_no_roles:
  (1) factory = deployFullSystemFinalized()
  (2) address treasury = IXartIAFactory(factory).treasury()
  (3) проверка всех ролей во всех 9 AccessControl-контрактах:
      assertFalse(IAccessControl(token).hasRole(MINTER_ROLE, treasury))
      assertFalse(IAccessControl(token).hasRole(BURNER_ROLE, treasury))
      assertFalse(IAccessControl(token).hasRole(DEFAULT_ADMIN_ROLE, treasury))
      assertFalse(IAccessControl(curveController).hasRole(GOVERNANCE_ROLE, treasury))
      assertFalse(IAccessControl(curveController).hasRole(PAUSER_ROLE, treasury))
      assertFalse(IAccessControl(curveController).hasRole(DEFAULT_ADMIN_ROLE, treasury))
      ... (все роли во всех 9 контрактах)
|Примечания: ИСПРАВЛЕНО 13-я ИТЕРАЦИЯ (ревизия 4):
- Добавлена зависимость C.8.01.02 IXartIAFactory в ↙ ПОТРЕБЛЯЕТ. Ранее test_treasury_has_no_roles использовал IXartIAFactory(factory).treasury(), но интерфейс не был указан в зависимостях — тест не скомпилировался бы.
- Версия поднята с v.0.0.01 до v.0.0.02 — синхронизация с добавлением test_treasury_has_no_roles в предыдущей ревизии.
НОВОЕ: test_factory_has_no_roles_after_finalize — комплексная проверка. После finalize у Factory не должно быть НИ ОДНОЙ роли ни в одном контракте. Это финальная линия обороны от потери управления.
НОВОЕ: test_treasury_has_no_roles — treasury не должен иметь ролей ни в одном контракте протокола.

|T.1.01.19|Tests|Unit|Solidity|test/unit/ParameterRegistry.t.sol|C.0.01.02, T.7.01.01|v.0.0.01|Draft|§13.1|
|Описание: Unit-тесты ParameterRegistry. register, get, isValid, повторная регистрация, bounds.
|Публичный API:
- function test_register() public
- function test_get() public
- function test_isValid() public
- function test_revert_unauthorized() public
- function test_revert_invalid_bounds() public
- function test_revert_duplicate() public
|↙ ПОТРЕБЛЯЕТ:
- C.0.01.02 ParameterRegistry
- T.7.01.01 TestHelpers
|↘ ПРЕДОСТАВЛЯЕТ:
- Подтверждение реестра
|Реализация: Foundry Test.
|Примечания: НОВОЕ: test_revert_duplicate — проверяет AlreadyInitialized при повторной регистрации.

|T.1.01.20|Tests|Unit|Solidity|test/unit/PoolState.t.sol|C.2.01.12, T.7.01.01|v.0.0.01|Draft|§13.1|
|Описание: Unit-тесты PoolState.
|Публичный API:
- function test_initializePoolPrice() public
- function test_initializePoolPrice_emit() public             // НОВОЕ
- function test_initializePoolPrice_revert_twice() public
- function test_initializePoolPrice_revert_zero() public
- function test_setPool_role() public
- function test_setPoolPrice_curve_role() public
- function test_setPoolPrice_pool_role() public
- function test_revert_unauthorized() public
|↙ ПОТРЕБЛЯЕТ:
- C.2.01.12 PoolState
- T.7.01.01 TestHelpers
|↘ ПРЕДОСТАВЛЯЕТ:
- Подтверждение PoolState
|Реализация: Foundry Test.
|Примечания: НОВОЕ: test_initializePoolPrice_emit — проверяет событие PoolPriceInitialized.

|T.1.01.21|Tests|Unit|Solidity|test/unit/TimelockGovernance.t.sol|C.7.01.01, C.7.01.02, T.7.01.01, T.7.01.03, T.7.01.06|v.0.0.01|Draft|§13.1|
|Описание: Integration-тест связки Governance + Timelock. Полный цикл propose → queue → execute.
|Публичный API:
- function test_full_cycle() public
- function test_cancel() public
- function test_delay_enforced() public
- function test_revert_unauthorized() public
|↙ ПОТРЕБЛЯЕТ:
- C.7.01.01 Governance
- C.7.01.02 Timelock
- T.7.01.01 TestHelpers
- T.7.01.03 MockSafe
- T.7.01.06 TimeHelpers
|↘ ПРЕДОСТАВЛЯЕТ:
- Подтверждение связки
|Реализация: Foundry Test. vm.warp для прохождения timelock.
|Примечания: НОВОЕ: критично для audit.

|T.1.01.23|Tests|Unit|Solidity|test/unit/CurveControllerConstructor.t.sol|C.3.01.01, T.7.01.01|v.0.0.02|Draft|§13.1|
|Описание: Unit-тесты конструктора CurveController. Все immutable поля, включая usdc и treasury.
|Публичный API:
- function test_constructor_sets_reserveManager() public
- function test_constructor_sets_vesting() public
- function test_constructor_sets_circuitBreaker() public
- function test_constructor_sets_poolState() public
- function test_constructor_sets_token() public
- function test_constructor_sets_levels() public
- function test_constructor_sets_usdc() public
- function test_constructor_sets_treasury() public                              // НОВОЕ
- function test_constructor_revert_treasury_zero() public                       // НОВОЕ
|↙ ПОТРЕБЛЯЕТ:
- C.3.01.01 CurveController
- T.7.01.01 TestHelpers
|↘ ПРЕДОСТАВЛЯЕТ:
- Подтверждение immutable полей
|Реализация: Foundry Test.
test_constructor_sets_treasury:
  (1) new CurveController(..., mockTreasury)
  (2) assertEq(curveController.treasury(), mockTreasury)
test_constructor_revert_treasury_zero:
  (1) vm.expectRevert(InvalidAddress)
  (2) new CurveController(..., address(0))
|Примечания: ИСПРАВЛЕНО 13-я ИТЕРАЦИЯ (ревизия 5): добавлены test_constructor_sets_treasury и test_constructor_revert_treasury_zero, перенесённые из T.1.01.03. Единая структура: все конструктор-тесты в *Constructor.t.sol. Версия поднята с v.0.0.01 до v.0.0.02.
НОВОЕ: test_constructor_sets_usdc.

|T.1.01.24|Tests|Unit|Solidity|test/unit/PoolControllerConstructor.t.sol|C.3.01.02, T.7.01.01|v.0.0.02|Draft|§13.1|
|Описание: Unit-тесты конструктора PoolController. Все immutable поля, включая usdc и treasury.
|Публичный API:
- function test_constructor_sets_curveController() public
- function test_constructor_sets_reserveManager() public
- function test_constructor_sets_circuitBreaker() public
- function test_constructor_sets_poolState() public
- function test_constructor_sets_token() public
- function test_constructor_sets_usdc() public
- function test_constructor_sets_treasury() public                              // НОВОЕ
- function test_constructor_revert_treasury_zero() public                       // НОВОЕ
- function test_constructor_sets_levels() public
|↙ ПОТРЕБЛЯЕТ:
- C.3.01.02 PoolController
- T.7.01.01 TestHelpers
|↘ ПРЕДОСТАВЛЯЕТ:
- Подтверждение immutable полей
|Реализация: Foundry Test.
|Примечания: ИСПРАВЛЕНО 13-я ИТЕРАЦИЯ (ревизия 3): добавлены test_constructor_sets_treasury и test_constructor_revert_treasury_zero. Ранее в 13-й итерации файл был потерян при редактировании.

|T.1.01.25|Tests|Unit|Solidity|test/unit/VestingConstructor.t.sol|C.5.01.01, T.7.01.01|v.0.0.01|Draft|§13.1|
|Описание: Unit-тесты конструктора Vesting.
|Публичный API:
- function test_constructor_sets_beneficiary() public
- function test_constructor_sets_token() public
- function test_constructor_sets_cliff() public
- function test_constructor_sets_duration() public
|↙ ПОТРЕБЛЯЕТ:
- C.5.01.01 Vesting
- T.7.01.01 TestHelpers
|↘ ПРЕДОСТАВЛЯЕТ:
- Подтверждение immutable полей
|Реализация: Foundry Test.
|Примечания: НОВОЕ.

|T.2.01.01|Tests|Fuzz|Solidity|test/fuzz/FuzzCurve.t.sol|C.3.01.01, T.7.01.01, T.7.01.02|v.0.0.01|Draft|§13.2|
|Описание: Fuzz-тесты CurveController. 10 000+ сценариев buyFromCurve, redeemFromCurve, buyFromCurveFor.
|Публичный API:
- function testFuzz_buy(uint256 X) public
- function testFuzz_redeem(uint256 deltaS) public
- function testFuzz_buyFor(uint256 X) public
|↙ ПОТРЕБЛЯЕТ:
- C.3.01.01 CurveController
- T.7.01.01 TestHelpers
- T.7.01.02 MockUSDC
|↘ ПРЕДОСТАВЛЯЕТ:
- Отчёт по случайным сценариям
|Реализация: Foundry Fuzz. runs=10000.
|Примечания: НОВОЕ: testFuzz_buyFor.

|T.2.01.02|Tests|Fuzz|Solidity|test/fuzz/FuzzPool.t.sol|C.3.01.02, T.7.01.01, T.7.01.02|v.0.0.01|Draft|§13.2|
|Описание: Fuzz-тесты PoolController. 10 000+ сценариев buyFromPool и sellToPool.
|Публичный API:
- function testFuzz_buyPool(uint256 X) public
- function testFuzz_sellPool(uint256 deltaP) public
|↙ ПОТРЕБЛЯЕТ:
- C.3.01.02 PoolController
- T.7.01.01 TestHelpers
- T.7.01.02 MockUSDC
|↘ ПРЕДОСТАВЛЯЕТ:
- Отчёт по случайным сценариям
|Реализация: Foundry Fuzz.
|Примечания: Проверка poolPrice, freeReserve.

|T.2.01.03|Tests|Fuzz|Solidity|test/fuzz/FuzzLevels.t.sol|C.2.01.09, T.7.01.01|v.0.0.01|Draft|§13.2|
|Описание: Fuzz-тесты Levels. Случайные S_curve на границах уровней.
|Публичный API:
- function testFuzz_boundaries(uint256 S) public
|↙ ПОТРЕБЛЯЕТ:
- C.2.01.09 Levels
- T.7.01.01 TestHelpers
|↘ ПРЕДОСТАВЛЯЕТ:
- Отчёт по границам
|Реализация: Foundry Fuzz.
|Примечания: Проверка непрерывности.

|T.2.01.04|Tests|Fuzz|Solidity|test/fuzz/FuzzReserve.t.sol|C.4.01.01, T.7.01.01|v.0.0.01|Draft|§13.2|
|Описание: Fuzz-тесты ReserveManager. Случайные reserve, S_curve, инвариант.
|Публичный API:
- function testFuzz_invariant(uint256 r, uint256 S) public
|↙ ПОТРЕБЛЯЕТ:
- C.4.01.01 ReserveManager
- T.7.01.01 TestHelpers
|↘ ПРЕДОСТАВЛЯЕТ:
- Отчёт по инварианту
|Реализация: Foundry Fuzz.
|Примечания: reserve ≥ R(S).

|T.2.01.05|Tests|Fuzz|Solidity|test/fuzz/FuzzVesting.t.sol|C.5.01.01, T.7.01.01|v.0.0.01|Draft|§13.2|
|Описание: Fuzz-тесты Vesting. Случайные суммы, временные метки.
|Публичный API:
- function testFuzz_add(uint256 amount) public
- function testFuzz_release(uint256 time) public
|↙ ПОТРЕБЛЯЕТ:
- C.5.01.01 Vesting
- T.7.01.01 TestHelpers
|↘ ПРЕДОСТАВЛЯЕТ:
- Отчёт по вестингу
|Реализация: Foundry Fuzz.
|Примечания: Проверка cliff и linear.

|T.2.01.06|Tests|Fuzz|Solidity|test/fuzz/FuzzFactory.t.sol|C.8.01.01, T.7.01.01, T.7.01.03|v.0.0.01|Draft|§13.2|
|Описание: Fuzz-тесты XartIAFactory. threshold ограничен 500–2000 bp.
|Публичный API:
- function testFuzz_deploy(uint256 threshold) public
|↙ ПОТРЕБЛЯЕТ:
- C.8.01.01 XartIAFactory
- T.7.01.01 TestHelpers
- T.7.01.03 MockSafe
|↘ ПРЕДОСТАВЛЯЕТ:
- Отчёт по деплоям
|Реализация: Foundry Fuzz. threshold = bound(threshold, 500, 2000). safe и usdc — детерминированные (mockSafe, mockUSDC).
|Примечания: ИСПРАВЛЕНО: убран неиспользуемый seed.

|T.2.01.07|Tests|Fuzz|Solidity|test/fuzz/FuzzCircuitBreaker.t.sol|C.6.01.01, T.7.01.01|v.0.0.01|Draft|§13.2|
|Описание: Fuzz-тесты CircuitBreaker. Случайные freeReserve/reserve, пороги, границы.
|Публичный API:
- function testFuzz_active(uint256 r, uint256 fr) public
- function testFuzz_setThreshold(uint256 t) public
|↙ ПОТРЕБЛЯЕТ:
- C.6.01.01 CircuitBreaker
- T.7.01.01 TestHelpers
|↘ ПРЕДОСТАВЛЯЕТ:
- Отчёт по Circuit Breaker
|Реализация: Foundry Fuzz.
|Примечания: ИЗМЕНЕНИЕ: testFuzz_check переименован в testFuzz_active — синхронизировано с реализацией.

|T.3.01.01|Tests|Invariant|Solidity|test/invariant/InvariantReserve.t.sol|C.4.01.01, T.7.01.01, T.7.01.04|v.0.0.01|Draft|§13.3|
|Описание: Invariant-тест. reserve ≥ R(S_curve) после каждой операции.
|Публичный API:
- function invariant_reserve() public
|↙ ПОТРЕБЛЯЕТ:
- C.4.01.01 ReserveManager
- T.7.01.01 TestHelpers
- T.7.01.04 InvariantBase
|↘ ПРЕДОСТАВЛЯЕТ:
- Отчёт по инварианту
|Реализация: Foundry Invariant. runs=1000.
|Примечания: Проверка на каждой итерации.

|T.3.01.02|Tests|Invariant|Solidity|test/invariant/InvariantSupply.t.sol|C.1.01.01, C.3.01.01, C.4.01.01, T.7.01.01, T.7.01.04|v.0.0.01|Draft|§13.3|
|Описание: Invariant-тест. totalSupply == S_curve.
|Публичный API:
- function invariant_supply() public
|↙ ПОТРЕБЛЯЕТ:
- C.1.01.01 XartIAToken
- C.3.01.01 CurveController
- C.4.01.01 ReserveManager
- T.7.01.01 TestHelpers
- T.7.01.04 InvariantBase
|↘ ПРЕДОСТАВЛЯЕТ:
- Отчёт
|Реализация: invariant_supply: xartIAToken.totalSupply() == reserveManager.S_curve().
|Примечания: ИЗМЕНЕНИЕ: убраны зависимости от Vesting и PoolState (vesting-баланс — часть totalSupply, pool-токены — тоже). invariant_totalSupply удалён из T.7.01.04 InvariantBase — единственный источник истины — этот тест.

|T.3.01.03|Tests|Invariant|Solidity|test/invariant/InvariantPool.t.sol|C.3.01.02, T.7.01.01, T.7.01.04|v.0.0.02|Draft|§13.3|
|Описание: Invariant-тест. poolPrice в симметричном коридоре [P(S)/(1+maxGap), P(S)*(1+maxGap)].
|Публичный API:
- function invariant_poolPrice_bounds() public
|↙ ПОТРЕБЛЯЕТ:
- C.3.01.02 PoolController
- C.2.01.01 CurveMath
- C.2.01.10 ILevels
- C.2.01.12 PoolState
- T.7.01.01 TestHelpers
- T.7.01.04 InvariantBase
|↘ ПРЕДОСТАВЛЯЕТ:
- Отчёт
|Реализация:
invariant_poolPrice_bounds:
  (1) если poolState.poolPrice() == 0: return
  (2) P_S = CurveMath.P(S_curve(), ILevels(levels).all())
  (3) lower = P_S * BASIS_POINTS / (BASIS_POINTS + MAX_GAP)
  (4) upper = P_S * (BASIS_POINTS + MAX_GAP) / BASIS_POINTS
  (5) assertGe(poolState.poolPrice(), lower)
  (6) assertLe(poolState.poolPrice(), upper)
|Примечания: ИЗМЕНЕНО 11-я ИТЕРАЦИЯ: переименован с invariant_poolPrice. Добавлена проверка нижней границы (было только ceiling). Это критично: нижняя граница enforced в buyFromCurve/buyFromCurveFor, без неё арбитраж без ограничения MAX_GAP.

|T.3.01.04|Tests|Invariant|Solidity|test/invariant/InvariantFreeReserve.t.sol|C.4.01.01, T.7.01.01, T.7.01.04|v.0.0.01|Draft|§13.3|
|Описание: Invariant-тест. freeReserve ≥ 0.
|Публичный API:
- function invariant_freeReserve() public
|↙ ПОТРЕБЛЯЕТ:
- C.4.01.01 ReserveManager
- T.7.01.01 TestHelpers
- T.7.01.04 InvariantBase
|↘ ПРЕДОСТАВЛЯЕТ:
- Отчёт
|Реализация: Foundry Invariant.
|Примечания: Проверка на каждой итерации.

|T.3.01.05|Tests|Invariant|Solidity|test/invariant/InvariantPoolPrice.t.sol|C.3.01.02, T.7.01.01, T.7.01.04|v.0.0.01|Draft|§13.3|
|Описание: Invariant-тест. Монотонность poolPrice при sellToPool.
|Публичный API:
- function invariant_poolPrice_monotonic() public
|↙ ПОТРЕБЛЯЕТ:
- C.3.01.02 PoolController
- T.7.01.01 TestHelpers
- T.7.01.04 InvariantBase
|↘ ПРЕДОСТАВЛЯЕТ:
- Отчёт
|Реализация: Foundry Invariant.
|Примечания: poolPrice_new ≥ poolPrice_old.

|T.3.01.06|Tests|Invariant|Solidity|test/invariant/InvariantLevels.t.sol|C.2.01.09, T.7.01.01, T.7.01.04|v.0.0.01|Draft|§13.3|
|Описание: Invariant-тест. Непрерывность цены на границах уровней.
|Публичный API:
- function invariant_level_continuity() public
|↙ ПОТРЕБЛЯЕТ:
- C.2.01.09 Levels
- T.7.01.01 TestHelpers
- T.7.01.04 InvariantBase
|↘ ПРЕДОСТАВЛЯЕТ:
- Отчёт
|Реализация: Foundry Invariant.
|Примечания: |P(S_end) − P(S_start_next)| < ε.

|T.3.01.07|Tests|Invariant|Solidity|test/invariant/InvariantUsdcCustody.t.sol|C.4.01.01, C.9.01.02, T.7.01.01, T.7.01.02, T.7.01.04|v.0.0.01|Draft|§13.3|
|Описание: Invariant-тест. Проверяет, что фактический баланс USDC в ReserveManager соответствует учётному reserve() с учётом decimals. Прямое сравнение некорректно: USDC.balanceOf — 6-dec, reserve() — 18-dec.
|Публичный API:
- function invariant_usdcCustody() public
|↙ ПОТРЕБЛЯЕТ:
- C.4.01.01 ReserveManager
- C.9.01.02 PrecisionLib (toWei)
- T.7.01.01 TestHelpers
- T.7.01.02 MockUSDC
- T.7.01.04 InvariantBase
|↘ ПРЕДОСТАВЛЯЕТ:
- Отчёт по custody
|Реализация: invariant_usdcCustody:
  (1) uint256 balance_6 = mockUSDC.balanceOf(address(reserveManager))
  (2) uint256 balance_18 = PrecisionLib.toWei(balance_6)
  (3) assertEq(balance_18, reserveManager.reserve())
|Примечания: ИСПРАВЛЕНО 7-я ИТЕРАЦИЯ: сравнение через PrecisionLib.toWei(balanceOf). Прямое сравнение balanceOf (6-dec) с reserve() (18-dec) некорректно. Добавлена зависимость C.9.01.02 PrecisionLib.

|T.3.01.08|Tests|Invariant|Solidity|test/invariant/InvariantPoolBalance.t.sol|C.3.01.02, C.2.01.12, T.7.01.01, T.7.01.04|v.0.0.01|Draft|§13.3|
|Описание: Invariant-тест. Проверяет, что учётный poolState.pool() соответствует фактическому балансу токенов XartIA в PoolController.
|Публичный API:
- function invariant_poolBalance() public
|↙ ПОТРЕБЛЯЕТ:
- C.3.01.02 PoolController (pool)
- C.2.01.12 PoolState (pool)
- C.1.01.01 XartIAToken (balanceOf)
- T.7.01.01 TestHelpers
- T.7.01.04 InvariantBase
|↘ ПРЕДОСТАВЛЯЕТ:
- Отчёт по pool balance
|Реализация: invariant_poolBalance:
  assertEq(IXartIAToken(token).balanceOf(poolController), poolState.pool())
|Примечания: НОВОЕ 7-я ИТЕРАЦИЯ: критичный инвариант — pool должен соответствовать фактическому балансу. Аналогично T.3.01.07 InvariantUsdcCustody, но для пула.

|T.3.01.09|Tests|Invariant|Solidity|test/invariant/InvariantTreasury.t.sol|C.8.01.01, C.8.01.02, C.3.01.01, T.7.01.01, T.7.01.02, T.7.01.04|v.0.0.02|Draft|§13.3|
|Описание: Invariant-тест. treasury_balance монотонно неубывающий. Критичный инвариант protocol revenue.
|Публичный API:
- function invariant_treasury_monotonic() public
|↙ ПОТРЕБЛЯЕТ:
- C.8.01.01 XartIAFactory (treasury())
- C.8.01.02 IXartIAFactory (интерфейс для вызова treasury())
- C.3.01.01 CurveController (альтернативный источник treasury())
- T.7.01.01 TestHelpers
- T.7.01.02 MockUSDC
- T.7.01.04 InvariantBase
|↘ ПРЕДОСТАВЛЯЕТ:
- Отчёт по treasury
|Реализация:
// Ghost variable
uint256 private lastTreasuryBalance_6;
function setUp() public override {
  super.setUp();
  lastTreasuryBalance_6 = 0;
}
invariant_treasury_monotonic:
  (1) address treasury = IXartIAFactory(factory).treasury()
      // ИЛИ: address treasury = ICurveController(curveController).treasury()
  (2) uint256 balance_6 = mockUSDC.balanceOf(treasury)
  (3) assertGe(balance_6, lastTreasuryBalance_6)
  (4) lastTreasuryBalance_6 = balance_6
|Примечания: ИСПРАВЛЕНО 13-я ИТЕРАЦИЯ (ревизия 4):
- Убрана строка-артефакт `- C.1.01.01 XartIAToken (нет — USDC)` из ↙ ПОТРЕБЛЯЕТ. Ранее был кривой комментарий «нет — USDC», который не имеет смысла в списке зависимостей.
- Добавлены C.8.01.02 IXartIAFactory и C.3.01.01 CurveController — для получения treasury. Ранее тест не мог получить адрес treasury без этих зависимостей.
- В реализации показаны два альтернативных способа получения treasury: через Factory или через CurveController.
- Версия поднята с v.0.0.01 до v.0.0.02.
НОВОЕ 13-я ИТЕРАЦИЯ: закрывает пробел между Python-моделью (E.2.01.05, E.2.01.02, E.2.01.07) и Solidity-тестами. Ранее проверка treasury_monotonic была только в Python.

|T.4.01.01|Tests|Integration|Solidity|test/integration/FullCycle.t.sol|C.8.01.01, T.7.01.01, T.7.01.02|v.0.0.01|Draft|§13.4|
|Описание: Integration-тест полного цикла. mint → pool → pool buy → curve redeem → mint → level transition → pool → redeem.
|Публичный API:
- function test_fullCycle() public
|↙ ПОТРЕБЛЯЕТ:
- C.8.01.01 XartIAFactory (деплой всей системы)
- T.7.01.01 TestHelpers
- T.7.01.02 MockUSDC
|↘ ПРЕДОСТАВЛЯЕТ:
- Отчёт по инвариантам
|Реализация: Foundry Integration. Использует XartIAFactory для деплоя всей системы в setUp.
|Примечания: Все инварианты проверяются после каждой операции.

|T.4.01.02|Tests|Integration|Solidity|test/integration/LevelTransition.t.sol|C.8.01.01, T.7.01.01, T.7.01.02|v.0.0.01|Draft|§13.4|
|Описание: Integration-тест переходов через уровни. 49999→50001, 249999→250001, 1249999→1250001.
|Публичный API:
- function test_levelTransition() public
|↙ ПОТРЕБЛЯЕТ:
- C.8.01.01 XartIAFactory
- T.7.01.01 TestHelpers
- T.7.01.02 MockUSDC
|↘ ПРЕДОСТАВЛЯЕТ:
- Отчёт
|Реализация: Foundry Integration.
|Примечания: Проверка непрерывности цены.

|T.5.01.01|Tests|Crash|Solidity|test/crash/MassExit.t.sol|C.8.01.01, T.7.01.01, T.7.01.02|v.0.0.01|Draft|§13.4|
|Описание: Crash-тест массового выхода. 10%, 25%, 50%, 80%, 100% держателей.
|Публичный API:
- function test_massExit(uint256 pct) public
|↙ ПОТРЕБЛЯЕТ:
- C.8.01.01 XartIAFactory
- T.7.01.01 TestHelpers
- T.7.01.02 MockUSDC
|↘ ПРЕДОСТАВЛЯЕТ:
- Отчёт
|Реализация: Foundry Crash.
|Примечания: Проверка reserve ≥ R(S_curve).

|T.5.01.02|Tests|Crash|Solidity|test/crash/Whale.t.sol|C.8.01.01, T.7.01.01, T.7.01.02|v.0.0.01|Draft|§13.4|
|Описание: Crash-тест кита. Адрес с 10%, 25%, 50% предложения.
|Публичный API:
- function test_whale(uint256 pct) public
|↙ ПОТРЕБЛЯЕТ:
- C.8.01.01 XartIAFactory
- T.7.01.01 TestHelpers
- T.7.01.02 MockUSDC
|↘ ПРЕДОСТАВЛЯЕТ:
- Отчёт
|Реализация: Foundry Crash.
|Примечания: Проверка maxBalance, лимитов.

|T.5.01.03|Tests|Crash|Solidity|test/crash/Cycles.t.sol|C.8.01.01, T.7.01.01, T.7.01.02|v.0.0.01|Draft|§13.4|
|Описание: Crash-тест повторяющихся циклов. 1000+ BUY/SELL операций.
|Публичный API:
- function test_cycles() public
|↙ ПОТРЕБЛЯЕТ:
- C.8.01.01 XartIAFactory
- T.7.01.01 TestHelpers
- T.7.01.02 MockUSDC
|↘ ПРЕДОСТАВЛЯЕТ:
- Отчёт
|Реализация: Foundry Crash.
|Примечания: Проверка накопления ошибок округления.

|T.5.01.04|Tests|Crash|Solidity|test/crash/PoolCycle.t.sol|C.8.01.01, T.7.01.01, T.7.01.02|v.0.0.01|Draft|§13.4|
|Описание: Crash-тест пула. sellToPool/buyFromPool циклы.
|Публичный API:
- function test_poolCycle() public
|↙ ПОТРЕБЛЯЕТ:
- C.8.01.01 XartIAFactory
- T.7.01.01 TestHelpers
- T.7.01.02 MockUSDC
|↘ ПРЕДОСТАВЛЯЕТ:
- Отчёт
|Реализация: Foundry Crash.
|Примечания: Проверка poolPrice.

|T.5.01.05|Tests|Crash|Solidity|test/crash/CircuitBreakerTrigger.t.sol|C.8.01.01, T.7.01.01, T.7.01.02|v.0.0.01|Draft|§13.4|
|Описание: Crash-тест сценария срабатывания Circuit Breaker. Истощение freeReserve.
|Публичный API:
- function test_scenario_trigger() public
- function test_scenario_trigger_via_sellToPool() public
- function test_scenario_trigger_via_redeem() public
|↙ ПОТРЕБЛЯЕТ:
- C.8.01.01 XartIAFactory
- T.7.01.01 TestHelpers
- T.7.01.02 MockUSDC
|↘ ПРЕДОСТАВЛЯЕТ:
- Отчёт по сценариям
|Реализация: Foundry Crash.
|Примечания: ИЗМЕНЕНИЕ: test_trigger переименован в test_scenario_trigger (CB не имеет функции trigger()).

|T.5.01.06|Tests|Crash|Solidity|test/crash/EarlySellFee.t.sol|C.8.01.01, T.7.01.01, T.7.01.02, T.7.01.06|v.0.0.01|Draft|§13.4|
|Описание: Crash-тест earlySellFee. Период, расчёт, распределение.
|Публичный API:
- function test_earlySellFee() public
|↙ ПОТРЕБЛЯЕТ:
- C.8.01.01 XartIAFactory
- T.7.01.01 TestHelpers
- T.7.01.02 MockUSDC
- T.7.01.06 TimeHelpers
|↘ ПРЕДОСТАВЛЯЕТ:
- Отчёт
|Реализация: Foundry Crash. vm.warp.
|Примечания: Проверка периода.

|T.5.01.07|Tests|Crash|Solidity|test/crash/MinimalPurchase.t.sol|C.8.01.01, T.7.01.01, T.7.01.02|v.0.0.01|Draft|§13.4|
|Описание: Crash-тест minimalPurchase.
|Публичный API:
- function test_minimalPurchase() public
|↙ ПОТРЕБЛЯЕТ:
- C.8.01.01 XartIAFactory
- T.7.01.01 TestHelpers
- T.7.01.02 MockUSDC
|↘ ПРЕДОСТАВЛЯЕТ:
- Отчёт
|Реализация: Foundry Crash.
|Примечания: Проверка минимальной суммы.

|T.5.01.08|Tests|Crash|Solidity|test/crash/MaxBalance.t.sol|C.8.01.01, T.7.01.01, T.7.01.02|v.0.0.01|Draft|§13.4|
|Описание: Crash-тест maxBalance_i. Попытка обхода лимита.
|Публичный API:
- function test_maxBalance() public
|↙ ПОТРЕБЛЯЕТ:
- C.8.01.01 XartIAFactory
- T.7.01.01 TestHelpers
- T.7.01.02 MockUSDC
|↘ ПРЕДОСТАВЛЯЕТ:
- Отчёт
|Реализация: Foundry Crash.
|Примечания: Проверка лимита на уровень.

|T.5.01.09|Tests|Crash|Solidity|test/crash/FreeReserveDepletion.t.sol|C.8.01.01, T.7.01.01, T.7.01.02|v.0.0.01|Draft|§13.4|
|Описание: Crash-тест истощения свободного резерва. sellToPool блокируется, redeemFromCurve работает.
|Публичный API:
- function test_depletion() public
|↙ ПОТРЕБЛЯЕТ:
- C.8.01.01 XartIAFactory
- T.7.01.01 TestHelpers
- T.7.01.02 MockUSDC
|↘ ПРЕДОСТАВЛЯЕТ:
- Отчёт
|Реализация: Foundry Crash.
|Примечания: Проверка freeReserve == 0.

|T.5.01.10|Tests|Crash|Solidity|test/crash/LevelDowngrade.t.sol|C.8.01.01, T.7.01.01, T.7.01.02|v.0.0.01|Draft|§13.4|
|Описание: Crash-тест понижения уровня через redeemFromCurve. Корректность R(S) при пересечении границы вниз.
|Публичный API:
- function test_downgrade() public
|↙ ПОТРЕБЛЯЕТ:
- C.8.01.01 XartIAFactory
- T.7.01.01 TestHelpers
- T.7.01.02 MockUSDC
|↘ ПРЕДОСТАВЛЯЕТ:
- Отчёт
|Реализация: Foundry Crash.
|Примечания: Проверка корректности R(S).

|T.5.01.11|Tests|Crash|Solidity|test/crash/PoolPriceManipulation.t.sol|C.8.01.01, T.7.01.01, T.7.01.02|v.0.0.02|Draft|§13.4|
|Описание: Crash-тест манипуляций poolPrice. Попытки отклонить от P(S), обход симметричного коридора.
|Публичный API:
- function test_manipulation_ceiling() public
- function test_manipulation_floor() public
- function test_manipulation_both_bounds() public
|↙ ПОТРЕБЛЯЕТ:
- C.8.01.01 XartIAFactory
- T.7.01.01 TestHelpers
- T.7.01.02 MockUSDC
|↘ ПРЕДОСТАВЛЯЕТ:
- Отчёт
|Реализация: Foundry Crash.
test_manipulation_ceiling:
  (1) серия sellToPool → poolPrice не превышает P(S)*(1+MAX_GAP)
test_manipulation_floor:
  (1) серия buyFromCurve → poolPrice не опускается ниже P(S)/(1+MAX_GAP)
  (2) после каждой покупки проверять floor
test_manipulation_both_bounds:
  (1) смешанные операции buy/sell pool/curve
  (2) assertGe(poolPrice, P(S)/(1+MAX_GAP))
  (3) assertLe(poolPrice, P(S)*(1+MAX_GAP))
|Примечания: ИСПРАВЛЕНО 12-я ИТЕРАЦИЯ: добавлены test_manipulation_floor и test_manipulation_both_bounds. Ранее проверялся только ceiling. Симметричный коридор — критичен для ограничения арбитража в обе стороны.

|T.5.01.12|Tests|Crash|Solidity|test/crash/ReserveInvariantViolation.t.sol|C.8.01.01, T.7.01.01, T.7.01.02|v.0.0.01|Draft|§13.4|
|Описание: Crash-тест попытки нарушения reserve ≥ R(S_curve) через последовательность операций.
|Публичный API:
- function test_violation() public
|↙ ПОТРЕБЛЯЕТ:
- C.8.01.01 XartIAFactory
- T.7.01.01 TestHelpers
- T.7.01.02 MockUSDC
|↘ ПРЕДОСТАВЛЯЕТ:
- Отчёт
|Реализация: Foundry Crash.
|Примечания: Попытка нарушить инвариант.

|T.5.01.13|Tests|Crash|Solidity|test/crash/Reentrancy.t.sol|C.8.01.01, C.8.01.02, C.3.01.01, C.3.01.03, T.7.01.01, T.7.01.02, T.7.01.08|v.0.0.04|Draft|§13.4|
|Описание: Crash-тест reentrancy. Использует прямое развёртывание CurveController (без Factory) через deployCurveControllerForReentrancy(), чтобы test contract (owner) мог установить attacker в роли poolController. Для тестов, где attacker — обычный user (buyFromCurve, redeemFromCurve, buyFromPool, sellToPool), используется deployFullSystem().
|Публичный API:
- function test_reentrancy_buyFromCurve() public
- function test_reentrancy_redeemFromCurve() public
- function test_reentrancy_buyFromPool() public
- function test_reentrancy_sellToPool() public
- function test_reentrancy_buyFromCurveFor() public
- function test_buyFromCurveFor_revert_unauthorized_sender() public
|↙ ПОТРЕБЛЯЕТ:
- C.8.01.01 XartIAFactory
- C.8.01.02 IXartIAFactory
- C.3.01.01 CurveController
- C.3.01.03 ICurveController
- T.7.01.01 TestHelpers
- T.7.01.02 MockUSDC
- T.7.01.08 ReentrancyAttacker
- OpenZeppelin: IERC20 (для approve attacker → curveController)
|↘ ПРЕДОСТАВЛЯЕТ:
- Отчёт по reentrancy
|Реализация:
setUp (по умолчанию):
  (1) factory = deployFullSystem()                     // для тестов 1–4 (attacker = user)
  (2) curveCtrl = IXartIAFactory(factory).curveController()
  (3) attacker = new ReentrancyAttacker()
test_reentrancy_buyFromCurve:
  (1) attacker.attack_buyFromCurve(curveCtrl, amount)
  (2) проверить, что reentrancy не прошла (nonReentrant)
test_reentrancy_redeemFromCurve:
  (1) выдать attacker токены через curveController.buyFromCurve
  (2) attacker.attack_redeemFromCurve(curveCtrl, amount)
  (3) проверить nonReentrant
test_reentrancy_buyFromPool:
  (1) attacker.attack_buyFromPool(poolCtrl, amount)
  (2) проверить nonReentrant
test_reentrancy_sellToPool:
  (1) выдать attacker токены
  (2) attacker.attack_sellToPool(poolCtrl, amount)
  (3) проверить nonReentrant
test_reentrancy_buyFromCurveFor:
  // Прямое развёртывание — attacker в роли poolController
  (1) attacker = new ReentrancyAttacker()
  (2) (curveCtrl, token, levels, poolState, reserveManager, vesting, cb, _treasury) = deployCurveControllerForReentrancy(address(attacker))
      // ИСПРАВЛЕНО 13-я ИТЕРАЦИЯ (ревизия 4): добавлен 8-й элемент _treasury.
      // deployCurveControllerForReentrancy возвращает 8 значений (см. T.7.01.01):
      // (curveController, token, levels, poolState, reserveManager, vesting, circuitBreaker, treasury).
      // Ранее в псевдокоде было 7 значений — Solidity не скомпилировал бы такой tuple destructuring.
  (3) mintUSDC(address(attacker), X_6)
  (4) attacker.approve(curveCtrl, X_6)                 // pull-модель требует allowance
  (5) attacker.attack_buyFromCurveFor(curveCtrl, buyer, X_18)
  (6) проверить nonReentrant
test_buyFromCurveFor_revert_unauthorized_sender:
  (1) vm.prank(randomAddress)
  (2) vm.expectRevert(Unauthorized)
  (3) curveController.buyFromCurveFor(user, X_18, 0, 0)
|Примечания: ИСПРАВЛЕНО 13-я ИТЕРАЦИЯ (ревизия 4): в test_reentrancy_buyFromCurveFor добавлен 8-й элемент tuple `_treasury` — ранее в псевдокоде было 7 значений, а deployCurveControllerForReentrancy возвращает 8. Solidity не скомпилировал бы такой tuple destructuring. Переменная _treasury не используется в тесте (treasury доступен через curveCtrl.treasury()), но объявлена для корректного destructuring.
ИСПРАВЛЕНО 12-я ИТЕРАЦИЯ (ревизия 2): тест разделён на две группы по способу развёртывания. Для test_reentrancy_buyFromCurveFor используется deployCurveControllerForReentrancy(address(attacker)) — прямое развёртывание, owner = test contract, который устанавливает attacker как poolController. Раньше тест пытался вызвать setPoolController на Factory-развёрнутом контракте, что ревертило с AlreadyInitialized (Factory.deploy уже вызвал setPoolController на шаге 10a).
Убрана зависимость OpenZeppelin: IAccessControl — больше не используется.

|T.5.01.14|Tests|Crash|Solidity|test/crash/ZeroScurve.t.sol|C.8.01.01, T.7.01.01, T.7.01.02|v.0.0.01|Draft|§13.4|
|Описание: Crash-тест нулевого S_curve. Проверяет корректность операций при S_curve == 0 (Genesis), включая отсутствие проверки maxPurchasePct.
|Публичный API:
- function test_buyFromCurve_zero() public
- function test_buyFromCurve_zero_no_maxPct() public   // НОВОЕ
- function test_buyFromCurve_zero_minimalPurchase() public
- function test_redeemFromCurve_zero() public
- function test_pool_operations_zero() public
|↙ ПОТРЕБЛЯЕТ:
- C.8.01.01 XartIAFactory
- T.7.01.01 TestHelpers
- T.7.01.02 MockUSDC
|↘ ПРЕДОСТАВЛЯЕТ:
- Отчёт по граничным случаям
|Реализация: Foundry Crash.
|Примечания: ИСПРАВЛЕНО: минимальная покупка теперь называется minimalPurchase (не minAbsoluteBuyTokens). НОВОЕ: test_buyFromCurve_zero_no_maxPct — проверяет, что при S_curve == 0 проверка maxPurchasePct пропускается.

|T.5.01.15|Tests|Crash|Solidity|test/crash/SlippageDeadline.t.sol|C.8.01.01, T.7.01.01, T.7.01.02, T.7.01.06|v.0.0.01|Draft|§13.4|
|Описание: Crash-тест slippage и deadline. Проверяет minOut/maxIn/deadline и семантику 0.
|Публичный API:
- function test_slippage_buyFromCurve() public
- function test_slippage_redeemFromCurve() public
- function test_slippage_buyFromPool() public
- function test_slippage_sellToPool() public
- function test_deadline_zero_means_no_limit() public
- function test_deadline_expired() public
- function test_minOut_zero_means_no_slippage() public
|↙ ПОТРЕБЛЯЕТ:
- C.8.01.01 XartIAFactory
- T.7.01.01 TestHelpers
- T.7.01.02 MockUSDC
- T.7.01.06 TimeHelpers
|↘ ПРЕДОСТАВЛЯЕТ:
- Отчёт по slippage/deadline
|Реализация: Foundry Crash.
|Примечания: ИЗМЕНЕНИЕ: объединён с T.5.01.20 DeadlineSemantics — один файл покрывает всё. T.5.01.20 удалён.

|T.5.01.16|Tests|Crash|Solidity|test/crash/PauseUnpause.t.sol|C.8.01.01, T.7.01.01, T.7.01.02, T.7.01.03|v.0.0.01|Draft|§13.4|
|Описание: Crash-тест pause/unpause. Проверяет, что PAUSER_ROLE может остановить торговлю, а GOVERNANCE_ROLE — возобновить.
|Публичный API:
- function test_pause_blocks_all() public
- function test_unpause_restores() public
- function test_revert_unauthorized_pause() public
- function test_revert_unauthorized_unpause() public
|↙ ПОТРЕБЛЯЕТ:
- C.8.01.01 XartIAFactory
- T.7.01.01 TestHelpers
- T.7.01.02 MockUSDC
- T.7.01.03 MockSafe
|↘ ПРЕДОСТАВЛЯЕТ:
- Отчёт по pause
|Реализация: Foundry Crash.
|Примечания: НОВОЕ: критично для emergency stop.

|T.5.01.17|Tests|Crash|Solidity|test/crash/RegisterParams.t.sol|C.8.01.01, C.0.01.02, C.2.01.03, T.7.01.01|v.0.0.02|Draft|§13.4|
|Описание: Crash-тест регистрации параметров. Проверяет, что factory.registerParams() корректно регистрирует все 9 параметров (было 8) и их bounds.
|Публичный API:
- function test_register_all() public
- function test_bounds() public
- function test_revert_duplicate() public
|↙ ПОТРЕБЛЯЕТ:
- C.8.01.01 XartIAFactory
- C.0.01.02 ParameterRegistry
- C.2.01.03 Constants (PARAM_SELL_TEAM_FEE)
- T.7.01.01 TestHelpers
|↘ ПРЕДОСТАВЛЯЕТ:
- Отчёт по регистрации
|Реализация: setUp:
  (1) factory = deployFullSystem()
  (2) factory.registerParams()
Явная проверка target/setter для каждого параметра:
  get(PARAM_BUY_FEE).target == curveController
  get(PARAM_SELL_TEAM_FEE).target == curveController                          // НОВОЕ
  ...
test_bounds:
  - PARAM_BUY_FEE: min=0, max=200
  - PARAM_REDEEM_FEE: min=0, max=200
  - PARAM_EARLY_SELL_FEE: min=0, max=500
  - PARAM_EARLY_SELL_PERIOD: min=0, max=7776000
  - PARAM_MAX_PURCHASE_PCT: min=0, max=1000
  - PARAM_MINIMAL_PURCHASE: min=1e6, max=1e12
  - PARAM_MAX_SELL_PCT_PER_DAY: min=0, max=500
  - PARAM_CIRCUIT_BREAKER_THRESHOLD: min=500, max=2000
  - PARAM_SELL_TEAM_FEE: min=0, max=50                                      // НОВОЕ
|Примечания: ИСПРАВЛЕНО 13-я ИТЕРАЦИЯ: добавлен PARAM_SELL_TEAM_FEE. Всего 9 параметров.

|T.5.01.19|Tests|Crash|Solidity|test/crash/CascadeBuyFromPool.t.sol|C.8.01.01, T.7.01.01, T.7.01.02|v.0.0.02|Draft|§13.4|
|Описание: Crash-тест каскадного buyFromPool → buyFromCurveFor. Проверка pull-модели: approve → pull → allowance reset. Проверка перевода fee_18 в reserveManager.
|Публичный API:
- function test_cascade_full_pool() public
- function test_cascade_partial_pool() public
- function test_cascade_empty_pool() public
- function test_cascade_pool_controller_approves() public                // ПЕРЕИМЕНОВАНО
- function test_cascade_curve_controller_pulls() public                  // ПЕРЕИМЕНОВАНО
- function test_cascade_allowance_reset() public                         // ПЕРЕИМЕНОВАНО
- function test_cascade_fee_to_reserve() public                          // НОВОЕ 12-я ИТЕРАЦИЯ
- function test_cascade_no_usdc_left_in_pool_controller() public          // НОВОЕ 12-я ИТЕРАЦИЯ
|↙ ПОТРЕБЛЯЕТ:
- C.8.01.01 XartIAFactory
- T.7.01.01 TestHelpers
- T.7.01.02 MockUSDC
|↘ ПРЕДОСТАВЛЯЕТ:
- Отчёт по каскаду
|Реализация: Foundry Crash.
test_cascade_pool_controller_approves:
  (1) каскад с X_remaining_18 > 0
  (2) до вызова buyFromCurveFor allowance(PoolController → CurveController) == X_remaining_6
test_cascade_curve_controller_pulls:
  (1) USDC за каскад поступает в reserveManager
  (2) assertEq(reserveManager.reserve() increased by X_remaining_18 + X_pool_used_18 + fee_18)
test_cascade_allowance_reset:
  (1) после каскада allowance(PoolController → CurveController) == 0
test_cascade_fee_to_reserve:
  (1) fee_18 переводится в reserveManager на шаге 11a
  (2) reserve растёт на fee_18 + X_pool_used_18 + X_remaining_18
test_cascade_no_usdc_left_in_pool_controller:
  (1) после транзакции balanceOf(address(poolController)) == 0
|Примечания: ИСПРАВЛЕНО 12-я ИТЕРАЦИЯ: тесты переименованы под pull-модель. Добавлены test_cascade_fee_to_reserve и test_cascade_no_usdc_left_in_pool_controller — проверяют критичный фикс шага 11a (fee_18 → reserveManager, PoolController не хранит USDC).

|T.5.01.21|Tests|Crash|Solidity|test/crash/SellTeamFee.t.sol|C.8.01.01, T.7.01.01, T.7.01.02, T.7.01.06|v.0.0.01|Draft|§13.4|
|Описание: Crash-тест sellTeamFee. Проверяет накопление treasury через redeemFromCurve и sellToPool, инвариант reserve >= R(S), отсутствие влияния на totalSupply.
|Публичный API:
- function test_accumulation_via_redeem() public
- function test_accumulation_via_sellToPool() public
- function test_accumulation_mixed() public
- function test_bound_zero_disables() public
- function test_bound_max() public
- function test_governance_change_takes_effect() public
- function test_invariant_reserve_holds() public
- function test_invariant_totalSupply_holds() public
- function test_round_trip_cost() public
|↙ ПОТРЕБЛЯЕТ:
- C.8.01.01 XartIAFactory
- C.3.01.01 CurveController
- C.3.01.02 PoolController
- T.7.01.01 TestHelpers
- T.7.01.02 MockUSDC
- T.7.01.06 TimeHelpers
|↘ ПРЕДОСТАВЛЯЕТ:
- Отчёт по sellTeamFee
|Реализация: Foundry Crash.
test_accumulation_via_redeem:
  (1) sellTeamFee = 10
  (2) 100 пользователей покупают и redeemFromCurve
  (3) treasury balance ≈ sum(toUSDC(amount_18_i * 10 / 10000))
test_accumulation_via_sellToPool:
  (1) sellTeamFee = 10
  (2) 100 пользователей sellToPool
  (3) treasury balance растёт пропорционально
test_accumulation_mixed:
  (1) смешанные операции redeem + sellToPool
  (2) treasury получает от обоих
test_bound_zero_disables:
  (1) setSellTeamFee(0)
  (2) redeemFromCurve и sellToPool — treasury не получает
test_bound_max:
  (1) setSellTeamFee(50)
  (2) redeemFromCurve — treasury получает 0.5%
test_governance_change_takes_effect:
  (1) setSellTeamFee(10) → redeem → treasury получает 0.1%
  (2) setSellTeamFee(20) → redeem → treasury получает 0.2%
test_invariant_reserve_holds:
  (1) после каждой операции assertGe(reserveManager.reserve(), reserveManager.curveBacking())
test_invariant_totalSupply_holds:
  (1) после каждой операции assertEq(token.totalSupply(), reserveManager.S_curve())
test_round_trip_cost:
  (1) user покупает X_6 = 1000e6
  (2) сразу redeemFromCurve (earlySellFee = 0, earlySellPeriod = 0)
  (3) user получает X_6 − buyFee − redeemFee − sellTeamFee
  (4) потери ≈ 0.5% + 0.5% + 0.1% = 1.1% (с поправкой на bonding curve)
|Примечания: НОВОЕ 13-я ИТЕРАЦИЯ: покрывает sellTeamFee через все sell-функции, границы, governance, инварианты reserve и totalSupply, round-trip cost.

|T.6.01.01|Tests|Gas|Solidity|test/gas/GasBuyCurve.t.sol|C.8.01.01, T.7.01.01, T.7.01.02|v.0.0.01|Draft|§13.5|
|Описание: Gas-тест buyFromCurve. ≤ 250 000 gas.
|Публичный API:
- function test_gas_buy() public
|↙ ПОТРЕБЛЯЕТ:
- C.8.01.01 XartIAFactory
- T.7.01.01 TestHelpers
- T.7.01.02 MockUSDC
|↘ ПРЕДОСТАВЛЯЕТ:
- Отчёт по газу
|Реализация: Foundry Gas.
|Примечания: Fail, если > 250 000.

|T.6.01.02|Tests|Gas|Solidity|test/gas/GasRedeemCurve.t.sol|C.8.01.01, T.7.01.01, T.7.01.02|v.0.0.01|Draft|§13.5|
|Описание: Gas-тест redeemFromCurve. ≤ 250 000 gas.
|Публичный API:
- function test_gas_redeem() public
|↙ ПОТРЕБЛЯЕТ:
- C.8.01.01 XartIAFactory
- T.7.01.01 TestHelpers
- T.7.01.02 MockUSDC
|↘ ПРЕДОСТАВЛЯЕТ:
- Отчёт
|Реализация: Foundry Gas.
|Примечания: Fail, если > 250 000.

|T.6.01.03|Tests|Gas|Solidity|test/gas/GasBuyPool.t.sol|C.8.01.01, T.7.01.01, T.7.01.02|v.0.0.01|Draft|§13.5|
|Описание: Gas-тест buyFromPool. ≤ 200 000 gas.
|Публичный API:
- function test_gas_buyPool() public
|↙ ПОТРЕБЛЯЕТ:
- C.8.01.01 XartIAFactory
- T.7.01.01 TestHelpers
- T.7.01.02 MockUSDC
|↘ ПРЕДОСТАВЛЯЕТ:
- Отчёт
|Реализация: Foundry Gas.
|Примечания: Fail, если > 200 000.

|T.6.01.04|Tests|Gas|Solidity|test/gas/GasSellPool.t.sol|C.8.01.01, T.7.01.01, T.7.01.02|v.0.0.01|Draft|§13.5|
|Описание: Gas-тест sellToPool. ≤ 200 000 gas.
|Публичный API:
- function test_gas_sellPool() public
|↙ ПОТРЕБЛЯЕТ:
- C.8.01.01 XartIAFactory
- T.7.01.01 TestHelpers
- T.7.01.02 MockUSDC
|↘ ПРЕДОСТАВЛЯЕТ:
- Отчёт
|Реализация: Foundry Gas.
|Примечания: Fail, если > 200 000.

|T.6.01.05|Tests|Gas|Solidity|test/gas/GasLevelTransition.t.sol|C.8.01.01, T.7.01.01, T.7.01.02|v.0.0.01|Draft|§13.5|
|Описание: Gas-тест перехода через границу уровня. ≤ 300 000 gas.
|Публичный API:
- function test_gas_transition() public
|↙ ПОТРЕБЛЯЕТ:
- C.8.01.01 XartIAFactory
- T.7.01.01 TestHelpers
- T.7.01.02 MockUSDC
|↘ ПРЕДОСТАВЛЯЕТ:
- Отчёт
|Реализация: Foundry Gas.
|Примечания: Fail, если > 300 000.

|T.7.01.01|Tests|Utils|Solidity|test/utils/TestHelpers.sol|C.1.01.01, C.8.01.01, C.8.01.02, T.7.01.02, T.7.01.03|v.0.0.03|Draft|§13|
|Описание: Вспомогательные функции для тестов. mockUSDC, mockSafe, mockTreasury — state variables. deployCurveControllerForReentrancy() — прямое развёртывание CurveController.
|Публичный API:
- function setUpBase() internal
- function mintUSDC(address to, uint256 amount) internal
- function approveAll(address owner, address spender) internal
- function warp(uint256 time) internal
- function deployFullSystem() internal returns (address factory)
- function deployFullSystemFinalized() internal returns (address factory)
- function deployCurveControllerForReentrancy(address poolController_) internal returns (address curveController, address token, address levels, address poolState, address reserveManager, address vesting, address circuitBreaker, address treasury)
- function mockUSDC() internal view returns (address)
- function mockSafe() internal view returns (address)
- function mockTreasury() internal view returns (address)                         // НОВОЕ
|↙ ПОТРЕБЛЯЕТ:
- C.1.01.01 XartIAToken
- C.2.01.09 Levels
- C.2.01.12 PoolState
- C.3.01.01 CurveController
- C.4.01.01 ReserveManager
- C.5.01.01 Vesting
- C.6.01.01 CircuitBreaker
- C.8.01.01 XartIAFactory
- C.8.01.02 IXartIAFactory
- T.7.01.02 MockUSDC
- T.7.01.03 MockSafe
|↘ ПРЕДОСТАВЛЯЕТ:
- Общие хелперы для всех тестов
- mockUSDC, mockSafe, mockTreasury через геттеры
|Реализация:
address internal _mockUSDC;
address internal _mockSafe;
address internal _mockTreasury;                                                  // НОВОЕ
function mockUSDC() internal view returns (address) { return _mockUSDC; }
function mockSafe() internal view returns (address) { return _mockSafe; }
function mockTreasury() internal view returns (address) { return _mockTreasury; }
deployFullSystem():
  (1) _mockUSDC = address(new MockUSDC())
  (2) _mockSafe = address(new MockSafe())
  (2a) _mockTreasury = address(new MockSafe())                                   // НОВОЕ: default = separate MockSafe
  (3) factory = new XartIAFactory()
  (4) IXartIAFactory(factory).deploy(_mockSafe, _mockTreasury, 1000, _mockUSDC)  // ИЗМЕНЕНО: +treasury
  (5) IXartIAFactory(factory).initializeLevels(defaultLevels())
  (6) IXartIAFactory(factory).initializePoolPrice(P0_INITIAL)
  (7) IXartIAFactory(factory).registerParams()
  return address(factory)
deployFullSystemFinalized():
  (1) factory = deployFullSystem()
  (2) IXartIAFactory(factory).finalize(_mockSafe)
  return address(factory)
deployCurveControllerForReentrancy(poolController_):
  (1) _mockUSDC = address(new MockUSDC())
  (1a) _mockTreasury = address(new MockSafe())                                   // НОВОЕ
  (2) token = address(new XartIAToken())
  (3) levels = address(new Levels())
  (4) poolState = address(new PoolState())
  (5) reserveManager = address(new ReserveManager(_mockUSDC, levels))
  (6) vesting = address(new Vesting(address(this), token))
  (7) circuitBreaker = address(new CircuitBreaker(1000, reserveManager))
  (8) curveController = address(new CurveController(reserveManager, vesting, circuitBreaker, poolState, token, levels, _mockUSDC, _mockTreasury))   // +treasury
  (9) ILevels(levels).init(defaultLevels())
  (10) IPoolState(poolState).initializePoolPrice(P0_INITIAL)
  (11) ICurveController(curveController).setPoolController(poolController_)
  (12) IAccessControl(token).grantRole(MINTER_ROLE, curveController)
  (13) IAccessControl(token).grantRole(BURNER_ROLE, curveController)
  (14) IAccessControl(vesting).grantRole(MINTER_ROLE, curveController)
  (15) IAccessControl(reserveManager).grantRole(CONTROLLER_ROLE, curveController)
  (16) IAccessControl(reserveManager).grantRole(CONTROLLER_ROLE, poolController_)
  (17) IAccessControl(poolState).grantRole(PRICE_WRITER_ROLE, curveController)
  (18) IAccessControl(poolState).grantRole(POOL_WRITER_ROLE, poolController_)
  (19) IAccessControl(curveController).grantRole(GOVERNANCE_ROLE, address(this))
  (20) IAccessControl(curveController).grantRole(PAUSER_ROLE, address(this))
  (21) ICurveController(curveController).setBuyFee(50)
  (22) ICurveController(curveController).setRedeemFee(50)
  (23) ICurveController(curveController).setMinimalPurchase(1e6)
  (24) ICurveController(curveController).setMaxPurchasePct(500)
  (25) ICurveController(curveController).setSellTeamFee(10)                      // НОВОЕ: default
  return (curveController, token, levels, poolState, reserveManager, vesting, circuitBreaker, _mockTreasury)
|Примечания: ИСПРАВЛЕНО 13-я ИТЕРАЦИЯ: deployFullSystem и deployCurveControllerForReentrancy принимают/создают mockTreasury. deploy signature изменён на (safe, treasury, threshold, usdc). mockTreasury — отдельный MockSafe (не равен safe), чтобы тесты могли различать потоки USDC.

|T.7.01.02|Tests|Utils|Solidity|test/utils/MockUSDC.sol|—|v.0.0.01|Draft|§13|
|Описание: Мок USDC. 6 decimals, mint без ограничений.
|Публичный API:
- function mint(address to, uint256 amount) external
- function transfer(address to, uint256 amount) external returns (bool)
- function approve(address spender, uint256 amount) external returns (bool)
|↙ ПОТРЕБЛЯЕТ: — (нет зависимостей)
|↘ ПРЕДОСТАВЛЯЕТ:
- Тестовый USDC для всех тестов
|Реализация: ERC20 с 6 decimals.
|Примечания: Не для продакшена.

|T.7.01.03|Tests|Utils|Solidity|test/utils/MockSafe.sol|—|v.0.0.01|Draft|§13|
|Описание: Мок Safe Multisig. 3 из 5, executeTransaction.
|Публичный API:
- function execTransaction(address to, uint256 value, bytes memory data) external returns (bool)
- function addOwner(address owner) external
- function removeOwner(address owner) external
|↙ ПОТРЕБЛЯЕТ: — (нет зависимостей)
|↘ ПРЕДОСТАВЛЯЕТ:
- Тестовый Safe для Governance
|Реализация: Упрощённый Safe 3/5.
|Примечания: Не для продакшена.

|T.7.01.04|Tests|Utils|Solidity|test/utils/InvariantBase.sol|C.1.01.01, C.3.01.01, C.3.01.02, C.4.01.01, T.7.01.01|v.0.0.01|Draft|§13.3|
|Описание: Базовый контракт для invariant-тестов. Общие setup и helpers.
|Публичный API:
- function setUpInvariant() internal
- function invariant_reserve_ge_curveBacking() internal
|↙ ПОТРЕБЛЯЕТ:
- C.1.01.01 XartIAToken
- C.3.01.01 CurveController
- C.3.01.02 PoolController
- C.4.01.01 ReserveManager
- T.7.01.01 TestHelpers
|↘ ПРЕДОСТАВЛЯЕТ:
- Общие инварианты и setup
|Реализация: Foundry Invariant base.
|Примечания: ИСПРАВЛЕНО 8-я ИТЕРАЦИЯ: убран invariant_poolBalance() из публичного API — он определён только в T.3.01.08 InvariantPoolBalance. Ранее было дублирование. invariant_totalSupply удалён ранее — его определяет только T.3.01.02. Удалена зависимость от C.5.01.01 Vesting.

|T.7.01.05|Tests|Docs|Markdown|test/README.md|—|v.0.0.01|Draft|§13|
|Описание: README тестов. Запуск, структура, покрытие.

|Публичный API:
- Документ тестовой стратегии.
|↙ ПОТРЕБЛЯЕТ:
- — (нет зависимостей)
|↘ ПРЕДОСТАВЛЯЕТ:
- покрытие соответствующего контракта тестами
|Реализация: Markdown-документ.

|T.7.01.06|Tests|Utils|Solidity|test/utils/TimeHelpers.sol|—|v.0.0.01|Draft|§13|
|Описание: Хелперы для работы со временем. Warp, cliff, vesting-периоды.
|Публичный API:
- function warpTo(uint256 timestamp) internal
- function warpBy(uint256 seconds_) internal
- function skipCliff() internal
- function skipVesting() internal
|↙ ПОТРЕБЛЯЕТ:
- Foundry vm
|↘ ПРЕДОСТАВЛЯЕТ:
- Утилиты для тестов с временем
|Реализация: Обёртки над vm.warp.
|Примечания: Используется в T.1.01.06, T.1.01.12, T.5.01.06.

|T.7.01.07|Tests|Utils|Solidity|test/utils/MockERC20.sol|C.1.01.02|v.0.0.01|Draft|§13|
|Описание: Мок ERC20, реализующий IXartIAToken. Игнорирует роли — grantRole, mint, burnFrom доступны всем.
|Публичный API:
- function mint(address to, uint256 amount) external
- function burnFrom(address from, uint256 amount) external
- function grantRole(bytes32 role, address account) external  // no-op
- function transfer(address to, uint256 amount) external returns (bool)
- function approve(address spender, uint256 amount) external returns (bool)
|↙ ПОТРЕБЛЯЕТ:
- C.1.01.02 IXartIAToken (интерфейс)
- OpenZeppelin: ERC20
|↘ ПРЕДОСТАВЛЯЕТ:
- Общий ERC20-мок для тестов
|Реализация: OpenZeppelin ERC20 + реализация IXartIAToken без AccessControl. grantRole — no-op.
|Примечания: ИЗМЕНЕНИЕ: явно указано, что мок игнорирует роли. Не используется в тестах AccessControl — там нужен реальный XartIAToken.

|T.7.01.08|Tests|Utils|Solidity|test/utils/ReentrancyAttacker.sol|C.3.01.01, C.3.01.02, C.3.01.03|v.0.0.02|Draft|§13|
|Описание: Атакующий контракт для тестов reentrancy. Устанавливается как immutable poolController через setPoolController в тестах T.5.01.13.
|Публичный API:
- function attack_buyFromCurve(address controller, uint256 amount) external
- function attack_redeemFromCurve(address controller, uint256 amount) external
- function attack_sellToPool(address controller, uint256 amount) external
- function attack_buyFromPool(address controller, uint256 amount) external
- function attack_buyFromCurveFor(address controller, address buyer, uint256 amount) external
- function attack_setLastBuyTime(address controller, address user, uint256 timestamp) external
|↙ ПОТРЕБЛЯЕТ:
- C.3.01.01 CurveController (интерфейс)
- C.3.01.02 PoolController (интерфейс)
- C.3.01.03 ICurveController (интерфейс)
|↘ ПРЕДОСТАВЛЯЕТ:
- Тестовый контракт для reentrancy-тестов
- Имитация poolController для buyFromCurveFor и setLastBuyTime
|Реализация: При получении токенов или USDC пытается вызвать функцию обратно. Для attack_buyFromCurveFor предварительно делает approve(curveController, amount) — pull-модель требует allowance.
|Примечания: ИСПРАВЛЕНО 12-я ИТЕРАЦИЯ: добавлен attack_setLastBuyTime. attack_buyFromCurveFor теперь требует approve перед вызовом (pull-модель). Добавлена зависимость C.3.01.03 ICurveController. Attacker должен быть установлен как poolController через setPoolController — иначе buyFromCurveFor ревертит с Unauthorized.

|T.7.01.09|Tests|Utils|Solidity|test/utils/ErrorsWrapper.sol|C.2.01.01, C.2.01.02, C.2.01.04|v.0.0.01|Draft|§13|
|Описание: Обёртка для тестирования internal-ошибок CurveMath/LevelMath (только MathOverflow). CallFailed НЕ здесь — он выбрасывается в Timelock.
|Публичный API:
- function call_P(uint256 S, Level[] memory levels) external pure returns (uint256)
- function call_R(uint256 S, Level[] memory levels) external pure returns (uint256)
- function call_deltaSForBuy(uint256 S, uint256 X, Level[] memory levels) external pure returns (uint256)
|↙ ПОТРЕБЛЯЕТ:
- C.2.01.01 CurveMath
- C.2.01.02 LevelMath
- C.2.01.04 Errors
- C.2.01.11 Types
|↘ ПРЕДОСТАВЛЯЕТ:
- External-обёртки над internal-функциями для тестов
|Реализация: External функции вызывают internal — ошибки пробрасываются.
|Примечания: ИСПРАВЛЕНО: используется только для MathOverflow, не для CallFailed.

|T.7.01.10|Tests|Utils|Solidity|test/utils/CallFailTarget.sol|—|v.0.0.01|Draft|§13|
|Описание: Тестовый target, чей setter всегда revert'ит. Используется для проверки CallFailed в Timelock.execute (low-level call возвращает success = false).
|Публичный API:
- function failSetter(uint256) external pure   // всегда revert("always fail")
|↙ ПОТРЕБЛЯЕТ: — (нет зависимостей)
|↘ ПРЕДОСТАВЛЯЕТ:
- Target для test_execute_revert_call_failed
|Реализация: function failSetter(uint256) external pure { revert("always fail"); }
|Примечания: ИСПРАВЛЕНО: явно указано, что failSetter ВСЕГДА REVERT'ит. Без revert success = true, CallFailed не сработает.

|T.7.01.11|Tests|Invariant|Solidity|test/invariant/InvariantBaseExt.sol|C.8.01.01, T.7.01.12|v.0.0.01|Draft|§13|
|Описание: Расширенный setUp для invariant-тестов: актёры, approve, seed-покупка, отключение CB, подключение XartIAHandler как targetContract.
|Публичный API:
- setUpInvariantExt(), factory_curve(), factory_pool(), factory_token(), factory_reserveMgr().
|↙ ПОТРЕБЛЯЕТ: C.8.01.01 (Factory), T.7.01.01 (TestHelpers), T.7.01.12 (Handler).
|↘ ПРЕДОСТАВЛЯЕТ: T.3.01.* (invariant-наборы).
|Реализация: Solidity; fuzz-target через Foundry invariant.
|T.7.01.12|Tests|Invariant|Solidity|test/invariant/XartIAHandler.sol|C.3.01.01, C.3.01.02|v.0.0.01|Draft|§13|
|Описание: Fuzz-target для invariant-тестов: buy/redeem/buyFromPool/sellToPool по случайным актёрам, try/catch (бизнес-revert не валит инвариант), ghost-переменные для монотонности treasury и poolPrice.
|Публичный API:
- buyFromCurve(actorSeed, amountSeed), redeemFromCurve(...), buyFromPool(...), sellToPool(...).
|↙ ПОТРЕБЛЯЕТ: C.3.01.01 (CurveController), C.3.01.02 (PoolController), C.4.01.01 (ReserveManager).
|↘ ПРЕДОСТАВЛЯЕТ: T.3.01.* (invariant-проверки).
|Реализация: Solidity; действия ограничены бизнес-правилами через try/catch.
|W.1.01.01|Web|dApp|HTML|web/dapp/index.html|W.1.01.02, W.1.01.06|v.0.0.02|Planned|§15.2|
|Описание: Главная страница dApp. Подключает app.js и styles.css. Содержит DOM-контракт (id-шники для JS). Добавлены секции для отображения treasury, sellTeamFee и round-trip cost.
|Публичный API:
- <div id="app">
- <section id="wallet-connect">
- <section id="balance">
- <section id="buy-form">
- <section id="sell-form">
- <section id="fee-display">                                            // НОВОЕ
  - <span id="sell-team-fee">
  - <span id="treasury-address">
  - <span id="round-trip-cost">
- <section id="history">
|↙ ПОТРЕБЛЯЕТ:
- W.1.01.02 app.js (подключение через <script src>)
- W.1.01.06 styles.css (подключение через <link rel>)
|↘ ПРЕДОСТАВЛЯЕТ:
- DOM-контракт (id-шники) для app.js
- UI для взаимодействия с XartIA
- UI для отображения sellTeamFee, treasury, round-trip cost                // НОВОЕ
|Реализация: Чистый HTML5, семантические теги.
|Примечания: НОВОЕ 13-я ИТЕРАЦИЯ (ревизия 2): добавлена секция fee-display с id-шниками sell-team-fee, treasury-address, round-trip-cost. Необходима для отображения protocol revenue, treasury и расчёта потерь пользователя при round-trip. Соответствует правкам в W.1.01.02 app.js.
ЦИКЛ УСТРАНЁН: index.html зависит от app.js и styles.css, но не наоборот. DOM-контракт — это id-шники, а не файл.

|W.1.01.02|Web|dApp|JavaScript|web/dapp/app.js|W.1.01.14|v.0.0.02|Planned|§15.2|
|Описание: JavaScript логика dApp. Кошелёк, вызовы контрактов, события. Работает с DOM через id-шники. Добавлены функции для отображения protocol revenue (sellTeamFee, treasury) и round-trip cost.
|Публичный API:
- async function connectWallet()
- async function buyFromCurve(amount, minOut, deadline)
- async function buyFromPool(amount, minOut, deadline)
- async function sellToPool(amount, minOut, deadline)
- async function redeemFromCurve(amount, minOut, deadline)
- async function getBalance()
- async function getHistory()
- async function getSellTeamFee()                                       // НОВОЕ
- async function getTreasury()                                          // НОВОЕ
- async function getBuyFee()                                            // НОВОЕ
- async function getRedeemFee()                                         // НОВОЕ
- async function getRoundTripCost()                                     // НОВОЕ
- async function renderFeeDisplay()                                     // НОВОЕ
|↙ ПОТРЕБЛЯЕТ:
- W.1.01.14 abis/index.js (ABI и адреса)
- ethers.js
- DOM-контракт (id-шники, определённые в W.1.01.01): sell-team-fee, treasury-address, round-trip-cost
|↘ ПРЕДОСТАВЛЯЕТ:
- Интерфейс для пользователя
- Отображение protocol revenue и round-trip cost                         // НОВОЕ
|Реализация: Vanilla JS + ethers.js v6.
getSellTeamFee():
  (1) curveController.sellTeamFee() → uint256 (bp)
  (2) возвращает значение
getTreasury():
  (1) curveController.treasury() → address
  (2) возвращает checksummed address
getBuyFee():
  (1) curveController.buyFee() → uint256 (bp)
getRedeemFee():
  (1) curveController.redeemFee() → uint256 (bp)
getRoundTripCost():
  (1) buyFee = await getBuyFee()
  (2) redeemFee = await getRedeemFee()
  (3) sellTeamFee = await getSellTeamFee()
  (4) totalBp = buyFee + redeemFee + sellTeamFee
  (5) возвращает { totalBp, percent: totalBp / 100 }
renderFeeDisplay():
  (1) document.getElementById('sell-team-fee').textContent = `${sellTeamFee / 100}%`
  (2) document.getElementById('treasury-address').textContent = treasury
  (3) document.getElementById('round-trip-cost').textContent = `~${(totalBp / 100).toFixed(2)}%`
  (4) Вызывается при connectWallet и при обновлении параметров через событие SellTeamFeeUpdated
|Примечания: НОВОЕ 13-я ИТЕРАЦИЯ (ревизия 2):
- Добавлены getSellTeamFee() и getTreasury() — читают из CurveController через ABI.
- Добавлены getBuyFee(), getRedeemFee() — для расчёта round-trip cost.
- Добавлена getRoundTripCost() — считает сумму buyFee + redeemFee + sellTeamFee в bp.
- Добавлена renderFeeDisplay() — обновляет DOM-элементы sell-team-fee, treasury-address, round-trip-cost.
- Подписка на событие SellTeamFeeUpdated для реактивного обновления UI при governance-изменении.
ЦИКЛ УСТРАНЁН: app.js не зависит от файла index.html. Зависимость от DOM — контрактная, через id.
РАНЕЕ: добавлены minOut/deadline в торговые функции.

|W.1.01.03|Web|dApp|ABI|web/dapp/abi/XartIAToken.json|C.1.01.01|v.0.0.01|Planned|§15.1|
|Описание: ABI XartIAToken.

|Публичный API:
- DOM-контракт/JS-модуль dApp; публичного API нет.
|↙ ПОТРЕБЛЯЕТ:
- C.1.01.01
|↘ ПРЕДОСТАВЛЯЕТ:
- элемент проекта
|Реализация: ABI-файл.

|W.1.01.04|Web|dApp|ABI|web/dapp/abi/CurveController.json|C.3.01.01|v.0.0.01|Planned|§15.1|
|Описание: ABI CurveController.

|Публичный API:
- DOM-контракт/JS-модуль dApp; публичного API нет.
|↙ ПОТРЕБЛЯЕТ:
- C.3.01.01
|↘ ПРЕДОСТАВЛЯЕТ:
- элемент проекта
|Реализация: ABI-файл.

|W.1.01.05|Web|dApp|ABI|web/dapp/abi/PoolController.json|C.3.01.02|v.0.0.01|Planned|§15.1|
|Описание: ABI PoolController.

|Публичный API:
- DOM-контракт/JS-модуль dApp; публичного API нет.
|↙ ПОТРЕБЛЯЕТ:
- C.3.01.02
|↘ ПРЕДОСТАВЛЯЕТ:
- элемент проекта
|Реализация: ABI-файл.

|W.1.01.06|Web|dApp|CSS|web/dapp/styles.css|—|v.0.0.01|Planned|§15.2|
|Описание: CSS стили dApp. Минимализм, адаптивность, тёмная тема.
|Публичный API:
- :root { --bg, --fg, --accent }
- .btn { }
- .form { }
- .card { }
- @media (max-width: 768px) { }
|↙ ПОТРЕБЛЯЕТ: — (нет зависимостей)
|↘ ПРЕДОСТАВЛЯЕТ:
- Визуальное оформление
|Реализация: Vanilla CSS, без фреймворков.
|Примечания: ИСПРАВЛЕНО 8-я ИТЕРАЦИЯ: удалена строка «- W.1.01.01 index.html» из блока ↙ ПОТРЕБЛЯЕТ. Ранее было противоречие: список зависимостей содержал index.html, а примечание утверждало, что зависимость убрана. styles.css — самостоятельный файл, index.html подключает его через <link rel>, обратной зависимости нет. ЦИКЛ УСТРАНЁН.

|W.1.01.07|Web|dApp|ABI|web/dapp/abi/ReserveManager.json|C.4.01.01|v.0.0.01|Planned|§15.1|
|Описание: ABI ReserveManager.

|Публичный API:
- DOM-контракт/JS-модуль dApp; публичного API нет.
|↙ ПОТРЕБЛЯЕТ:
- C.4.01.01
|↘ ПРЕДОСТАВЛЯЕТ:
- элемент проекта
|Реализация: ABI-файл.

|W.1.01.08|Web|dApp|ABI|web/dapp/abi/Vesting.json|C.5.01.01|v.0.0.01|Planned|§15.1|
|Описание: ABI Vesting.

|Публичный API:
- DOM-контракт/JS-модуль dApp; публичного API нет.
|↙ ПОТРЕБЛЯЕТ:
- C.5.01.01
|↘ ПРЕДОСТАВЛЯЕТ:
- элемент проекта
|Реализация: ABI-файл.

|W.1.01.09|Web|dApp|ABI|web/dapp/abi/Governance.json|C.7.01.01|v.0.0.01|Planned|§15.1|
|Описание: ABI Governance.

|Публичный API:
- DOM-контракт/JS-модуль dApp; публичного API нет.
|↙ ПОТРЕБЛЯЕТ:
- C.7.01.01
|↘ ПРЕДОСТАВЛЯЕТ:
- элемент проекта
|Реализация: ABI-файл.

|W.1.01.10|Web|dApp|ABI|web/dapp/abi/XartIAFactory.json|C.8.01.01|v.0.0.01|Planned|§15.1|
|Описание: ABI XartIAFactory.

|Публичный API:
- DOM-контракт/JS-модуль dApp; публичного API нет.
|↙ ПОТРЕБЛЯЕТ:
- C.8.01.01
|↘ ПРЕДОСТАВЛЯЕТ:
- элемент проекта
|Реализация: ABI-файл.

|W.1.01.11|Web|dApp|JSON|web/dapp/package.json|—|v.0.0.01|Planned|§15.2|
|Описание: package.json dApp. Зависимости: ethers.js, wagmi, viem.

|Публичный API:
- DOM-контракт/JS-модуль dApp; публичного API нет.
|↙ ПОТРЕБЛЯЕТ:
- — (нет зависимостей)
|↘ ПРЕДОСТАВЛЯЕТ:
- элемент проекта
|Реализация: JSON-файл, проверяется схемой и CI.

|W.1.01.12|Web|dApp|Markdown|web/dapp/README.md|W.1.01.01|v.0.0.01|Planned|§15.2|
|Описание: README dApp. Запуск, деплой, интеграция.

|Публичный API:
- DOM-контракт/JS-модуль dApp; публичного API нет.
|↙ ПОТРЕБЛЯЕТ:
- W.1.01.01
|↘ ПРЕДОСТАВЛЯЕТ:
- элемент проекта
|Реализация: Markdown-документ.

|W.1.01.13|Web|dApp|ENV|web/dapp/.env.example|—|v.0.0.01|Draft|§15.2|
|Описание: Пример .env для dApp. RPC_URL, CHAIN_ID, адреса контрактов.

|Публичный API:
- DOM-контракт/JS-модуль dApp; публичного API нет.
|↙ ПОТРЕБЛЯЕТ:
- — (нет зависимостей)
|↘ ПРЕДОСТАВЛЯЕТ:
- элемент проекта
|Реализация: Файл переменных окружения (пример); реальные значения не коммитятся.

|W.1.01.14|Web|dApp|JavaScript|web/dapp/abis/index.js|W.1.01.03, W.1.01.04, W.1.01.05, W.1.01.07, W.1.01.08, W.1.01.09, W.1.01.10|v.0.0.02|Planned|§15.2|
|Описание: 
1	Migration-план без upgradeability	O.3.01.03 upgrade-guide.md	Draft
2	Геофенсинг США/ЕС	L.2.01.01 terms.md, L.3.01.01	Draft
3	KYC/AML план B	L.2.01.01, L.3.01.01	не прописан
4	Внешнее юридическое заключение	L.3.01.01 jurisdiction.pdf	Draft
5	Внешний аудит
|Публичный API:
- export { default as XartIAToken } from './XartIAToken.json'
- export { default as CurveController } from './CurveController.json'
- export { default as PoolController } from './PoolController.json'
- export { default as ReserveManager } from './ReserveManager.json'
- export { default as Vesting } from './Vesting.json'
- export { default as Governance } from './Governance.json'
- export { default as XartIAFactory } from './XartIAFactory.json'
- export const ADDRESSES = {
    polygon: {
      chainId: 137,
      token: '0x...',
      curveController: '0x...',
      poolController: '0x...',
      reserveManager: '0x...',
      vesting: '0x...',
      governance: '0x...',
      factory: '0x...',
      treasury: '0x...',                                          // НОВОЕ
    },
    amoy: {
      chainId: 80002,
      token: '0x...',
      curveController: '0x...',
      poolController: '0x...',
      reserveManager: '0x...',
      vesting: '0x...',
      governance: '0x...',
      factory: '0x...',
      treasury: '0x...',                                          // НОВОЕ
    }
  }
|↙ ПОТРЕБЛЯЕТ:
- W.1.01.03–W.1.01.10 (все ABI)
|↘ ПРЕДОСТАВЛЯЕТ:
- Единый импорт ABI и адресов
- treasury для каждой сети
|Реализация: ES modules.
|Примечания: ИСПРАВЛЕНО 13-я ИТЕРАЦИЯ (ревизия 4): добавлено поле treasury в ADDRESSES для polygon и amoy. Ранее treasury отсутствовал в конфиге, хотя frontend может его кэшировать (addr неизменяем после деплоя). Также добавлены ReserveManager, Vesting, Governance, XartIAFactory — ранее они были только в списке зависимостей W.1.01.03–W.1.01.10, но не экспортировались. Версия поднята с v.0.0.01 до v.0.0.02.
Адреса обновляются после каждого деплоя. Если treasury == safe, в конфиге можно указать тот же адрес.


|W.100|Web|dApp|ENV|долг|—|на потом|Draft|§15.2|
