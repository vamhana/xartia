# Whitepaper XartIA (русская версия)

**Версия:** 1.0 (draft, pre-audit)
**Дата:** 2026-10-26
**Статус:** Draft. Не является публичной офертой, инвестиционной рекомендацией
или проспектом ценных бумаг. Требует юридического заключения
(`legal/opinion/jurisdiction.pdf`) и внешнего аудита (`legal/audit-report.pdf`)
до деплоя на mainnet.

> **Примечание:** это адаптированный перевод `legal/whitepaper.md` (L.1.01.01)
> для русскоязычной аудитории. При расхождениях приоритет имеет английская
> версия. Юридические формулировки должны пройти review юриста перед
> публикацией.

---

## 0. Предисловие

XartIA — экспериментальный bonding curve протокол с USDC-обеспеченным резервом,
внутренним пулом ликвидности и ограниченным коридором цены пула. Протокол
выпускает токен XRT и предоставляет два канала покупки/продажи (bonding curve
и пул), механизм покрытия эмиссии (ReserveManager) и автоматический
предохранитель (CircuitBreaker).

Протокол **не является** ценной бумагой, инвестиционным инструментом, паевым
фондом, деривативом, электронными деньгами в смысле директив ЕС или банковским
продуктом. XRT **не даёт** права на дивиденды, долю в прибыли, долю в компании,
активы или голосование в корпоративных структурах. XRT **не обещает** рост
цены, доходность или прибыль.

Протокол **находится в стадии pre-audit**. Внешний аудит не проведён. Не
используйте с реальными средствами до публикации `legal/audit-report.pdf`.

---

## 1. Введение

### 1.1. Проблема

Большинство токенов в DeFi — либо спекулятивные инструменты с кривой, которая
растёт только за счёт новых покупателей, либо стейблкоины с централизованным
кастодианом. Первые не имеют якоря и зависят от притока спекулятивного
капитала. Вторые — централизованы и не имеют прозрачной эмиссии.

XartIA предлагает третий подход: **bonding curve с прозрачным резервом**.
Цена эмиссии определяется кривой, но резерв растёт только от реального притока
USDC, а не от ожиданий. Продажа возможна двумя путями (кривая и пул), что
обеспечивает ликвидность без внешних маркет-мейкеров.

### 1.2. Что такое XartIA

XartIA — это:

- **Bonding curve** P(S) с таблицей уровней, иммутабельной после деплоя.
- **Резерв (ReserveManager)** USDC, покрывающий эмиссию: инвариант
  `reserve ≥ R(S_curve)`, где `R(S) = ∫₀ˢ P(u) du`.
- **Внутренний пул (PoolController)** — альтернативный канал ликвидности с
  симметричным коридором цены `[P(S)/1.1, P(S)·1.1]`.
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
- MiCA как asset-referenced или e-money token — XRT не привязан к активу;
- MiFID II как financial instrument — требует юридического заключения.

Финальная квалификация — за юрисдикцией оператора. См.
`legal/token-classification.md` и `legal/opinion/jurisdiction.pdf`.

---

## 2. Архитектура

### 2.1. Bonding curve

Цена XRT в USDC определяется кусочно-линейной функцией P(S) на таблице уровней:
P_i(S) = P_start_i + (P_end_i − P_start_i) · (S − S_start_i) / (S_end_i − S_start_i)

text

для `S ∈ [S_start_i, S_end_i)`, где `i = 0..n-1`, `n ≤ MAX_LEVELS = 10`.

Кривая:

- **монотонно неубывающая** — P(S₁) ≤ P(S₂) при S₁ < S₂;
- **непрерывна** на границах уровней — P_end_i = P_start_{i+1};
- **иммутабельна** — таблица уровней фиксируется при деплое.

### 2.2. Интеграл R(S)

`R(S) = ∫₀ˢ P(u) du` — минимальный резерв USDC, необходимый для покрытия всех
S токенов при выкупе по кривой. `R(S)` монотонно неубывающая, непрерывна,
`R(0) = 0`.

### 2.3. Внутренний пул

PoolController предоставляет альтернативный канал ликвидности XRT/USDC.
Цена пула `poolPrice` ограничена симметричным коридором:
P(S) / 1.1 ≤ poolPrice ≤ P(S) · 1.1

text

Следствие: арбитраж между кривой и пулом ограничен ~10% минус комиссии, что
защищает от манипуляций `poolPrice`.

### 2.4. Резерв (ReserveManager)

ReserveManager — кастодиан USDC. Хранит:

- `reserve = toWei(balanceOf(USDC, ReserveManager))` — фактический баланс;
- `curveBacking = R(S_curve)` — минимально необходимый резерв;
- `freeReserve = reserve − curveBacking` — буфер для `sellToPool`.

**Инвариант:** `reserve ≥ curveBacking` после любой операции.

### 2.5. CircuitBreaker

Предохранитель. Срабатывает, когда `freeReserve / reserve < threshold`, где
`threshold ∈ [5%, 20%]` (default 10%). При срабатывании:

- `sellToPool` блокируется;
- `buyFromCurve`, `buyFromCurveFor`, `redeemFromCurve` работают (пользователи
  могут выйти через кривую).

### 2.6. Роли и governance

- **Safe Multisig 3/5** — владелец протокола после `finalize()`;
- **Governance** — единственный вход для Safe Multisig в Timelock;
- **Timelock** — задержка 7 дней на все изменения;
- **ParameterRegistry** — реестр параметров с bounds;
- **PAUSER_ROLE** — `pause()` без Timelock;
- **GOVERNANCE_ROLE** — `unpause()` через Timelock 7 дней.

Immutable-параметры: `MAX_GAP = 10%`, `TEAM_PERCENT = 0.5%`,
`TIMELOCK_DELAY = 7 days`, `MAX_LEVELS = 10`, `MAX_CURVE_FOR_PCT = 20%`.

---

## 3. Токеномика

### 3.1. XRT

| Параметр | Значение |
|---|---|
| Стандарт | ERC-20 |
| Name | XartIA |
| Symbol | XRT |
| Decimals | 18 |
| Эмиссия | bonding curve |
| Сжигание | `redeemFromCurve` |
| Total supply | динамический, `totalSupply == S_curve` |

### 3.2. teamTokens (токенный канал дохода команды)

- **Размер:** `TEAM_PERCENT = 0.5%` от `ΔS` на каждой покупке.
- **Получатель:** `Vesting` (immutable `beneficiary = Safe Multisig`).
- **Расписание:** cliff 365 дней, duration 730 дней.
- **Не является fee:** это **эмиссия**, а не комиссия.

`teamTokens` **не создаёт** ожиданий прибыли для держателей XRT. Это
отложенное вознаграждение команды за развитие протокола.

### 3.3. sellTeamFee (USDC-канал дохода команды)

- **Размер:** `sellTeamFee ∈ [0, 50]` bp, default `10 bp = 0.1%`.
- **Governance-параметр:** `PARAM_SELL_TEAM_FEE`, изменяется через Safe
  Multisig → Governance → Timelock (7 дней).
- **Источник:** USDC с продаж (`redeemFromCurve`, `sellToPool`), с gross-суммы.
- **Получатель:** `treasury` — immutable адрес, задаётся при деплое. Обычно
  совпадает с Safe Multisig.
- **Назначение:** финансирование операционных расходов протокола (разработка,
  аудит, инфраструктура).

**sellTeamFee НЕ:**

- распределяется между держателями XRT;
- является дивидендом;
- создаёт ожидания прибыли;
- влияет на `reserve ≥ curveBacking`.

**Раскрытие (важно для юридической квалификации):** наличие revenue-канала
усиливает Howey-риск. Ключевой аргумент защиты: держатели XRT **не получают**
долю в revenue.

### 3.4. buyFee и redeemFee

- **buyFee:** `0.5%` с покупок.
- **redeemFee:** `0.5%` с продаж.
- **Куда идёт:** **остаётся в ReserveManager**, увеличивая `freeReserve`.
  Не идёт в treasury.

### 3.5. earlySellFee

- **Размер:** `∈ [0, 5%]`, default `0%`.
- **Применяется:** **только** в `redeemFromCurve`, если в
  `earlySellPeriod` после последней покупки.
- **Не применяется:** в `sellToPool`.
- **Куда идёт:** остаётся в ReserveManager.

### 3.6. Round-trip cost

**Базовый:** `buyFee + redeemFee + sellTeamFee = 0.5% + 0.5% + 0.1% = 1.1%`.

**С активным earlySellFee** (например, 5%): до `6.1%`.

---

## 4. Пользовательские сценарии

### 4.1. Покупка

**`buyFromCurve`:**

1. Пользователь вызывает `buyFromCurve(X_6, minTokensOut, deadline)`.
2. Удерживается `buyFee = 0.5%`.
3. `ΔS = deltaSForBuy(S_curve, X_net)`.
4. `teamTokens = 0.5% от ΔS` минтится в Vesting.
5. Пользователь получает `ΔS − teamTokens` XRT.
6. `S_curve += ΔS`, `reserve += X_6`.

**`buyFromPool`:** аналогично, но часть покрывается из пула.

### 4.2. Продажа

**`redeemFromCurve`:** сжигает XRT, получает USDC по кривой.

**`sellToPool`:** продаёт XRT в пул, получает USDC по `poolPrice`.

### 4.3. Ограничения

- **`minimalPurchase = 1 USDC`** — минимальная эффективная сумма после buyFee.
- **`maxPurchasePct = 5%`** — лимит одной покупки на кривой.
- **`maxBalance_i`** — максимум одного пользователя на уровне.
- **`maxSellPctPerDay = 2%`** — суточный лимит продаж в пул.
- **`deadline`** — slippage protection.
- **`minTokensOut` / `minUsdcOut`** — slippage protection.

---

## 5. Governance

### 5.1. Pipeline
Safe Multisig 3/5 → Governance.propose → Timelock.queue → 7 days → Timelock.execute → Target

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

### 5.3. Snapshot

- Space: `xartia.eth`
- Стратегия: `sqrt(stakedXartIA)` — квадратичное взвешивание
- Quorum: 50 000 XRT
- Период: 7 дней

Snapshot — **сигнал**, не обязательство. Юридически обязывающая часть —
on-chain Governance + Timelock.

### 5.4. Что governance НЕ может

- Изменить таблицу `Levels` (иммутабельна).
- Изменить `MAX_GAP`, `TEAM_PERCENT`, `TIMELOCK_DELAY`, `MAX_LEVELS`,
  `MAX_CURVE_FOR_PCT`.
- Забрать USDC из ReserveManager.
- Изменить treasury (immutable).
- Изменить `safe` (immutable).
- Снять `pause()` без `GOVERNANCE_ROLE`.

---

## 6. Безопасность

### 6.1. Immutable контракты

Все контракты — **immutable**. Баг не исправляется; возможен только `pause` +
миграция на новую систему.

### 6.2. Аудит

Внешний аудит — **не проведён**. `legal/audit-report.pdf` — placeholder.
Деплой на mainnet **запрещён** до публикации отчёта.

### 6.3. Bug bounty

Программа — **не активна** до mainnet. После аудита и деплоя на Polygon PoS —
будет опубликована в `SECURITY.md`.

### 6.4. Инварианты

- `reserve ≥ R(S_curve)` (T.3.01.01)
- `totalSupply == S_curve` (T.3.01.02)
- `poolPrice ∈ [P(S)/1.1, P(S)·1.1]` (T.3.01.03)
- `freeReserve + curveBacking == reserve` (T.3.01.04)
- `poolPrice` монотонен при `sellToPool` (T.3.01.05)
- `P(S)` непрерывна на границах (T.3.01.06)
- `reserve() == toWei(balanceOf)` (T.3.01.07)
- `balanceOf(poolController) == pool` (T.3.01.08)
- `treasury_balance` монотонно неубывающий (T.3.01.09)

### 6.5. Митигации

- **Pull-модель** в `buyFromCurveFor`.
- **Sweep-dust** в `PoolController.buyFromPool`.
- **Treasury** не имеет ролей.
- **`finalize()`** отзывает роли у Factory.
- **`setPoolController`** — one-time.
- **`Timelock.queue/execute`** проверяют `target.code.length > 0`.

---

## 7. Юридические дисклеймеры

### 7.1. XRT — не ценная бумага

XRT **не является** security в смысле Howey Test (США). Детальная
квалификация — `legal/token-classification.md`. Требуется юридическое
заключение — `legal/opinion/jurisdiction.pdf`.

### 7.2. XRT — не MiCA-актив

XRT **не является** asset-referenced или e-money token по MiCA (ЕС). XRT не
привязан к активу. Наличие protocol revenue (`sellTeamFee`) может усилить риск
квалификации как financial instrument (MiFID II). Требуется юридическое
заключение.

### 7.3. Protocol revenue не распределяется

`sellTeamFee` — **операционный доход протокола**. Не распределяется между
держателями XRT. Не является дивидендом. Не создаёт ожиданий прибыли.

`treasury` — операционный фонд, не распределяется.

### 7.4. Нет обещаний прибыли

Whitepaper не содержит обещаний прибыли, доходности, роста цены или гарантий.
Пользователь несёт риск потери средств.

### 7.5. Юрисдикционные ограничения

См. `legal/opinion/jurisdiction.pdf`. Возможен геофенсинг США и ЕС.

### 7.6. Terms of Use

См. `legal/terms.md`, `legal/disclaimer.md`, `legal/privacy.md`,
`legal/cookies.md`.

### 7.7. Риск потери средств

Пользователь несёт риск потери всех средств, вложенных в XRT. Протокол не
гарантирует возврат. Инвариант `reserve ≥ R(S_curve)` — технический, не
юридический.

### 7.8. Pre-audit статус

Протокол **не прошёл** внешний аудит. Не используйте с реальными средствами
до публикации `legal/audit-report.pdf`.

---

## 8. Roadmap

- [x] Спецификация (R.1.01.01)
- [x] Контракты (C.*)
- [x] Тесты (T.*)
- [ ] Внешний аудит
- [ ] Юридическое заключение
- [ ] Деплой на Amoy testnet
- [ ] Bug bounty
- [ ] Деплой на Polygon PoS

---

## Приложение A. Ссылки

- `README.md` — общее описание
- `docs/spec/xartia_4.2.md` — техническая спецификация
- `e/01_core/*` — экономические спеки
- `legal/token-classification.md` — юридическая квалификация
- `legal/terms.md` — Terms of Use
- `legal/disclaimer.md` — отказ от ответственности
- `docs/tech/security-model.md` — модель безопасности
- `SECURITY.md` — security policy

---

**ОТКАЗ ОТ ОТВЕТСТВЕННОСТИ:** этот документ — draft. Не является публичной
офертой, инвестиционной рекомендацией или проспектом ценных бумаг. Требует
юридического заключения и внешнего аудита. Юридические формулировки должны
пройти review юриста перед публикацией. При расхождениях с
`legal/whitepaper.md` (EN) приоритет имеет английская версия.