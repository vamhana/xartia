# Changelog — XartIA

Все значимые изменения проекта фиксируются в этом файле. Формат основан на
[Keep a Changelog](https://keepachangelog.com/ru/1.1.0/), версионирование —
[Semantic Versioning](https://semver.org/lang/ru/).

Разработческий changelog (технические детали, breaking changes, миграции) —
`docs/registry/changelog.md` (R.3.01.03).

---

## [Unreleased]

### Planned
- Внешний аудит (см. `legal/audit-report.pdf`)
- Юридическое заключение (см. `legal/opinion/jurisdiction.pdf`)
- Деплой на Amoy testnet
- Bug bounty program (после mainnet)
- dApp (frontend) — `web/dapp/`
- Subgraph — `ops/indexer/`

---

## [0.0.1] — 2026-10-26 (draft)

**Статус:** pre-audit, pre-mainnet. Не использовать с реальными средствами.

### Added

#### Контракты (C.*)
- **XartIAToken** (C.1.01.01) — ERC-20 `XRT`, 18 decimals. `mint` / `burnFrom` через
  `MINTER_ROLE` / `BURNER_ROLE`. `burnFrom` использует allowance-модель — компромисс
  `BURNER_ROLE` без явного `approve` пользователя бесполезен.
- **CurveController** (C.3.01.01) — `buyFromCurve`, `redeemFromCurve`, `buyFromCurveFor` (pull-модель).
  Комиссии: `buyFee` 0.5%, `redeemFee` 0.5%, `sellTeamFee` 0.1%, `earlySellFee` 0–5%.
  Поддержка коридора `poolPrice`, genesis-исключение `MAX_CURVE_FOR_PCT`.
- **PoolController** (C.3.01.02) — `buyFromPool` (каскад с кривой), `sellToPool` (с `dailySold`
  и `maxSellPctPerDay`). Sweep-dust: `balanceOf(poolController) == 0` между транзакциями.
- **ReserveManager** (C.4.01.01) — кастодиан USDC. Инвариант `reserve ≥ curveBacking`.
  `updateScurve` / `pay` — только `CONTROLLER_ROLE`.
- **Vesting** (C.5.01.01) — `teamTokens` 0.5% от `ΔS`. Cliff 365 дней, duration 730 дней.
  Beneficiary — Safe Multisig (immutable).
- **CircuitBreaker** (C.6.01.01) — порог 5–20% от `freeReserve / reserve`. Блокирует `sellToPool`,
  не блокирует `buyFromCurve` / `redeemFromCurve`.
- **Governance** (C.7.01.01) + **Timelock** (C.7.01.02) — Safe Multisig → Governance → Timelock
  (7 дней) → целевой контракт. `onlySafe` на мутациях Governance.
- **XartIAFactory** (C.8.01.01) — полный деплой системы, `initializeLevels`,
  `initializePoolPrice`, `registerParams`, `finalize`. Валидация `safe`, `treasury`, `usdc`.
- **ParameterRegistry** (C.0.01.02) — реестр governance-параметров с bounds.
- **Levels** (C.2.01.09) — иммутабельная таблица уровней. Проверка непрерывности `S` и `P`.
- **PoolState** (C.2.01.12) — dual-authority (`Ownable` + `AccessControl`), `initializePoolPrice`
  одноразово, `setPool` / `setPoolPrice` через роли.
- **CurveMath** (C.2.01.01) — `P`, `R`, `deltaSForBuy` (бинарный поиск), `amountForRedeem`,
  `getLevel`. `internal pure`.
- **LevelMath** (C.2.01.02) — `a`, `b`, `P_i`, `R_i`, `inBounds`.
- **MathLib** (C.9.01.01) — `mulDiv` (512-bit), `mulDivUp`, `sqrt` (Babylonian), `min`, `max`, `abs`.
- **PrecisionLib** (C.9.01.02) — конвертация 18↔6 decimals.
- **CurveMathWrapper** (C.2.01.13) — external обёртка над internal-математикой (для кросс-проверки
  Solidity ↔ Python).

#### Параметры (default)
- `buyFee` = 50 bp (0.5%)
- `redeemFee` = 50 bp (0.5%)
- `earlySellFee` = 0 bp (0%)
- `earlySellPeriod` = 0 сек
- `maxPurchasePct` = 500 bp (5%)
- `minimalPurchase` = 1e6 (1 USDC)
- `maxSellPctPerDay` = 200 bp (2%)
- `CircuitBreaker.threshold` = 1000 bp (10%)
- `sellTeamFee` = 10 bp (0.1%)
- `TEAM_PERCENT` = 50 bp (0.5% — teamTokens)
- `MAX_GAP` = 1000 bp (10%)
- `TIMELOCK_DELAY` = 7 days
- `MAX_LEVELS` = 10

#### Тесты (T.*)
- **Unit** (T.1.*) — 25 файлов, ~500 тестов.
- **Fuzz** (T.2.*) — 7 файлов, 10 000 runs.
- **Invariant** (T.3.*) — 9 файлов + `XartIAHandler`. Проверяет `reserve ≥ curveBacking`,
  `totalSupply == S_curve`, `poolPrice` в коридоре, `freeReserve + curveBacking == reserve`,
  монотонность `poolPrice`, непрерывность `P(S)`, `reserve() == toWei(balanceOf)`,
  `balanceOf(poolController) == pool`, `treasury_balance` монотонно неубывающий.
- **Crash** (T.5.*) — 19 файлов. `MassExit`, `Whale`, `Cycles`, `PoolCycle`, `CircuitBreakerTrigger`,
  `EarlySellFee`, `MinimalPurchase`, `MaxBalance`, `FreeReserveDepletion`, `LevelDowngrade`,
  `PoolPriceManipulation`, `ReserveInvariantViolation`, `Reentrancy`, `ZeroScurve`,
  `SlippageDeadline`, `PauseUnpause`, `RegisterParams`, `CascadeBuyFromPool`, `SellTeamFee`.
- **Integration** (T.4.*) — `FullCycle`, `LevelTransition`.
- **Gas** (T.6.*) — `buyFromCurve ≤ 250k`, `redeemFromCurve ≤ 250k`, `buyFromPool ≤ 200k`,
  `sellToPool ≤ 200k`, `levelTransition ≤ 300k`.
- **Utils** (T.7.*) — `TestHelpers`, `MockUSDC` (с reentrancy-hook), `MockSafe`, `TimeHelpers`,
  `ReentrancyAttacker`, `ErrorsWrapper`, `CallFailTarget`, `InvariantBase`, `InvariantBaseExt`,
  `XartIAHandler`, `MockERC20`.

#### Скрипты (D.1.*)
- `Deploy.s.sol` — деплой Factory + чтение TOML-конфига + запись `deployments/<network>.json`.
- `Initialize.s.sol` — `initializeLevels` + `initializePoolPrice` + `registerParams`.
- `Finalize.s.sol` — передача ownership на Safe + pre-flight validation.
- `Verify.s.sol` — вывод адресов для `forge verify-contract`.
- `DeployToken.s.sol` — изолированный деплой токена.
- `DeployMath.s.sol` — deprecated (математика — `internal pure`, инлайнится).

#### Конфиги (D.2.*)
- `config/polygon.toml` (chainId 137, USDC `0x2791…4174`, `initial_threshold = 1000`,
  `p0_initial_pool_price_6dec = 2000`).
- `config/amoy.toml` (chainId 80002, test USDC, те же параметры).
- `config/levels.json` — 3 уровня `[0, 50k]`, `[50k, 250k]`, `[250k, 1.25M]`.
- `config/.env.example` — `PRIVATE_KEY`, `NETWORK`, `POLYGONSCAN_API_KEY`, `RPC_URL`.

#### Экономика и симуляции (E.*)
- `e/01_core/` — 7 спек: `price_function.md`, `integral_function.md`, `levels_table.md`,
  `delta_s_solver.md`, `pool_price_formula.md`, `invariant_proof.md`, `pool_price_proof.md`.
- `e/02_simulation/` — Python-модели: `base_model.py`, `crash_mass_exit.py`, `crash_whale.py`,
  `crash_cycles.py`, `crash_pool.py`, `crash_levels.py`, `crash_full_cycle.py`.
  Покрывают `treasury_monotonic` и `reserve ≥ R(S)` в Python до реализации в Solidity.
- `e/03_calibration/` — `tune_params.py` + `params_output.{json,csv}`.

#### Документация (R.*)
- `docs/spec/xartia_4.2.md` (R.1.01.01) — спецификация контрактов.
- `docs/spec/tz.md` (R.1.01.02) — техническое задание.
- `docs/tech/*` (R.2.*) — architecture, api, contracts, events, deployment-guide,
  integration-guide, api-reference, security-model, threat-model, testing-guide, audit-checklist.
- `docs/registry/*` (R.3.*) — files, glossary, changelog (developer), contributing,
  security, faq, roadmap.

#### Юридическое (L.*)
- `legal/whitepaper.md`, `legal/whitepaper-ru.md` (L.1.01.01–02).
- `legal/token-classification.md` (L.1.01.03) — Howey Test, MiCA, sellTeamFee как фактор риска.
- `legal/terms.md`, `legal/privacy.md`, `legal/disclaimer.md`, `legal/cookies.md` (L.2.*).

#### Операционное (O.*)
- `ops/monitoring/*` — dashboard, alerts, grafana, prometheus, tenderly.
- `ops/indexer/*` — subgraph (с `handleSellTeamFeeUpdated`), schema, networks.
- `ops/runbook.md`, `incident-response.md`, `emergency-procedures.md`, `upgrade-guide.md`, `backup.md`, `metrics.md`.

#### Governance (G.*)
- `governance/snapshot/*` — space, strategy (квадратичное голосование), validation.
- `governance/proposals/*` — шаблоны: params, emergency, upgrade, budget.

#### dApp (W.*)
- `web/dapp/*` — index.html, app.js, styles.css, ABI-файлы, package.json, README, .env.example.

#### CI/Infra (I.*)
- `.github/workflows/test.yml` — `forge test` + `coverage ≥ 95%`.
- `.github/workflows/deploy.yml` — manual dispatch, mainnet требует 2 approvals.
- `.github/workflows/audit.yml` — slither, mythril weekly.
- `.github/workflows/release.yml` — тегирование, публикация ABI.
- `.github/ISSUE_TEMPLATE.md`, `.github/PULL_REQUEST_TEMPLATE.md`, `.github/dependabot.yml`.

#### Мета (I.2.*, D.2.*)
- `README.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, `CHANGELOG.md`.
- `LICENSE` — AGPL-3.0-only.
- `Makefile`, `foundry.toml`, `remappings.txt`, `.gitignore`, `.prettierrc`, `.editorconfig`,
  `.nvmrc`, `.solhint.json`, `package.json`.

### Changed

- **Отказ от bonding curve 4.2 в пользу `id_2.md`.** XartIA 5.0 (пол 1.00 + NAV) — архив,
  в код не идёт. `XartIA 5.0.md` сохранён в репозитории как reference.
- **`burnFrom` использует allowance-модель** (изменение безопасности). Убран `burn(address,uint256)`.
- **`ReserveManager.pay`** конвертирует 18→6 decimals через `PrecisionLib.toUSDC` (вниз,
  накопленная пыль остаётся в резерве).
- **`poolPrice` хранится в 18 decimals.** `initialPrice_18` принимается в 18-dec; в TOML-конфиге
  `p0` в 6-dec, `Initialize.s.sol` конвертирует через `* 1e12`.
- **`buyFromCurveFor`** использует pull-модель (`safeTransferFrom` от `msg.sender`), защищён
  immutable `poolController`, не ролью `POOL_CALLER_ROLE` (роль остаётся в `Roles.sol` для
  обратной совместимости).
- **`sellTeamFee`** добавлен как governance-параметр (`PARAM_SELL_TEAM_FEE`, bounds `[0, 50]`).
  Default 10 bp. Идёт в immutable `treasury`, не распределяется между держателями XRT.
- **`X_18` нормализуется** в `buyFromCurveFor`: `X_18 = toWei(toUSDC(X_18))` перед `deltaSForBuy`.
  Устраняет пыль и потенциальный revert `ReserveInvariantViolation`.
- **`CircuitBreaker.active()`** при `reserve == 0` возвращает `false` (семантически — «нет
  резерва, нет срабатывания», пол защищён отдельно через `NotInitialized`).
- **`TIMELOCK_DELAY = 7 days`** (было 48h в раннем драфте 4.2).
- **`MAX_GAP = 10%`** — симметричный коридор (было 20% в одну сторону).
- **`Levels.init()`** проверяет непрерывность (`S_end_i == S_start_{i+1}`, `P_end_i == P_start_{i+1}`)
  и монотонность (`P_end_i ≥ P_start_i`). Без этого `T.3.01.06` не проходит.

### Deprecated

- `script/DeployMath.s.sol` — математика `internal pure`, инлайнится. `run()` ревертит.
- `Roles.POOL_CALLER_ROLE` — не используется (pull-модель через immutable `poolController`).
  Оставлен для обратной совместимости.
- `XartIA 5.0.md` — заменён `id_2.md`, но сохранён в репо.

### Removed

- `CurveMath.analyticalDeltaSForBuy` — заменён бинарным поиском (численно стабильнее).
- `PoolController.pause()` — перенесён в `AccessControl` через `PAUSER_ROLE`.
- `ReserveManager.transfer` — нет публичного API. Только `pay(to, amount_18)` под `CONTROLLER_ROLE`.

### Security

- **Pull-модель** в `buyFromCurveFor` — минтинг без реального USDC невозможен.
- **Sweep-dust** в `PoolController.buyFromPool` (шаг 14b) — инвариант `balanceOf(poolController) == 0`
  между транзакциями.
- **`Treasury` не имеет ролей** ни в одном контракте (тест `T.1.01.18`).
- **`finalize()`** отзывает `DEFAULT_ADMIN_ROLE` и `GOVERNANCE_ROLE` у Factory во всех 9
  AccessControl-контрактах.
- **`setPoolController`** — one-time (`AlreadyInitialized` при повторе).
- **`CircuitBreaker.active()`** не срабатывает на `reserve == 0` (защита от деления на ноль).
- **`Timelock.queue` и `execute`** проверяют `target.code.length > 0` — блокирует EOA и
  selfdestruct-сценарии.
- **`ParameterRegistry.register`** проверяет `target != address(0)`, `setter != bytes4(0)`,
  `min ≤ max`, `!exists`.
- **`X_18` нормализация** предотвращает revert `ReserveInvariantViolation` из-за пыли.
- **`buyFromCurve` genesis-исключение `MAX_CURVE_FOR_PCT`** (лимит только при `S_curve() > 0`).
- **Round-trip cost** (buy + immediate redeem без earlySellFee) = 1.1%.

### Known issues

- **`MathLib.abs(int256.min)`** не защищён от `type(int256).min`. Не используется в протоколе,
  помечено в `docs/tech/audit-checklist.md`.
- **`Whale.test_whale_maxSellPctPerDay`** — упрощённая проверка (см. TODO в `test/crash/Whale.t.sol`).
  Полный сценарий — в `PoolController.t.sol::test_sellToPool_maxSellPctPerDay`.
- **`CurveMath.deltaSForBuy`** — бинарный поиск, не аналитика. Для экстремальных `X` (близко к
  `S_end_last`) возвращает `ΔS` на границе (покрыто fuzz-тестом T.2.01.01).
- **`poolPrice` не проверяется `> 0`** в `PoolState.setPoolPrice` — по спецификации это
  ответственность контроллеров. Мониторинг `PoolPriceUpdated(_, 0)` — alert.

---

## Ссылки

- Аудит: `legal/audit-report.pdf` (не проведён, статус — pending)
- Юридическое заключение: `legal/opinion/jurisdiction.pdf` (не получено, статус — pending)
- Whitepaper: `legal/whitepaper.md` (L.1.01.01)
- Спецификация: `docs/spec/xartia_4.2.md` (R.1.01.01)
- Developer changelog: `docs/registry/changelog.md` (R.3.01.03)
- Roadmap: `docs/registry/roadmap.md` (R.3.01.07)

