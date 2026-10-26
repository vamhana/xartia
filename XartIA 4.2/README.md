# XartIA

**Bonding curve protocol with internal pool, USDC-backed reserve, and protocol-level circuit breaker.**

XartIA — это протокол для выпуска и обмена токена XRT (ERC-20, 18 decimals) через bonding curve.
Пользователи покупают и продают XRT за USDC; цена определяется кусочно-линейной кривой P(S),
резерв (ReserveManager) обеспечивает покрытие всех эмитированных токенов, а внутренний пул
(PoolController) предоставляет альтернативный канал ликвидности с ограниченным коридором цены.

**Статус:** draft, pre-mainnet. Внешний аудит не пройден. Деплой на Polygon PoS — после аудита и
юридического заключения (см. `legal/opinion/jurisdiction.pdf`, `legal/audit-report.pdf`).

---

## Содержание

- [Что это](#что-это)
- [Архитектура](#архитектура)
- [Ключевые параметры](#ключевые-параметры)
- [Структура репозитория](#структура-репозитория)
- [Быстрый старт](#быстрый-старт)
- [Тесты](#тесты)
- [Деплой](#деплой)
- [Безопасность](#безопасность)
- [Лицензия](#лицензия)
- [Контакты](#контакты)

---

## Что это

XartIA — не токен с обещанием доходности и не AMM. Это учётная система для замкнутого
экономического контура:

1. **Bonding curve** — цена P(S) задаётся таблицей уровней (Levels). Каждый уровень — линейный
   сегмент от `P_start` до `P_end`. Кривая монотонно возрастает и непрерывна на границах уровней
   (проверяется в `Levels.init()`).

2. **Резерв (ReserveManager)** — кастодиан USDC. Хранит инвариант `reserve ≥ R(S_curve)`, где
   `R(S)` — интеграл P от 0 до S. Если инвариант нарушается, `updateScurve` ревертит с
   `ReserveInvariantViolation`.

3. **Пул (PoolController)** — альтернативная ликвидность для XRT/USDC. Цена пула ограничена
   симметричным коридором `[P(S)/(1+MAX_GAP), P(S)*(1+MAX_GAP)]`, где `MAX_GAP = 10%`.
   Каскадный `buyFromPool → buyFromCurveFor` добирает недостающую ликвидность с кривой.

4. **Circuit Breaker** — предохранитель. Срабатывает, когда `freeReserve / reserve < threshold`
   (5–20%, default 10%), и блокирует `sellToPool`, но **не** `buyFromCurve` / `redeemFromCurve`.

5. **Governance** — Safe Multisig 3/5 → Governance → Timelock (7 дней) → целевой контракт.
   Все управляемые параметры зарегистрированы в `ParameterRegistry` с bounds.

6. **Vesting** — токенная часть дохода команды: 0.5% от `ΔS` на покупках, cliff 365 дней,
   duration 730 дней. `teamTokens` минтится в `Vesting`. USDC-часть (`sellTeamFee` 0.1%)
   идёт в `treasury` — это два независимых канала, не пересекаются.

Полная спецификация — в `docs/spec/xartia_4.2.md` (R.1.01.01) и `docs/spec/tz.md` (R.1.01.02).

---

## Архитектура
┌───────────────────────────────────────────────────────────────────┐
│ XartIAFactory │
│ (deploy → initializeLevels → initializePoolPrice → registerParams│
│ → finalize → ownership на Safe) │
└───────────────────────────────────────────────────────────────────┘
│
├── XartIAToken (ERC-20, "XartIA" / "XRT", 18 dec)
│ ├── MINTER_ROLE → CurveController
│ └── BURNER_ROLE → CurveController
│
├── Levels (иммутабельны после init)
│ └── таблица тиров S_start..S_end, P_start..P_end, maxBalance
│
├── CurveMathWrapper (external обёртка internal-математики)
│
├── PoolState (pool, poolPrice; PRICE_WRITER_ROLE / POOL_WRITER_ROLE)
│
├── ReserveManager (USDC custody; CONTROLLER_ROLE)
│ └── инвариант: reserve() ≥ curveBacking()
│
├── Vesting (teamTokens, cliff 365d, duration 730d)
│
├── CircuitBreaker (threshold 5–20% bp)
│
├── ParameterRegistry (bytes32 → (target, setter, min, max))
│
├── Timelock (7 days; queue / execute / cancel)
│
├── Governance (Safe Multisig → Timelock)
│
├── CurveController (buyFromCurve / redeemFromCurve / buyFromCurveFor)
│
└── PoolController (buyFromPool / sellToPool)

text

Диаграмма ролей, потоков USDC и инвариантов — в `docs/tech/architecture.md` (R.2.01.01).

---

## Ключевые параметры

| Параметр | Значение | Governance-параметр | Bounds |
|---|---:|---|---|
| `buyFee` | 0.5% (50 bp) | `PARAM_BUY_FEE` | 0–200 bp |
| `redeemFee` | 0.5% (50 bp) | `PARAM_REDEEM_FEE` | 0–200 bp |
| `earlySellFee` | 0% (default) | `PARAM_EARLY_SELL_FEE` | 0–500 bp |
| `earlySellPeriod` | 0 сек (default) | `PARAM_EARLY_SELL_PERIOD` | 0–7776000 сек |
| `maxPurchasePct` | 5% (500 bp) | `PARAM_MAX_PURCHASE_PCT` | 0–1000 bp |
| `minimalPurchase` | 1 USDC (1e6) | `PARAM_MINIMAL_PURCHASE` | 1e6–1e12 |
| `maxSellPctPerDay` | 2% (200 bp) | `PARAM_MAX_SELL_PCT_PER_DAY` | 0–500 bp |
| `CircuitBreaker.threshold` | 10% (1000 bp) | `PARAM_CIRCUIT_BREAKER_THRESHOLD` | 500–2000 bp |
| `sellTeamFee` | 0.1% (10 bp) | `PARAM_SELL_TEAM_FEE` | 0–50 bp |
| `teamTokens` | 0.5% от `ΔS` | константа `TEAM_PERCENT = 50` | — |
| `MAX_GAP` (коридор poolPrice) | 10% (1000 bp) | константа | — |
| `TIMELOCK_DELAY` | 7 дней | константа | — |
| `maxBalance` (per level) | из Levels | иммутабельно | — |

**Round-trip cost** (buy + immediate redeem, без earlySellFee): 1.1% базово.
**Vesting:** cliff 365 дней, duration 730 дней, beneficiary = Safe Multisig (immutable).

---

## Структура репозитория
xartia/
├── contracts/ # Solidity-контракты (C.)
│ ├── core/ # Roles, ParameterRegistry, IOwnable
│ ├── math/ # CurveMath, LevelMath, Constants, Errors, Types, Levels, PoolState
│ ├── token/ # XartIAToken
│ ├── controllers/ # CurveController, PoolController
│ ├── reserve/ # ReserveManager
│ ├── vesting/ # Vesting
│ ├── safety/ # CircuitBreaker
│ ├── governance/ # Governance, Timelock
│ ├── factory/ # XartIAFactory
│ ├── libraries/ # MathLib, PrecisionLib
│ └── events/ # Events (abstract)
│
├── script/ # Foundry deploy-скрипты (D.1.)
│ ├── Deploy.s.sol
│ ├── Initialize.s.sol
│ ├── Finalize.s.sol
│ ├── Verify.s.sol
│ ├── DeployToken.s.sol # изолированный
│ └── DeployMath.s.sol # DEPRECATED
│
├── test/ # Foundry тесты (T.1–T.7)
│ ├── unit/
│ ├── fuzz/
│ ├── invariant/
│ ├── crash/
│ ├── integration/
│ ├── gas/
│ └── utils/
│
├── config/ # TOML-конфиги сетей (D.2.)
│ ├── polygon.toml
│ ├── amoy.toml
│ └── levels.json
│
├── scripts/
│ ├── shell/ # deploy.sh, verify.sh, build.sh, test.sh (S.2.)
│ └── python/ # CLI-обёртки для симуляций (S.1.)
│
├── e/ # Экономика и симуляции (E.)
│ ├── 01_core/ # спеки математики (markdown)
│ ├── 02_simulation/ # Python-модели
│ └── 03_calibration/ # результаты калибровки
│
├── docs/ # Документация (R.)
│ ├── spec/ # R.1.
│ ├── tech/ # R.2.*
│ ├── registry/ # R.3.*
│ └── audit/ # R.4.*
│
├── legal/ # L.* — whitepaper, ToS, disclaimers
├── ops/ # O.* — мониторинг, индексатор, runbook
├── governance/ # G.* — Snapshot, шаблоны предложений
├── web/dapp/ # W.* — frontend
│
├── deployments/ # JSON-артефакты деплоя (после deploy)
├── foundry.toml # Foundry config (Solidity 0.8.24, optimizer 200, evm paris)
├── remappings.txt
├── Makefile # make build / test / deploy / verify
├── package.json
├── .solhint.json
├── .prettierrc
├── .editorconfig
├── .nvmrc
├── .gitignore
├── LICENSE # AGPL-3.0-only
├── README.md # этот файл
├── CONTRIBUTING.md
├── CODE_OF_CONDUCT.md
├── SECURITY.md
└── CHANGELOG.md

text

---

## Быстрый старт

### Предварительные требования

- **Foundry** (`forge`, `cast`, `anvil`) — установка: `curl -L https://foundry.paradigm.xyz | bash`, затем `foundryup`
- **Node.js ≥ 20.11.1** (см. `.nvmrc`) — для `prettier`, `solhint`, `prettier-plugin-solidity`
- **Python ≥ 3.11** (для симуляций `e/02_simulation/`) — опционально
- **Git**

### Установка

```bash
git clone <repo-url> xartia
cd xartia

# Foundry зависимости
forge install foundry-rs/forge-std --no-commit
forge install OpenZeppelin/openzeppelin-contracts --no-commit

# Node зависимости (для lint/format)
npm install

# Python (опционально)
python3 -m venv .venv
source .venv/bin/activate
pip install -r e/02_simulation/requirements.txt  # если есть
Сборка
bash
make build
# или
forge build --sizes
Переменные окружения
bash
cp config/.env.example .env
# отредактировать .env:
#   PRIVATE_KEY=
#   POLYGONSCAN_API_KEY=
#   NETWORK=amoy
Тесты
bash
make test                # все тесты
make test-unit           # unit-тесты
make test-fuzz           # fuzz (10 000 runs)
make test-invariant      # invariant (1000 runs × 100 depth)
make test-crash          # crash-сценарии
make test-integration    # integration
make test-gas            # gas-лимиты
make coverage            # покрытие (цель: ≥ 95%)
Подробнее — test/README.md (T.7.01.05) и docs/tech/testing-guide.md (R.2.01.10).

Инварианты
Каждый invariant-тест использует XartIAHandler (fuzz-target), который генерирует валидные
операции и перехватывает revert через try/catch. Проверяются 9 инвариантов:

reserve ≥ R(S_curve) — T.3.01.01

totalSupply == S_curve — T.3.01.02

poolPrice ∈ [P(S)/(1+GAP), P(S)*(1+GAP)] — T.3.01.03

freeReserve + curveBacking == reserve — T.3.01.04

poolPrice монотонен при sellToPool — T.3.01.05

P(S) непрерывна на границах уровней — T.3.01.06

reserve() == toWei(balanceOf(reserveManager)) — T.3.01.07

balanceOf(poolController) == poolState.pool() — T.3.01.08

treasury_balance монотонно неубывающий — T.3.01.09

Деплой
Amoy (testnet)
bash
# 1. Deploy Factory + все контракты
NETWORK=amoy make deploy-amoy

# 2. Initialize (levels + poolPrice + params)
NETWORK=amoy make init

# 3. Верификация на Polygonscan Amoy
NETWORK=amoy make verify

# 4. Finalize (ownership → Safe Multisig)
NETWORK=amoy make finalize
Polygon PoS (mainnet)
⚠️ Требуется:

Внешний аудит (legal/audit-report.pdf) — не проведён

Юридическое заключение (legal/opinion/jurisdiction.pdf) — не получено

Адрес Safe Multisig 3/5 в config/polygon.toml — заполнить

Адрес treasury (или = safe) — заполнить

bash
NETWORK=polygon make deploy-mainnet   # требует подтверждения "yes"
NETWORK=polygon make init
NETWORK=polygon make verify
NETWORK=polygon make finalize
Пошаговая инструкция — docs/tech/deployment-guide.md (R.2.01.05).

Безопасность
Протокол не прошёл внешний аудит. Не используйте с реальными средствами до публикации
отчёта аудита в legal/audit-report.pdf.

Отчёт об уязвимости — SECURITY.md. Bug bounty (после mainnet) — там же.

Ключевые митигации:

pull-модель в buyFromCurveFor — контракт сам тянет USDC, минтинг без реального депозита невозможен

sweep-dust в PoolController — инвариант balanceOf(poolController) == 0 между транзакциями

Treasury не имеет ролей ни в одном контракте (проверяется тестом T.1.01.18)

Симметричный коридор poolPrice (±10%) ограничивает арбитраж между кривой и пулом

Timelock 7 дней на все governance-изменения

NotInitialized защищает окно между deploy и initializePoolPrice

Модель угроз — docs/tech/threat-model.md (R.2.01.09). Модель безопасности — docs/tech/security-model.md (R.2.01.08).

Лицензия
AGPL-3.0-only. Полный текст — LICENSE.

Сетевые сервисы, построенные на коде XartIA, обязаны предоставлять исходный код пользователям
(раздел 13 AGPL).

Контакты
Issues / PR: GitHub Issues

Безопасность: см. SECURITY.md

Юридические вопросы: legal/terms.md (L.2.01.01)

FAQ: docs/registry/faq.md (R.3.01.06)

Roadmap
Краткая версия — в docs/registry/roadmap.md (R.3.01.07). Основные вехи:

☑ Спецификация (R.1.01.01)
☑ Контракты (C.*)
☑ Тесты unit / fuzz / invariant / crash / integration / gas (T.*)
□ Внешний аудит
□ Юридическое заключение
□ Деплой на Amoy
□ Bug bounty
□ Деплой на Polygon PoS
text

---

## `CONTRIBUTING.md` (I.2.01.02)

```markdown
# Contributing to XartIA

Спасибо за интерес к XartIA. Этот документ описывает процесс контрибуции, требования к коду и
правила review. Для внутренней документации — `docs/registry/contributing.md` (R.3.01.04).

---

## Содержание

- [Кодекс поведения](#кодекс-поведения)
- [С чего начать](#с-чего-начать)
- [Рабочий процесс](#рабочий-процесс)
- [Стиль кода](#стиль-кода)
- [Тесты](#тесты)
- [Обязательные проверки](#обязательные-проверки)
- [Процесс review](#процесс-review)
- [Сообщения о багах](#сообщения-о-багах)
- [Безопасность](#безопасность)
- [Лицензия контрибуций](#лицензия-контрибуций)

---

## Кодекс поведения

Все участники обязуются соблюдать `CODE_OF_CONDUCT.md`. Нарушения → `conduct@xartia.example`.

---

## С чего начать

1. Прочитать `README.md` и `docs/spec/xartia_4.2.md` (R.1.01.01).
2. Проверить открытые Issues — возможно, задача уже создана.
3. Для новой функциональности — сначала Issue с обоснованием, потом PR.
4. Для багов — Issue с шагами воспроизведения и минимальным reproduction-кейсом.

---

## Рабочий процесс

### Ветки

- `main` — стабильная, защищённая, деплой только через CI
- `develop` — интеграционная
- `feature/<short-description>` — от `develop`
- `fix/<short-description>` — от `develop`
- `hotfix/<short-description>` — от `main`, после мержа → `main` и `develop`

### Коммиты

Формат — [Conventional Commits](https://www.conventionalcommits.org/):
<type>(<scope>): <short summary>

<optional body><optional footer> ```
Типы: feat, fix, docs, style, refactor, test, chore, perf, ci, build.

Scope — по ID из реестра (C.3.01.01, T.1.01.03, R.2.01.08) или по имени контракта.

Примеры:

text
fix(CurveController): normalize X_18 in buyFromCurveFor
feat(PoolController): add sweep-dust invariant check
test(T.5.01.13): extend reentrancy coverage to buyFromPool
docs(R.2.01.08): clarify Treasury security model
Pull Request
Форк → ветка → изменения → push → PR в develop.

PR-шаблон — .github/PULL_REQUEST_TEMPLATE.md (I.1.01.05). Заполнить все поля.

Связать PR с Issue: Closes #123.

Дождаться зелёного CI (см. .github/workflows/test.yml, I.1.01.01).

Получить минимум один approval.

Squash-merge (кроме случая, когда несколько логических коммитов важны — тогда rebase-merge).

Стиль кода
Solidity
Версия: Solidity 0.8.24 (зафиксирована в foundry.toml), evm_version = "paris".

Отступы: 4 пробела (см. .editorconfig).

Длина строки: ≤ 100 символов (prettier и solhint).

Именование:

contract / library / interface — PascalCase

function / variable — camelCase

constant / immutable — UPPER_SNAKE_CASE (в Constants.sol) или camelCase (в контракте, если локально)

Events — PascalCase (Buy, Redeem, LevelChanged)

Custom errors — PascalCase (InvalidAmount, MaxPurchaseExceeded)

NatSpec — обязателен для всех external / public функций. @inheritdoc — если функция объявлена в интерфейсе.

События — эмитить в Events.sol (abstract contract), а не локально, кроме Mint / Burn в XartIAToken (по спецификации).

Ошибки — только из Errors.sol. Не объявлять error локально.

Роли — только из Roles.sol. Не использовать magic strings.

Параметры immutable — валидировать в конструкторе (!= address(0) и т.п.).

Псевдокод в спецификациях
Стиль псевдокода — в docs/registry/contributing.md (R.3.01.04). Суффиксы _6 / _18 / _bp /
_user / _gross, префикс normalized_. Solidity-имплементация — camelCase:
tokensFromPool, XRemaining18, sellTeamFee, treasuryBalance.

Комментарии
Отвечать почему, не что.

Комментарии из псевдокода (например, «если S_curve() > 0», «если sell_team_fee_18 > 0») —
обязательны к переносу в Solidity.

Ссылки на спецификацию — в формате // C.3.01.01 step (12a).

Форматирование
bash
make fmt          # forge fmt + prettier
make fmt-check    # проверка в CI
make lint         # solhint
Все три проверки должны быть зелёными в PR.

Тесты
Требования
Покрытие ≥ 95% по строкам и веткам (forge coverage).

Все существующие тесты проходят.

Каждая новая функция / ветка — минимум один unit-тест.

Каждая новая invariant — тест в test/invariant/ + запись в docs/tech/audit-checklist.md (R.2.01.11).

Каждая новая governance-параметр — тест в T.5.01.17 RegisterParams + запись в ParameterRegistry bounds.

Каждое новое immutable-поле — тест test_constructor_sets_<field> в *Constructor.t.sol.

Каждое новое событие — тест эмиссии + обработчик в subgraph (O.2.01.01, если индексируется).

Уровни
Уровень	Путь	Что проверяет
unit	test/unit/	функции, граничные случаи, revert-ы
fuzz	test/fuzz/	случайные входы в допустимой области
invariant	test/invariant/	свойства после любой последовательности операций
crash	test/crash/	массовый выход, манипуляции, reentrancy
integration	test/integration/	сквозные сценарии
gas	test/gas/	лимиты газа
Запуск
bash
forge test --match-contract <ContractName> -vvv
forge test --match-test <testName> -vvv
make test-fuzz
make test-invariant
Обязательные проверки
Перед отправкой PR — пройти чеклист. За основу взят docs/registry/contributing.md (R.3.01.04).

При добавлении governance-параметра
□ bytes32 PARAM_* — в Constants.sol
□ Сеттер в контракте с onlyRole(GOVERNANCE_ROLE) и bounds-проверкой
□ register() в Factory.registerParams() (C.8.01.01)
□ Событие *Updated в Events.sol (C.10.01.01)
□ Геттер (если публичный)
□ Тест в T.5.01.17 RegisterParams
□ Unit-тесты: bounds, emit, unauthorized
□ docs/tech/audit-checklist.md (R.2.01.11)
□ docs/tech/integration-guide.md (R.2.01.06) — если параметр влияет на UI
□ docs/registry/glossary.md (R.3.01.02)
При добавлении immutable-поля
□ Валидация в конструкторе (!= address(0), code.length > 0 — где применимо)
□ Геттер в публичном API контракта
□ Геттер в интерфейсе (I*), если поле читается извне
□ Передача в Factory.deploy() (если контракт создаётся через Factory)
□ Тест test_constructor_sets_<field>
□ docs/tech/contracts.md (R.2.01.03)
□ ABI-файлы web/dapp/abi/*.json (W.1.01.03–W.1.01.10)
При добавлении события
□ Объявление в Events.sol с комментарием семантики
□ Эмиссия в контракте
□ docs/tech/events.md (R.2.01.04) — описание полей
□ ops/indexer/subgraph.yaml (O.2.01.02) — eventHandler
□ ops/indexer/subgraph.ts (O.2.01.01) — handle
□ ops/indexer/schema.graphql (O.2.01.03) — сущность (если нужно)
□ Тест test_event_<name>
□ ops/monitoring/dashboard.json (O.1.01.01) — панель (если нужно)
При изменении интерфейса (I*)
□ Реализация обновлена (override)
□ Моки (test/utils/*Mock*) обновлены
□ ABI-файлы регенерированы (forge inspect <Contract> abi)
□ docs/tech/api.md / docs/tech/api-reference.md
□ Frontend (web/dapp/app.js)
Процесс review
Reviewer
Читает всю диффу, не только +-строки.

Проверяет соответствие спецификации (C.*, T.*).

Проверяет тесты: покрытие новой ветки, граничные случаи, fuzz/invariant.

Проверяет инварианты: не нарушает ли изменение reserve ≥ curveBacking, totalSupply == S_curve, poolPrice в коридоре.

Проверяет безопасность: reentrancy, access control, integer overflow, pull-модель, approve-логика.

Проверяет документацию: NatSpec, docs/* синхронизированы.

Оставляет конструктивные комментарии; блокирует только при реальной проблеме.

Author
Отвечает на все комментарии (resolve — только после ответа).

Force-push запрещён после первого review — только новые коммиты (для истории review).

Squash — только при merge.

CI
forge build

forge test (все)

forge coverage ≥ 95%

slither (без high-severity)

solhint (без errors)

prettier --check

Красный CI = PR не мержится. Исключение — infrastructure flake (перезапуск).

Сообщения о багах
Обычные баги — GitHub Issues. Шаблон: .github/ISSUE_TEMPLATE.md (I.1.01.04).

Уязвимости безопасности — НЕ через GitHub Issues. См. SECURITY.md.

Безопасность
Перед PR, изменяющим контракты:

Прочитать docs/tech/security-model.md (R.2.01.08) и docs/tech/threat-model.md (R.2.01.09).

Проверить новый код на предмет:

reentrancy (все trade-функции — nonReentrant)

access control (onlyRole / onlyOwner / onlySafe)

overflow / underflow (Solidity 0.8.24 — checked по умолчанию, но unchecked — с обоснованием)

pull vs push (USDC должно тянуться, а не пушиться)

approve-логика (forceApprove + сброс в 0)

msg.sender vs tx.origin (второе — запрещено)

delegatecall / call — только с обоснованием и тестом

Лицензия контрибуций
Отправляя PR, вы соглашаетесь, что ваш вклад лицензируется под AGPL-3.0-only (см. LICENSE),
и подтверждаете, что имеете право на эту лицензию (нет конфликта с вашим работодателем / третьими
лицами).

Если вы представляете компанию — приложите подтверждение в PR (Corporate CLA).

Вопросы
Открытый Issue с меткой question

docs/registry/faq.md (R.3.01.06) — если вопрос протокольный

text

---

## `CODE_OF_CONDUCT.md` (I.2.01.03)

```markdown
# Contributor Covenant Code of Conduct

## Наше обязательство

Мы, как участники, контрибьюторы и лидеры, обязуемся сделать участие в сообществе XartIA
свободным от притеснений для всех — независимо от возраста, телосложения, видимых или невидимых
ограничений, этнической принадлежности, половых признаков, гендерной идентичности и самовыражения,
уровня опыта, образования, социально-экономического статуса, национальности, внешности, расы,
религии, сексуальной идентичности и ориентации.

Мы обязуемся действовать и взаимодействовать так, чтобы способствовать открытому, гостеприимному,
разнообразному, инклюзивному и здоровому сообществу.

---

## Наши стандарты

Примеры поведения, которое способствует созданию позитивной среды:

- Проявление эмпатии и доброты к другим людям
- Уважение к разным мнениям, точкам зрения и опыту
- Конструктивная обратная связь и её достойное принятие
- Признание своих ошибок, извинения перед теми, кого задели, и извлечение уроков из опыта
- Сосредоточение на том, что лучше не только для нас лично, но и для сообщества в целом

Примеры недопустимого поведения:

- Сексуализированные высказывания или образы, сексуальное внимание или домогательства любого рода
- Троллинг, оскорбительные или уничижительные комментарии, личные или политические атаки
- Публичное или приватное притеснение
- Публикация личной информации других лиц (доксинг) без их явного разрешения
- Иное поведение, которое можно обоснованно считать неуместным в профессиональной среде

---

## Обязанности по соблюдению

Лидеры сообщества несут ответственность за разъяснение и соблюдение наших стандартов приемлемого
поведения и предпримут соответствующие и справедливые корректирующие действия в ответ на любое
поведение, которое они сочтут неуместным, угрожающим, оскорбительным или вредным.

Лидеры сообщества имеют право и обязанность удалять, редактировать или отклонять комментарии,
коммиты, код, правки wiki, issues и другие вклады, которые не соответствуют настоящему Кодексу
поведения, и будут сообщать причины решений о модерации, когда это уместно.

---

## Область применения

Настоящий Кодекс поведения применяется во всех пространствах сообщества, а также применяется,
когда лицо официально представляет сообщество в публичных пространствах. Примеры представления
нашего сообщества включают использование официального адреса электронной почты, публикации через
официальный аккаунт в социальных сетях или действия в качестве назначенного представителя на
онлайн- или офлайн-мероприятии.

---

## Обеспечение соблюдения

О случаях оскорбительного, притесняющего или иным образом неприемлемого поведения можно сообщать
лидерам сообщества, ответственным за соблюдение Кодекса, по адресу:

**conduct@xartia.example**

Все жалобы будут рассмотрены и расследованы оперативно и справедливо.

Все лидеры сообщества обязаны уважать частную жизнь и безопасность сообщающего о любом инциденте.

---

## Руководство по обеспечению соблюдения

Лидеры сообщества будут следовать этим Рекомендациям по влиянию на сообщество при определении
последствий за любое действие, которое они сочтут нарушающим настоящий Кодекс поведения:

### 1. Исправление

**Влияние на сообщество:** Использование неуместных выражений или иное поведение, считающееся
непрофессиональным или нежелательным в сообществе.

**Последствие:** Частное письменное предупреждение от лидеров сообщества с разъяснением
характера нарушения и объяснением, почему такое поведение было неуместным. Могут быть запрошены
публичные извинения.

### 2. Предупреждение

**Влияние на сообщество:** Нарушение в результате одного инцидента или серии действий.

**Последствие:** Предупреждение с последствиями за продолжение поведения. Никакого
взаимодействия с вовлечёнными лицами, включая нежелательное взаимодействие с теми, кто
обеспечивает соблюдение Кодекса, в течение определённого периода. Это включает избегание
взаимодействия в пространствах сообщества, а также внешних каналов, таких как социальные сети.
Нарушение этих условий может привести к временному или постоянному запрету.

### 3. Временный запрет

**Влияние на сообщество:** Серьёзное нарушение стандартов сообщества, включая устойчивое
неуместное поведение.

**Последствие:** Временный запрет на любое взаимодействие или публичное общение с сообществом в
течение определённого периода. В течение этого периода не разрешается никакое публичное или
частное взаимодействие с вовлечёнными лицами, включая нежелательное взаимодействие с теми, кто
обеспечивает соблюдение Кодекса. Нарушение этих условий может привести к постоянному запрету.

### 4. Постоянный запрет

**Влияние на сообщество:** Демонстрация систематического нарушения стандартов сообщества, включая
устойчивое неуместное поведение, притеснение индивида или агрессию по отношению к группам
индивидов или их пренебрежение.

**Последствие:** Постоянный запрет на любое публичное взаимодействие в рамках сообщества.

---

## Атрибуция

Настоящий Кодекс поведения адаптирован из [Contributor Covenant][homepage], версия 2.1,
доступной по адресу
[https://www.contributor-covenant.org/version/2/1/code_of_conduct.html][v2.1].

Руководство по влиянию на сообщество было вдохновлено
[лестницей последствий Mozilla](https://github.com/mozilla/diversity).

[homepage]: https://www.contributor-covenant.org
[v2.1]: https://www.contributor-covenant.org/version/2/1/code_of_conduct.html

---

## Дополнительные правила проекта

В дополнение к стандартам Contributor Covenant, участники XartIA обязуются:

1. **Не публиковать код, нарушающий AGPL-3.0.** Производные работы и сетевые сервисы на коде
   XartIA должны оставаться открытыми (см. `LICENSE`).

2. **Не предлагать вознаграждение за голоса в governance.** Snapshot-голосование квадратичное,
   любые попытки манипуляции — нарушение Кодекса.

3. **Не публиковать чужие private keys, seed phrases или персональные данные.** Доксинг
   недопустим, даже частичный.

4. **Не выдавать себя за команду XartIA.** Только официальные каналы, перечисленные в
   `README.md`, имеют полномочия говорить от имени проекта.

5. **Не использовать сообщество для продвижения сторонних финансовых продуктов** (токенов,
   ICO, инвестиционных схем) без явного разрешения модераторов.

Нарушения — `conduct@xartia.example`.