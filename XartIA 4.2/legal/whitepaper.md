# XartIA Whitepaper

**Version:** 1.0 (draft, pre-audit)
**Date:** 2026-10-26
**Status:** Draft. Не является публичной офертой, инвестиционной рекомендацией или
проспектом ценных бумаг. Требует юридического заключения (`legal/opinion/jurisdiction.pdf`)
и внешнего аудита (`legal/audit-report.pdf`) до деплоя на mainnet.

---

## 0. Предисловие

XartIA — это экспериментальный bonding curve протокол с USDC-обеспеченным резервом,
внутренним пулом ликвидности и ограниченным коридором цены пула. Протокол выпускает
токен XRT и предоставляет два канала покупки/продажи (bonding curve и пул), а также
механизм покрытия эмиссии (ReserveManager) и автоматический предохранитель (CircuitBreaker).

Протокол **не является** ценной бумагой, инвестиционным инструментом, паевым фондом,
деривативом, электронными деньгами в смысле директив ЕС, или банковским продуктом.
XRT **не даёт** права на дивиденды, долю в прибыли, долю в компании, активы или
голосование в корпоративных структурах. XRT **не обещает** рост цены, доходность
или прибыль.

Протокол **находится в стадии pre-audit**. Внешний аудит не проведён. Не
используйте с реальными средствами до публикации `legal/audit-report.pdf`.

---

## 1. Introduction

### 1.1. Проблема

Большинство токенов в DeFi — либо спекулятивные инструменты с кривой, которая
растёт только за счёт новых покупателей (классическая bonding curve), либо
стейблкоины с централизованным кастодианом. Первые не имеют якоря и зависят
от притока спекулятивного капитала. Вторые — централизованы и не имеют прозрачной
эмиссии.

XartIA предлагает третий подход: **bonding curve с прозрачным резервом**.
Цена эмиссии определяется кривой, но резерв растёт только от реального притока
USDC, а не от ожиданий. Продажа возможна двумя путями (кривая и пул), что
обеспечивает ликвидность без внешних маркет-мейкеров.

### 1.2. Что такое XartIA

XartIA — это:

- **Bonding curve** P(S) с таблицей уровней, иммутабельной после деплоя.
- **Резерв (ReserveManager)** USDC, покрывающий эмиссию: инвариант `reserve ≥ R(S_curve)`,
  где `R(S) = ∫₀ˢ P(u) du`.
- **Внутренний пул (PoolController)** — альтернативный канал ликвидности с
  симметричным коридором цены `[P(S)/(1+10%), P(S)·(1+10%)]`.
- **CircuitBreaker** — предохранитель, блокирующий продажи в пул при истощении
  свободного резерва.
- **Governance** — Safe Multisig 3/5 → Governance → Timelock 7 дней → целевой
  контракт.

### 1.3. Utility токена XRT

XRT — **внутренняя учётная единица протокола**. Его функции:

1. **Средство обмена внутри протокола:** покупка/продажа через bonding curve и
   пул, оплата комиссий.
2. **Доступ к bonding curve:** только держатели XRT могут продавать через
   `redeemFromCurve` и `sellToPool`.
3. **Участие в governance:** голосование в Snapshot (off-chain) с квадратичным
   взвешиванием по стейку XRT.

XRT **не даёт**:

- права на дивиденды или долю в прибыли;
- права голоса в компании;
- права на активы протокола;
- права на выкуп по фиксированной цене;
- обещаний роста или доходности.

### 1.4. Что XartIA не является

XartIA — **не** ценная бумага, **не** инвестиционный инструмент, **не**
коллективная инвестиционная схема. XRT **не подпадает** под:

- Определение security по Howey Test (США) — см. `legal/token-classification.md`;
- MiCA как asset-referenced или e-money token — XRT не привязан к активу и не
  является электронными деньгами;
- MiFID II как financial instrument — требует юридического заключения
  (`legal/opinion/jurisdiction.pdf`).

Финальная квалификация — за юрисдикцией оператора. См. `legal/token-classification.md`
и `legal/opinion/jurisdiction.pdf`.

---

## 2. Architecture

### 2.1. Bonding curve

Цена XRT в USDC определяется кусочно-линейной функцией P(S) на таблице уровней:

P_i(S) = P_start_i + (P_end_i − P_start_i) · (S − S_start_i) / (S_end_i − S_start_i)

text

для `S ∈ [S_start_i, S_end_i)`, где `i = 0..n-1`, `n ≤ MAX_LEVELS = 10`.

Кривая:

- **монотонно неубывающая** — P(S₁) ≤ P(S₂) при S₁ < S₂;
- **непрерывна** на границах уровней — P_end_i = P_start_{i+1};
- **иммутабельна** — таблица уровней фиксируется при деплое.

Формальное описание — `e/01_core/price_function.md` (E.1.01.01) и
`e/01_core/levels_table.md` (E.1.01.03).

### 2.2. Интеграл R(S)

`R(S) = ∫₀ˢ P(u) du` — минимальный резерв USDC, необходимый для покрытия всех
S токенов при выкупе по кривой. `R(S)` монотонно неубывающая, непрерывна,
`R(0) = 0`.

Формальное описание — `e/01_core/integral_function.md` (E.1.01.02).

### 2.3. Внутренний пул

PoolController предоставляет альтернативный канал ликвидности XRT/USDC.
Цена пула `poolPrice` ограничена симметричным коридором:
P(S) / 1.1 ≤ poolPrice ≤ P(S) · 1.1

text

`poolPrice` обновляется:

- при продаже в пул (`sellToPool`) — растёт пропорционально `ΔP / S_curve`;
- при покупке на кривой (`buyFromCurve`, `buyFromCurveFor`) — подтягивается к
  новой нижней границе;
- при продаже на кривой (`redeemFromCurve`) — обрезается по обеим границам
  (defensive).

Следствие: арбитраж между кривой и пулом ограничен ~10% минус комиссии, что
защищает от манипуляций `poolPrice`.

Формальное описание — `e/01_core/pool_price_formula.md` (E.1.01.05) и
`e/01_core/pool_price_proof.md` (E.1.01.07).

### 2.4. Резерв (ReserveManager)

ReserveManager — кастодиан USDC. Хранит:

- `reserve = toWei(balanceOf(USDC, ReserveManager))` — фактический баланс;
- `curveBacking = R(S_curve)` — минимально необходимый резерв;
- `freeReserve = reserve − curveBacking` — буфер для `sellToPool`.

**Инвариант:** `reserve ≥ curveBacking` после любой операции. Проверяется в
`updateScurve` с `revert(ReserveInvariantViolation)`.

Доказательство — `e/01_core/invariant_proof.md` (E.1.01.06).

### 2.5. CircuitBreaker

Предохранитель. Срабатывает, когда `freeReserve / reserve < threshold`, где
`threshold ∈ [5%, 20%]` (default 10%). При срабатывании:

- `sellToPool` блокируется (`CircuitBreakerActive`);
- `buyFromCurve`, `buyFromCurveFor`, `redeemFromCurve` работают (пользователи
  могут выйти через кривую).

При `reserve == 0` CircuitBreaker возвращает `false` (нет резерва — нет
срабатывания; пол защищён через `NotInitialized`).

### 2.6. Роли и governance

- **Safe Multisig 3/5** — владелец протокола после `finalize()`;
- **Governance** — единственный вход для Safe Multisig в Timelock (`onlySafe`);
- **Timelock** — задержка 7 дней на все изменения;
- **ParameterRegistry** — реестр параметров с bounds; `Governance.propose`
  проверяет bounds перед `queue`;
- **PAUSER_ROLE** — выдаётся Safe Multisig; `pause()` без Timelock;
- **GOVERNANCE_ROLE** — выдаётся Timelock; `unpause()` через Timelock 7 дней.

Immutable-параметры (не меняются governance):

- `MAX_GAP = 10%` — ширина коридора `poolPrice`;
- `TEAM_PERCENT = 0.5%` — доля `teamTokens` от `ΔS`;
- `TIMELOCK_DELAY = 7 days`;
- `MAX_LEVELS = 10`;
- `MAX_CURVE_FOR_PCT = 20%` — лимит `buyFromCurveFor`.

---

## 3. Token economics

### 3.1. XRT

| Параметр | Значение |
|---|---|
| Стандарт | ERC-20 |
| Name | XartIA |
| Symbol | XRT |
| Decimals | 18 |
| Эмиссия | bonding curve (`buyFromCurve`, `buyFromCurveFor`) |
| Сжигание | `redeemFromCurve` (через `burnFrom` + allowance) |
| Total supply | динамический, `totalSupply == S_curve` |

**Инвариант:** `totalSupply(XRT) == S_curve` (хранится в ReserveManager).
Vesting и PoolController держат часть токенов, но их баланс — часть totalSupply.
Проверяется в `T.3.01.02 InvariantSupply`.

### 3.2. teamTokens (токенный канал дохода команды)

- **Размер:** `TEAM_PERCENT = 0.5%` от `ΔS` на каждой покупке (`buyFromCurve`,
  `buyFromCurveFor`).
- **Получатель:** `Vesting` (immutable `beneficiary = Safe Multisig`).
- **Расписание:** cliff 365 дней, duration 730 дней (module-level constants,
  не governance-параметр).
- **Не является fee:** пользователь платит за `ΔS`, получает `ΔS − teamTokens`.
  Это **эмиссия**, а не комиссия.

**Важно:** `teamTokens` **не создаёт** ожиданий прибыли для держателей XRT.
Это отложенное вознаграждение команды за развитие протокола. Cliff 365 дней и
duration 730 дней снижают риск «обещания дохода».

### 3.3. sellTeamFee (USDC-канал дохода команды)

- **Размер:** `sellTeamFee ∈ [0, 50]` bp, default `10 bp = 0.1%`.
- **Governance-параметр:** `PARAM_SELL_TEAM_FEE`, изменяется через Safe Multisig
  → Governance → Timelock (7 дней).
- **Источник:** USDC с продаж (`redeemFromCurve`, `sellToPool`), с gross-суммы.
- **Получатель:** `treasury` — immutable адрес, задаётся при деплое
  (`Factory.deploy(treasury)`). Обычно совпадает с Safe Multisig, но может быть
  отдельный адрес.
- **Назначение:** финансирование операционных расходов протокола (разработка,
  аудит, инфраструктура).

**sellTeamFee НЕ:**

- распределяется между держателями XRT;
- является дивидендом;
- создаёт ожидания прибыли;
- влияет на `reserve ≥ curveBacking` (доказательство в E.1.01.06 §5–6).

**Почему sellTeamFee существует:** доход команды структурно привязан к росту
(`teamTokens` минтится только на покупках). В медвежий рынок покупок мало —
`sellTeamFee` сглаживает просадку. 0.1% достаточно для операционного дохода,
но не отпугивает объём.

**Раскрытие (важно для юридической квалификации):** наличие revenue-канала
усиливает Howey-риск (см. `legal/token-classification.md` §4). Ключевой
аргумент защиты: держатели XRT **не получают** долю в revenue.

### 3.4. buyFee и redeemFee

- **buyFee:** `50 bp = 0.5%` с покупок (`buyFromCurve`, `buyFromPool`).
- **redeemFee:** `50 bp = 0.5%` с продаж (`redeemFromCurve`, `sellToPool`).
- **Куда идёт:** **остаётся в ReserveManager**, увеличивая `freeReserve`.
  Не идёт в treasury.

**Это by design:** комиссии увеличивают буфер `freeReserve`, что укрепляет
инвариант `reserve ≥ curveBacking`. Если бы комиссии шли в treasury, пол
субсидировался бы оборотом — скрытый риск.

### 3.5. earlySellFee

- **Размер:** `∈ [0, 500]` bp, default `0`.
- **Governance-параметр:** `PARAM_EARLY_SELL_FEE`, `PARAM_EARLY_SELL_PERIOD`.
- **Применяется:** **только** в `redeemFromCurve`, если `block.timestamp <
  lastBuyTime[user] + earlySellPeriod`.
- **Не применяется:** в `sellToPool` (by design; `poolPrice` ограничен
  коридором, что уже ограничивает прибыль).
- **Куда идёт:** остаётся в ReserveManager (как `redeemFee`).

**Назначение:** антифлип-механизм для `redeemFromCurve`. Default 0% — не
применяется. Governance может включить при необходимости (например, при
спекулятивных атаках).

### 3.6. Round-trip cost

**Базовый** (buy + immediate redeem, earlySellFee = 0):
buyFee + redeemFee + sellTeamFee = 0.5% + 0.5% + 0.1% = 1.1%

text

**С активным earlySellFee** (например, 5% в первые 30 дней):
1.1% + 5% = 6.1%

text

Round-trip cost отображается в dApp UI (`getRoundTripCost()` в `web/dapp/app.js`).

---

## 4. User journey

### 4.1. Покупка

**Вариант A: `buyFromCurve`** — покупка по bonding curve.

1. Пользователь вызывает `buyFromCurve(X_6, minTokensOut, deadline)`.
2. `X_6` — сумма USDC в 6 decimals.
3. Удерживается `buyFee = 0.5%`, `X_net = X_6 − fee`.
4. `ΔS = deltaSForBuy(S_curve, X_net)` — количество XRT.
5. `teamTokens = 0.5% от ΔS` минтится в Vesting.
6. Пользователь получает `ΔS − teamTokens` XRT.
7. `S_curve += ΔS`, `reserve += X_6`.

**Вариант B: `buyFromPool`** — покупка из внутреннего пула.

1. Пользователь вызывает `buyFromPool(X_6, minTokensOut, deadline)`.
2. Часть покрывается из пула (по `poolPrice`), остаток — через каскад
   `buyFromCurveFor` на кривой.
3. Комиссии и teamTokens — как в `buyFromCurve`.

### 4.2. Продажа

**Вариант A: `redeemFromCurve`** — продажа по bonding curve.

1. Пользователь вызывает `redeemFromCurve(ΔS, minUsdcOut, deadline)`.
2. Удерживается `redeemFee = 0.5%` + `sellTeamFee = 0.1%` + `earlySellFee`
   (если применимо).
3. Пользователь получает `amount − fees`.
4. `sellTeamFee` уходит в treasury, остальное остаётся в резерве.
5. `S_curve -= ΔS`, `reserve -= user_amount + sell_team_fee`.

**Вариант B: `sellToPool`** — продажа в пул.

1. Пользователь вызывает `sellToPool(ΔP, minUsdcOut, deadline)`.
2. Удерживается `redeemFee` + `sellTeamFee`.
3. `earlySellFee` **не** применяется.
4. `S_curve` **не** меняется (токены идут в пул, не сжигаются).
5. `poolPrice` растёт по формуле `mult_bp`.

### 4.3. Ограничения

- **`minimalPurchase = 1 USDC`** — минимальная эффективная сумма после buyFee.
  Реальный минимум для пользователя — `effectiveMinimalX6()` = `1.005026 USDC`.
- **`maxPurchasePct = 5%`** — лимит одной покупки на кривой как доля от
  `S_curve`. При `S_curve = 0` (genesis) не применяется.
- **`maxBalance_i`** — максимум одного пользователя на уровне.
- **`maxSellPctPerDay = 2%`** — суточный лимит продаж в пул на адрес.
- **`deadline`** — если задан, транзакция ревертит, если `block.timestamp >
  deadline`.
- **`minTokensOut` / `minUsdcOut`** — slippage protection. `0` — отключена.

---

## 5. Governance

### 5.1. Pipeline
Safe Multisig 3/5
↓ onlySafe
Governance.propose(param, value)
↓ onlyRole(GOVERNANCE_ROLE)
Timelock.queue(param, value, target, setter)
↓ 7 days
Timelock.execute(param)
↓ call(setter, value)
Target contract (setBuyFee, setRedeemFee, ...)

text

### 5.2. Управляемые параметры

| Параметр | Контракт | Bounds | Default |
|---|---|---:|---:|
| `PARAM_BUY_FEE` | `CurveController` | 0–200 bp | 50 bp |
| `PARAM_REDEEM_FEE` | `CurveController` | 0–200 bp | 50 bp |
| `PARAM_EARLY_SELL_FEE` | `CurveController` | 0–500 bp | 0 bp |
| `PARAM_EARLY_SELL_PERIOD` | `CurveController` | 0–7 776 000 сек | 0 сек |
| `PARAM_MAX_PURCHASE_PCT` | `CurveController` | 0–1000 bp | 500 bp |
| `PARAM_MINIMAL_PURCHASE` | `CurveController` | 1e6–1e12 | 1e6 |
| `PARAM_MAX_SELL_PCT_PER_DAY` | `PoolController` | 0–500 bp | 200 bp |
| `PARAM_CIRCUIT_BREAKER_THRESHOLD` | `CircuitBreaker` | 500–2000 bp | 1000 bp |
| `PARAM_SELL_TEAM_FEE` | `CurveController` | 0–50 bp | 10 bp |

### 5.3. Snapshot (off-chain)

Параметры предварительно обсуждаются в Snapshot (`G.1.01.01–03`):

- Space: `xartia.eth`
- Стратегия: `sqrt(stakedXartIA)` — квадратичное взвешивание
- Quorum: 50 000 XRT (квадратичный вес)
- Период: 7 дней

Snapshot — **сигнал**, не обязательство. Юридически обязывающая часть —
on-chain `Governance.propose` → `Timelock.queue` → `Timelock.execute`.

### 5.4. Что governance НЕ может

- Изменить таблицу `Levels` (иммутабельна).
- Изменить `MAX_GAP`, `TEAM_PERCENT`, `TIMELOCK_DELAY`, `MAX_LEVELS`,
  `MAX_CURVE_FOR_PCT` (иммутабельные константы).
- Забрать USDC из ReserveManager (только `pay` через `CONTROLLER_ROLE`,
  используется только в `redeemFromCurve` и `sellToPool`).
- Изменить treasury (immutable после деплоя).
- Изменить `safe` (immutable в Governance).
- Снять `pause()` без `GOVERNANCE_ROLE` (что требует Timelock 7 дней).

---

## 6. Security

### 6.1. Immutable contracts

Все контракты — **immutable** (без `upgradeable`, без прокси). Баг не
исправляется; возможен только `pause` + миграция на новую систему через новый
`XartIAFactory`.

**Причина:** upgradeability создаёт риск governance-takeover и усложняет аудит.
Для протокола, управляющего средствами пользователей, immutable — более
безопасный выбор.

### 6.2. Аудит

Внешний аудит — **не проведён**. `legal/audit-report.pdf` — placeholder.
Деплой на mainnet **запрещён** до публикации отчёта.

CI-аудит (`.github/workflows/audit.yml`, I.1.01.03):

- Slither — weekly, fail on high severity
- Mythril — weekly, fail on high severity

### 6.3. Bug bounty

Программа bug bounty — **не активна** до mainnet. После аудита и деплоя на
Polygon PoS — будет опубликована в `SECURITY.md`. Предварительная структура:

| Severity | Описание | Bounty |
|---|---|---:|
| Critical | Кража средств, потеря > 50% резерва | до 50 000 USDC |
| High | Нарушение инварианта, блокировка > 1000 USDC | до 15 000 USDC |
| Medium | DoS, ограниченная утечка, precision loss | до 5 000 USDC |
| Low | Best practice, gas, документация | до 500 USDC |

### 6.4. Инварианты

Формальные доказательства — `e/01_core/invariant_proof.md` (E.1.01.06),
`e/01_core/pool_price_proof.md` (E.1.01.07).

| Инвариант | Проверка | Тест |
|---|---|---|
| `reserve ≥ R(S_curve)` | `ReserveManager.updateScurve` | T.3.01.01 |
| `totalSupply == S_curve` | CurveController mint/burn | T.3.01.02 |
| `poolPrice ∈ [P(S)/1.1, P(S)·1.1]` | `_enforcePoolPriceFloor`, `_clampPoolPriceToCorridor` | T.3.01.03 |
| `freeReserve + curveBacking == reserve` | `ReserveManager.freeReserve()` | T.3.01.04 |
| `poolPrice` монотонен при `sellToPool` | `PoolController.sellToPool` | T.3.01.05 |
| `P(S)` непрерывна на границах | `Levels.init` | T.3.01.06 |
| `reserve() == toWei(balanceOf)` | `ReserveManager.reserve()` | T.3.01.07 |
| `balanceOf(poolController) == pool` | `PoolController` | T.3.01.08 |
| `treasury_balance` монотонно неубывающий | `sellTeamFee` | T.3.01.09 |

### 6.5. Митигации

- **Pull-модель** в `buyFromCurveFor`: контракт сам тянет USDC через
  `safeTransferFrom`. Минтинг без реального USDC невозможен.
- **Sweep-dust** в `PoolController.buyFromPool`: `balanceOf(poolController) == 0`
  между транзакциями.
- **Treasury** не имеет ролей ни в одном контракте (тест `T.1.01.18`).
- **`finalize()`** отзывает `DEFAULT_ADMIN_ROLE` и `GOVERNANCE_ROLE` у Factory
  во всех 9 AccessControl-контрактах.
- **`setPoolController`** — one-time (AlreadyInitialized при повторе).
- **`Timelock.queue/execute`** проверяют `target.code.length > 0` (блокирует EOA).
- **`ParameterRegistry.register`** проверяет `target != 0`, `setter != 0`,
  `min ≤ max`, `!exists`.
- **`X_18` нормализация** в `buyFromCurveFor` — устраняет пыль и revert
  `ReserveInvariantViolation`.

---

## 7. Legal disclaimers

### 7.1. XRT — не ценная бумага

XRT **не является** security в смысле Howey Test (США). Детальная
квалификация — `legal/token-classification.md`. Требуется юридическое
заключение — `legal/opinion/jurisdiction.pdf`.

### 7.2. XRT — не MiCA-актив

XRT **не является** asset-referenced token или e-money token по MiCA (ЕС).
XRT не привязан к активу. Однако наличие protocol revenue (`sellTeamFee`)
может усилить риск квалификации как financial instrument (MiFID II). Требуется
юридическое заключение.

### 7.3. Protocol revenue не распределяется

`sellTeamFee` — **операционный доход протокола**. Не распределяется между
держателями XRT. Не является дивидендом. Не создаёт ожиданий прибыли.

`treasury` — операционный фонд (разработка, аудит, инфраструктура), не
распределяется.

### 7.4. Нет обещаний прибыли

Whitepaper не содержит обещаний прибыли, доходности, роста цены или
гарантий. Пользователь несёт риск потери средств.

### 7.5. Юрисдикционные ограничения

См. `legal/opinion/jurisdiction.pdf`. Возможен геофенсинг США и ЕС, если
юридическое заключение признаёт security-риск.

### 7.6. Terms of Use

См. `legal/terms.md` (L.2.01.01). Отказ от ответственности —
`legal/disclaimer.md` (L.2.01.03). Privacy Policy — `legal/privacy.md`
(L.2.01.02). Cookie Policy — `legal/cookies.md` (L.2.01.04).

### 7.7. Риск потери средств

Пользователь несёт риск потери всех средств, вложенных в XRT. Протокол не
гарантирует возврат. Инвариант `reserve ≥ R(S_curve)` — технический, не
юридический. При нарушении инварианта протокол останавливается (`pause` +
аудит), но возврат средств не гарантирован.

### 7.8. Pre-audit статус

Протокол **не прошёл** внешний аудит. Не используйте с реальными средствами
до публикации `legal/audit-report.pdf`.

---

## 8. Roadmap

Краткая версия — `docs/registry/roadmap.md` (R.3.01.07). Основные вехи:

- [x] Спецификация (R.1.01.01)
- [x] Контракты (C.*)
- [x] Тесты (T.*)
- [ ] Внешний аудит
- [ ] Юридическое заключение
- [ ] Деплой на Amoy testnet
- [ ] Bug bounty
- [ ] Деплой на Polygon PoS

---

## Appendix A. Ссылки

- `README.md` — общее описание
- `docs/spec/xartia_4.2.md` (R.1.01.01) — техническая спецификация
- `e/01_core/*` — экономические спеки
- `legal/token-classification.md` — юридическая квалификация
- `legal/terms.md` — Terms of Use
- `legal/disclaimer.md` — отказ от ответственности
- `docs/tech/security-model.md` — модель безопасности
- `docs/tech/threat-model.md` — модель угроз
- `docs/tech/audit-checklist.md` — чек-лист аудита
- `SECURITY.md` — security policy

---

**ОТКАЗ ОТ ОТВЕТСТВЕННОСТИ:** этот документ — draft. Не является публичной
офертой, инвестиционной рекомендацией или проспектом ценных бумаг. Требует
юридического заключения и внешнего аудита до деплоя на mainnet.
