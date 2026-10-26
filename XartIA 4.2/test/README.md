# Тесты XartIA

## Структура
test/
├── unit/ # T.1.* — unit-тесты на каждый контракт
├── fuzz/ # T.2.* — Foundry Fuzz (10 000 runs)
├── invariant/ # T.3.* — Foundry Invariant (1000 runs × 100 depth)
├── crash/ # T.5.* — сценарии массового выхода, манипуляций, reentrancy
├── integration/ # T.4.* — полный цикл, переходы через уровни
├── gas/ # T.6.* — лимиты газа
└── utils/ # T.7.* — общие хелперы и моки

text

## Запуск

```bash
# Все тесты
forge test

# По уровню
forge test --match-path 'test/unit/*'
forge test --match-path 'test/fuzz/*'
forge test --match-path 'test/invariant/*'
forge test --match-path 'test/crash/*'
forge test --match-path 'test/integration/*'
forge test --match-path 'test/gas/*'

# По конкретному контракту
forge test --match-contract CurveControllerTest -vv

# С покрытием
forge coverage --report lcov
Покрытие
Цель: ≥ 95% по строкам и веткам. CI (I.1.01.01) падает, если покрытие ниже.

Инварианты (T.3.*)
Каждый invariant-тест использует XartIAHandler — fuzz-контракт, генерирующий валидные операции (buyFromCurve, buyFromPool, redeemFromCurve, sellToPool, warp). Revert от бизнес-правил (Circuit Breaker, maxBalance, maxPurchasePct, freeReserve) перехватывается через try/catch — invariant проверяется только на успешных операциях.

Ключевые инварианты:

reserve ≥ R(S_curve) — T.3.01.01

totalSupply == S_curve — T.3.01.02

poolPrice ∈ [P(S)/(1+GAP), P(S)*(1+GAP)] — T.3.01.03

freeReserve + curveBacking == reserve — T.3.01.04

poolPrice монотонен при sellToPool — T.3.01.05

P(S) непрерывна на границах уровней — T.3.01.06

reserve() == toWei(balanceOf(reserveManager)) — T.3.01.07

balanceOf(poolController) == poolState.pool() — T.3.01.08

treasury_balance монотонно неубывающий — T.3.01.09

Crash-сценарии (T.5.*)
MassExit — 10%, 25%, 50%, 80%, 100% держателей выходят

Whale — кит с большим % supply

Cycles — 100+ BUY/SELL циклов

PoolCycle — sellToPool/buyFromPool циклы

CircuitBreakerTrigger — три сценария срабатывания CB

EarlySellFee, MinimalPurchase, MaxBalance, FreeReserveDepletion

LevelDowngrade — переход через границу уровня вниз

PoolPriceManipulation — попытки обойти коридор

ReserveInvariantViolation — попытки нарушить инвариант

Reentrancy — с ReentrancyAttacker и hook'ом в MockUSDC

ZeroScurve, SlippageDeadline, PauseUnpause, RegisterParams

CascadeBuyFromPool, SellTeamFee

Добавление теста
Создать файл test/<level>/<Name>.t.sol, наследник TestHelpers (см. test/utils/TestHelpers.sol).

Использовать deployFullSystem() или deployFullSystemFinalized() для полной системы.

Для изоляции — прямое развёртывание контракта (как в CurveControllerConstructor.t.sol).

Обновить R.2.01.11 audit-checklist.md при добавлении нового инварианта.

text

---

## План порций

Закрыты 8 файлов (интерфейсы + test utils). Дальше — порциями:

| Порция | Файлы | Объём |
|---|---|---|
| **17b** | `.gitignore`, `.prettierrc`, `Makefile`, `.editorconfig`, `.nvmrc`, `LICENSE`, `package.json`, `.solhint.json`, `DeployToken.s.sol`, `DeployMath.s.sol` | ~10 файлов, конфиги |
| **17c** | `README.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, `CHANGELOG.md` | 5 Meta |
| **17d** | `e/01_core/*.md` (7 доков) | экономика |
| **17e** | Python: `e/02_simulation/*.py` (7), `e/03_calibration/tune_params.py` + `params_output.{json,csv}`, `scripts/python/*.py` (6), `scripts/shell/{build,test}.sh` | ~18 |
| **17f** | `governance/snapshot/*.json` (3), `governance/proposals/*.md` (4), `.github/workflows/*.yml` (4), `.github/{ISSUE,PULL}_TEMPLATE.md`, `dependabot.yml` | ~14 |
| **17g** | `legal/*.md` (6), `legal/opinion/jurisdiction.pdf` (заглушка), `legal/audit-report.pdf` (заглушка) | 8 |
| **17h** | `ops/monitoring/*` (5), `ops/indexer/*` (4), `ops/*.md` (5), `ops/metrics.md` | ~15 |
| **17i** | `docs/spec/*.md` (2), `docs/tech/*.md` (11), `docs/registry/*.md` (7), `docs/audit/README.md` | ~21 |
| **17j** | `web/dapp/*` (14 файлов) | dApp |