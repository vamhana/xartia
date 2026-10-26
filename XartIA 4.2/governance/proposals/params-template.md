# [Param] <parameter> <current_value> → <new_value>

**Тип:** parameter change
**Блок:** G.2.01.01
**Автор:** @username / Safe Multisig 3/5
**Дата:** YYYY-MM-DD
**Параметр:** `PARAM_<NAME>` (см. `C.2.01.03 Constants`)
**Контракт:** `<CurveController | PoolController | CircuitBreaker>`
**Сеттер:** `<setBuyFee | setRedeemFee | setSellTeamFee | ...>`

---

## 1. Мотивация

<2–5 абзацев: почему текущее значение не устраивает, что изменилось в
протоколе или на рынке, как это подтверждается данными (Snapshots reserve,
`freeReserve`, `sellTeamFee` за 30 дней, объёмы торгов, отчёты аудитора).>

**Ссылки:**
- Данные мониторинга: `O.1.01.01 dashboard.json` → `sellTeamFee_30d_avg`
- Предыдущие предложения: `<link>`
- Аудит: `R.2.01.11 audit-checklist.md`, раздел `<...>`

---

## 2. Спецификация

| Поле | Значение |
|---|---|
| Параметр (bytes32) | `PARAM_BUY_FEE` |
| Текущее значение | `<current>` (например, `50` bp = 0.5%) |
| Предлагаемое значение | `<new>` (например, `25` bp = 0.25%) |
| Bounds (из `ParameterRegistry`) | `<min>`–`<max>` bp |
| Допустимый диапазон | `<min>`–`<max>` |
| Контракт | `<CurveController>` |
| Сеттер | `<setBuyFee(uint256)>` |
| Селектор | `0x<selector>` |

**Проверка bounds:**
- `min ≤ new_value ≤ max` ✓
- Если `new_value` вне bounds — `ParameterRegistry.isValid` вернёт `false`,
  `Governance.propose` ревертит `OutOfBounds`. **Не отправлять.**

### 2.1. Полный список управляемых параметров (справочник)

| Параметр | Контракт | Мин | Макс | Default |
|---|---|---:|---:|---:|
| `PARAM_BUY_FEE` | `CurveController` | 0 bp | 200 bp | 50 bp |
| `PARAM_REDEEM_FEE` | `CurveController` | 0 bp | 200 bp | 50 bp |
| `PARAM_EARLY_SELL_FEE` | `CurveController` | 0 bp | 500 bp | 0 bp |
| `PARAM_EARLY_SELL_PERIOD` | `CurveController` | 0 сек | 7 776 000 сек | 0 сек |
| `PARAM_MAX_PURCHASE_PCT` | `CurveController` | 0 bp | 1000 bp | 500 bp |
| `PARAM_MINIMAL_PURCHASE` | `CurveController` | 1e6 (1 USDC) | 1e12 (1M USDC) | 1e6 |
| `PARAM_MAX_SELL_PCT_PER_DAY` | `PoolController` | 0 bp | 500 bp | 200 bp |
| `PARAM_CIRCUIT_BREAKER_THRESHOLD` | `CircuitBreaker` | 500 bp | 2000 bp | 1000 bp |
| `PARAM_SELL_TEAM_FEE` | `CurveController` | 0 bp | 50 bp | 10 bp |

---

## 3. Влияние

### 3.1. На пользователей

- `buyFee` 0.5% → 0.25%: round-trip cost падает с 1.1% до 0.85%.
- `<impact specifics: кто получает выгоду / кто платит>`

### 3.2. На инварианты

- `reserve ≥ R(S_curve)`: не нарушается (изменение `buyFee` влияет на
  `fee_18`, который **увеличивает** `freeReserve`, инвариант только крепче).
- `poolPrice` в коридоре: не затронуто.
- `treasury_balance` монотонно неубывающий: не затронуто (для `sellTeamFee`).

### 3.3. На контракты

- `CurveController`: изменение storage-переменной `buyFee`, эмитится
  `BuyFeeUpdated(old, new)`.
- `PoolController`: читает `sellTeamFee` через `ICurveController.sellTeamFee()`
  (single source of truth), пересчёта не требуется.
- `CircuitBreaker`: если порог меняется — `ThresholdUpdated(old, new)`.

### 3.4. На пользователей (сценарии)

- **Buy + sellToPool:** cost = `buyFee + redeemFee + sellTeamFee` = `<new_round_trip>`.
- **Buy + redeemFromCurve:** cost = `<new_round_trip_curve>` + `earlySellFee` (если активен).
- **Кит:** лимит `maxPurchasePct` не меняется — `<old_pct>` bp.

---

## 4. Риски и митигации

| Риск | Митигация |
|---|---|
| Снижение `buyFee` до 0 уменьшает `freeReserve`, `CircuitBreaker` может сработать | мониторинг `O.1.01.02` alert `CircuitBreaker_triggered` |
| Снижение `sellTeamFee` до 0 лишает команду USDC-дохода в медвежий рынок | долгосрочная ставка — отдельный бюджетный proposal |
| Повышение `maxPurchasePct` до 1000 bp открывает путь для манипуляций `poolPrice` | коридор ±10% (`MAX_GAP`) ограничивает прибыль арбитража до ~8.9% |
| `earlySellFee` > 500 bp → `OutOfBounds` | bounds проверяются в `ParameterRegistry`, `Governance.propose` ревертит |

---

## 5. Голосование

**Snapshot:**
- Space: `xartia.eth`
- Стратегия: `sqrt(balance)` — квадратичное взвешивание (G.1.01.02)
- Quorum: 50 000 XRT (квадратичный вес)
- Период: 7 дней
- Порог одобрения: 60% «за» от «за + против»

**Ссылка на голосование:** `<https://snapshot.org/#/xartia.eth/proposal/0x...>`

**Результат (заполняется после голосования):**
- Участвовало: `<total_weight>` XRT (квадратичный вес)
- За: `<yes>` (`<pct>%`)
- Против: `<no>` (`<pct>%`)
- Воздержались: `<abstain>`
- Кворум: `<yes|no>`
- Порог 60%: `<yes|no>`

---

## 6. Timelock и исполнение

**On-chain pipeline:**

1. **Safe Multisig 3/5** → `Governance.propose(PARAM_<NAME>, <new_value>)`
2. **Timelock.queue** — задача становится в очередь, `executeAfter = block.timestamp + 7 days`
3. **7 дней ожидания** — пользователи могут выйти, если решение невыгодно
4. **Safe Multisig 3/5** → `Governance.execute(PARAM_<NAME>)` — `Timelock` вызывает `setter(new_value)` на целевом контракте
5. События: `Queued(param, value, executeAfter)`, затем `Executed(param, value)` + `*Updated(old, new)`

**Команды:**

```bash
# 1. Queue (через Safe Multisig)
# Safe → Governance.propose(bytes32("PARAM_BUY_FEE"), 25)

# 2. Через 7 дней — Execute
# Safe → Governance.execute(bytes32("PARAM_BUY_FEE"))

# 3. Проверка
cast call <curveController> "buyFee()(uint256)" --rpc-url $RPC_URL
# 25
Примечание: Governance и Timelock — immutable. Обновление параметра
не требует деплоя. Timelock не имеет cancel после execute; cancel
доступен только до истечения 7 дней.

7. Проверки (pre-flight)
□ ParameterRegistry.get(PARAM_<NAME>).exists == true — параметр зарегистрирован
□ ParameterRegistry.isValid(PARAM_<NAME>, <new_value>) == true
□ Сеттер в контракте имеет onlyRole(GOVERNANCE_ROLE) и bounds-проверку
□ Событие *Updated эмитится при изменении
□ Snapshot-голосование прошло, кворум собран, 60% «за»
□ Аудит-чеклист (R.2.01.11) обновлён — если параметр влияет на инвариант
□ Frontend (web/dapp/app.js) знает про новое значение
□ Мониторинг (O.1.01.01 dashboard, O.1.01.02 alerts) обновлён
8. Rollback plan
Если через 7 дней после execute протокол ведёт себя не так:

Safe Multisig 3/5 → Governance.propose(PARAM_<NAME>, <old_value>)

Timelock.queue — ещё 7 дней

Safe Multisig 3/5 → Governance.execute(PARAM_<NAME>) — откат

Примечание: откат тоже через 7-дневный Timelock. Для критических
параметров (PARAM_CIRCUIT_BREAKER_THRESHOLD) откат — через emergency
proposal (G.2.01.02).

9. Коммуникация
□ Proposal опубликован в Snapshot (ссылка выше)
□ Анонс в официальных каналах (Twitter/X, Discord)
□ Запись в CHANGELOG.md (I.2.01.05) — «Changed»
□ Запись в docs/registry/changelog.md (R.3.01.03) — «Developer changelog»
□ Событие Queued — в мониторинге (O.1.01.02 alert sellTeamFee_changed / PoolPrice_*)
□ docs/registry/faq.md (R.3.01.06) — обновить, если значение видно пользователю
10. Ссылки
C.2.01.03 — Constants.sol (ids параметров)

C.0.01.02 — ParameterRegistry (bounds)

C.7.01.01 — Governance (propose / execute / cancel)

C.7.01.02 — Timelock (queue / execute / cancel, TIMELOCK_DELAY = 7 days)

G.1.01.01–03 — Snapshot space / strategy / validation

O.1.01.02 — alerts (мониторинг параметров)

R.2.01.11 — audit-checklist

R.3.01.04 — contributing (обязательные проверки при добавлении параметра)

text

---

## `governance/proposals/emergency-template.md` (G.2.01.02)

```markdown
# [Emergency] <action>

**Тип:** emergency
**Блок:** G.2.01.02
**Автор:** @username / Safe Multisig 3/5
**Дата:** YYYY-MM-DD
**Severity:** `<critical | high | medium>`
**Категория:** `<exploit | price-manipulation | reserve-drain | external-dependency>`

---

## 1. Incident summary

<3–5 предложений: что произошло, когда обнаружено, что затронуто.>

**Пример:** «В 14:32 UTC обнаружен рост `poolPrice` выше `ceiling` на 3%.
Индикатор: alert `PoolPrice_ceiling_triggered` (O.1.01.02). Причина —
серия `buyFromCurveFor` от скомпрометированного `poolController`. Оценка
потерь: 0 USDC (обнаружено до вывода).»

**Ссылки:**
- Alert: `O.1.01.02` `<rule_name>`
- Tenderly trace: `<link>`
- Dashboard: `O.1.01.01` `<panel>`
- Snapshot reserve / freeReserve на момент инцидента: `<...>`

---

## 2. Impact if NOT executed

| Сценарий | Оценка потерь | Время до реализации |
|---|---|---|
| `<exploit continues>` | `<loss_usdc>` | `<hours>` |
| `<reserve drained>` | `<loss_usdc>` | `<hours>` |
| `<reputational>` | — | немедленно |

**Приоритет:** `<P0 | P1 | P2>` — определяет срок голосования:
- P0 (critical): 2 часа on-chain + 2 дня Snapshot
- P1 (high): 2 дня Snapshot
- P2 (medium): 7 дней Snapshot (как обычный params)

---

## 3. Proposed action

Выбери **одно** (или комбинацию):

### 3.1. Pause trading

```solidity
// Safe Multisig 3/5 → PAUSER_ROLE → pause()
ICurveController(curveController).pause();
IPoolController(poolController).pause();
Эффект: блокирует buyFromCurve, redeemFromCurve, buyFromCurveFor,
buyFromPool, sellToPool. Пользователи не могут выйти.

Не блокирует: admin-функции (set*), governance, pay из ReserveManager.

Восстановление: unpause() — только GOVERNANCE_ROLE (через Timelock,
7 дней). Важно: после паузы governance-путь медленный, что даёт время
на анализ.

3.2. Change CircuitBreaker threshold
solidity
// Safe Multisig 3/5 → GOVERNANCE_ROLE → Timelock → setThreshold(500)  // 5%
ICircuitBreaker(circuitBreaker).setThreshold(500);
Эффект: CB срабатывает быстрее (при freeReserve/reserve < 5%),
блокирует sellToPool (не блокирует redeemFromCurve).

Задержка: 7 дней через Timelock. Для P0 — не подходит (слишком
медленно). Используй pause().

3.3. Change sellTeamFee (экстренно)
solidity
// Safe Multisig 3/5 → GOVERNANCE_ROLE → Timelock → setSellTeamFee(0)
ICurveController(curveController).setSellTeamFee(0);
Эффект: убирает USDC-поток в treasury. Если treasury — вектор атаки —
это митигация.

Задержка: 7 дней. Для P0 — не подходит.

3.4. Другое
<описать> — если ни одна из выше не применима.

4. Pre-conditions
□ Alert сработал (O.1.01.02)
□ Incident Response Plan активирован (O.3.01.02)
□ Команда оповещена (Telegram / Discord / email)
□ Snapshot состояния: reserve, freeReserve, poolPrice, treasury на момент T0
□ Причина понятна (или есть рабочая гипотеза)
□ Потери оценены (<loss_usdc>)
5. Голосование (emergency)
Snapshot:

Space: xartia.eth

Quorum: 25 000 XRT (emergency пониженный, G.1.01.03)

Период: 2 дня

Порог: 50% «за» (emergency — не 60%)

Ссылка: <https://snapshot.org/#/xartia.eth/proposal/0x...>

Если P0 (critical) — голосование может быть пропущено. Safe Multisig
3/5 исполняет pause() немедленно, постфактум — Snapshot с обоснованием
в течение 48 часов. Это предусмотрено validation.json (G.1.01.03,
proposal_types.emergency.post_review).

6. Исполнение
Сценарий A: PAUSER_ROLE (немедленно)
bash
# 1. Safe Multisig 3/5 — pause CurveController
# Safe → ICurveController(curveController).pause()

# 2. Safe Multisig 3/5 — pause PoolController
# Safe → IPoolController(poolController).pause()

# 3. Проверка
cast call <curveController> "paused()(bool)" --rpc-url $RPC_URL
# true
Задержка: 0 (PAUSER_ROLE → pause() без Timelock).

Сценарий B: GOVERNANCE_ROLE (через Timelock, 7 дней)
Применяется для setThreshold, setSellTeamFee, setBuyFee, unpause.
Стандартный pipeline (как в G.2.01.01 §6).

7. Post-execution review
Обязательно в течение 7 дней после исполнения:

□ Snapshot-голосование с обоснованием (если P0 исполнен без голосования)
□ Post-mortem документ (ops/incident-response.md, O.3.01.02) — что
произошло, как обнаружено, что сделали, как предотвратим
□ Обновление docs/tech/threat-model.md (R.2.01.09) — если новый вектор
□ Обновление docs/tech/security-model.md (R.2.01.08) — если новая митигация
□ Обновление R.2.01.11 audit-checklist.md — если новый пункт проверки
□ Bug bounty (если применимо)
□ Коммуникация сообществу: что произошло, что сделано, что дальше
□ CHANGELOG.md (I.2.01.05) — запись «Security»
□ Tenderly trace / on-chain evidence — приложить к post-mortem
8. Unpause / rollback
Если pause был выбран:

Safe Multisig 3/5 → Governance.propose(PARAM_UNPAUSE, 0) —
GOVERNANCE_ROLE → Timelock → unpause().

Timelock.queue → 7 дней.

Safe Multisig 3/5 → Governance.execute(PARAM_UNPAUSE).

Важно: unpause — только GOVERNANCE_ROLE. PAUSER_ROLE не может
unpause. Это by design (см. C.3.01.01, C.3.01.02): pause — быстро,
unpause — медленно, через governance.

Альтернатива (P0 rollback): если 7 дней слишком долго, атака
продолжается — эскалация к «деплой новой системы + миграция» (см.
ops/upgrade-guide.md, O.3.01.03). Это крайняя мера.

9. Коммуникация
□ Twitter/X — анонс инцидента (если средства под угрозой)
□ Discord — pinned message в #announcements
□ Email — держателям, если есть база
□ Snapshot-голосование — публично
□ Post-mortem — публично через 7 дней
10. Ссылки
O.1.01.02 — alerts

O.3.01.02 — incident-response

O.3.01.04 — emergency-procedures

C.3.01.01, C.3.01.02 — pause() / unpause()

C.6.01.01 — CircuitBreaker.setThreshold

G.1.01.03 — Snapshot validation (emergency type)

R.2.01.08, R.2.01.09 — security/threat models

text

---

## `governance/proposals/upgrade-template.md` (G.2.01.03)

```markdown
# [Upgrade] <contract> <from_version> → <to_version>

**Тип:** upgrade
**Блок:** G.2.01.03
**Автор:** @username / Safe Multisig 3/5
**Дата:** YYYY-MM-DD
**Контракт:** `<CurveController | PoolController | ...>`
**Текущая версия:** `v.0.0.X`
**Новая версия:** `v.0.0.Y`
**Audit report:** `<link to legal/audit-report.pdf>` (если применимо)

---

## 1. Введение

**Важно:** контракты XartIA **иммутабельны**. Нет `upgradeable`, нет
прокси. «Upgrade» — это деплой новой системы + миграция состояния через
новый `XartIAFactory`. Подробнее — `ops/upgrade-guide.md` (O.3.01.03).

Эта proposal — для governance-решения о миграции, не для
`Governance.execute` (которое меняет только параметры существующих
контрактов).

---

## 2. Мотивация

<2–5 абзацев: почему текущая версия не устраивает. Баг, найденный аудитом;
новая функциональность; изменение экономики; регуляторное требование.>

**Ссылки:**
- Аудит-отчёт: `<link>`
- Bug bounty: `<link>`
- Known issues: `docs/tech/audit-checklist.md` (R.2.01.11)

---

## 3. Объём изменений

| Контракт | Изменения | Риск |
|---|---|---|
| `CurveController` | `<описание>` | `<low / medium / high>` |
| `PoolController` | `<описание>` | `<low / medium / high>` |
| `ReserveManager` | `<описание>` | `<low / medium / high>` |
| `<...>` | `<...>` | `<...>` |

**Breaking changes:**
- [ ] Изменены публичные API (`<function_name>`)
- [ ] Изменены события (`<event_name>`)
- [ ] Изменены bounds параметров
- [ ] Изменена математика (`P`, `R`, `deltaSForBuy`, `poolPrice`)
- [ ] Изменены инварианты (`reserve ≥ R(S)`, `poolPrice` в коридоре, `totalSupply == S_curve`)

---

## 4. Аудит

- [ ] Внешний аудит проведён (`legal/audit-report.pdf`)
- [ ] Все `critical` и `high` findings закрыты
- [ ] `medium` — закрыты или приняты с обоснованием
- [ ] `low` / `informational` — задокументированы
- [ ] Slither / Mythril / Foundry test — пройдены (CI, `.github/workflows/audit.yml`)
- [ ] Fuzz (10 000 runs) / Invariant (1000×100) / Crash — пройдены
- [ ] Покрытие ≥ 95% (`forge coverage`)

**Audit report:** `<link to legal/audit-report.pdf>`

**Если аудита ещё нет:** proposal **не может** быть исполнен. Mainnet
deploy после аудита — обязательно (см. `README.md`).

---

## 5. Migration plan

### 5.1. Pre-deploy

- [ ] Конфиги обновлены (`config/polygon.toml`, `config/amoy.toml`)
- [ ] `config/levels.json` — если новые уровни (иммутабельны, требуют
      нового `Levels`)
- [ ] Safe Multisig 3/5 подтверждён (тот же адрес или новый?)
- [ ] Treasury подтверждён (тот же адрес или новый?)
- [ ] Тесты на Amoy testnet — полный прогон
- [ ] Dry-run на fork (`forge script --fork-url <mainnet> ...`)

### 5.2. Deploy new system

```bash
# 1. Deploy new Factory + all contracts
NETWORK=polygon make deploy-mainnet

# 2. Initialize (levels + poolPrice + params)
NETWORK=polygon make init

# 3. Verify on Polygonscan
NETWORK=polygon make verify

# 4. Finalize (ownership → Safe Multisig)
NETWORK=polygon make finalize
Результат: новые адреса в deployments/polygon.json (переименовать
старый в deployments/polygon.old.json для истории).

5.3. Миграция состояния
Внимание: контракты не имеют migrateFrom. Состояние нового протокола
— «с нуля»:

S_curve = 0, reserve = 0, pool = 0, poolPrice = P(0) (genesis).

Пользователи не могут автоматически перенести свои XRT из старой системы.

Требуется snapshot balances в старом протоколе → ручной airdrop нового XRT.

Процедура:

Snapshot XartIAToken.balanceOf(user) для всех держателей на блоке T.

Snapshot ReserveManager.balanceOf(USDC) — фактический резерв.

Snapshot Vesting — totalAdded, totalReleased, vestingStart.

Публикация snapshot в IPFS + Git (аудит).

Решение 1 (мягкое): пользователи получают 1:1 XRT в новом
протоколе через отдельный airdrop-контракт.

Решение 2 (жёсткое): пользователи получают USDC из старого резерва
через redeemFromCurve в старой системе (если она не заморожена) +
1:1 XRT в новой.

Решение 3 (fork): vm.store вручную — только для тестовых целей,
не для mainnet.

5.4. Post-deploy
□ Старая система: pause() через PAUSER_ROLE (Safe Multisig 3/5).
□ Старая система: sellTeamFee = 0, buyFee = 0, redeemFee = 0
(если возможно — через Timelock 7 дней).
□ Обновление deployments/*.json.
□ Обновление web/dapp/abis/index.js — новые адреса.
□ Обновление ops/indexer/subgraph.yaml — новые адреса.
□ Обновление ops/monitoring/* — новые адреса контрактов.
□ Мониторинг нового протокола — 24/7 в первые 7 дней.
6. Риски
Риск	Митигация
Airdrop неточен (пропущены адреса)	snapshot в IPFS + публичная проверка
Старая система остаётся активной → две системы работают параллельно	pause() старой системы через PAUSER_ROLE сразу после deploy
Потеря Vesting — команда теряет teamTokens	snapshot totalAdded, воссоздать Vesting в новой системе с тем же vestingStart
Индексатор / мониторинг падает	тест на Amoy за 7 дней до mainnet
Frontend показывает старые адреса	обновление web/dapp/abis/index.js до mainnet
Пользователи путают старую и новую систему	громкая коммуникация, deprecated-баннер на UI
7. Голосование
Snapshot:

Space: xartia.eth

Quorum: 200 000 XRT (upgrade — повышенный, G.1.01.03)

Период: 14 дней (upgrade — длиннее обычного)

Порог: 60% «за» + кворум

Ссылка: <https://snapshot.org/#/xartia.eth/proposal/0x...>

Результат:

Участвовало: <total_weight> XRT (квадратичный вес)

За: <yes> (<pct>%)

Против: <no> (<pct>%)

Кворум: <yes|no>

Порог 60%: <yes|no>

8. Исполнение
Governance.execute не применим к upgrade (он меняет только
параметры существующих контрактов). Вместо этого:

Safe Multisig 3/5 подтверждает голосование (Snapshot result).

Safe Multisig 3/5 выполняет deploy-скрипты (make deploy-mainnet,
make init, make verify, make finalize).

Safe Multisig 3/5 выполняет миграцию (airdrop, pause старой системы).

Approvals: 3 из 5 подписей Safe Multisig, как для обычных транзакций.

9. Rollback
Если после миграции новая система показывает баги:

Safe Multisig 3/5 → pause() новой системы (PAUSER_ROLE).

Safe Multisig 3/5 → unpause() старой системы — если она была
заморожена, но не «выведена из эксплуатации».
Проблема: если старая система уже отдала USDC через airdrop — резерв
исчерпан, unpause бесполезен.

Fallback: деплой third system (редко).

Коммуникация: публичное объяснение, что пошло не так.

Худший сценарий: средства потеряны. Это возможно только при
некорректной миграции. Mitigation — dry-run на fork, аудит migration-скриптов.

10. Ссылки
ops/upgrade-guide.md (O.3.01.03) — пошаговая процедура

ops/emergency-procedures.md (O.3.01.04) — emergency

R.2.01.08 — security-model

R.2.01.09 — threat-model

R.2.01.11 — audit-checklist

C.8.01.01 — XartIAFactory (deploy)

D.1.01.01–07 — deploy-скрипты

D.2.01.01–02 — конфиги сетей

G.1.01.03 — validation (upgrade type)

text

---

## `governance/proposals/budget-template.md` (G.2.01.04)

```markdown
# [Budget] <period> <amount> USDC

**Тип:** budget
**Блок:** G.2.01.04
**Автор:** @username / Safe Multisig 3/5
**Дата:** YYYY-MM-DD
**Период:** `<Q1 2027 | 2026-11 | 3 месяца>`
**Сумма:** `<amount>` USDC
**Получатель:** `<Safe Multisig | операционный счёт | контракт>`

---

## 1. Обоснование

<2–3 абзаца: зачем нужны средства, какие задачи будут профинансированы,
как это связано с roadmap (R.3.01.07).>

**Источники финансирования:**
- `treasury` (sellTeamFee, накопленный protocol revenue): `<X>` USDC
- Казна (буфер, 10% выручки Шлюза, §7 XartIA 4.2): `<Y>` USDC
- Внешние источники (гранты, партнёры): `<Z>` USDC

**Ссылки:**
- Текущий баланс: `balanceOf(USDC, treasury)` — `<amount>` USDC
- `ops/monitoring/dashboard.json` (O.1.01.01), панель `treasuryBalance`
- Прошлые бюджеты: `<link>`

---

## 2. Бюджет по статьям

| Статья | Сумма (USDC) | Доля | Описание |
|---|---:|---:|---|
| Аудит | `<amount>` | `<%>` | Внешний аудит новых контрактов / ре-аудит |
| Разработка | `<amount>` | `<%>` | Контракты, тесты, документация |
| Инфраструктура | `<amount>` | `<%>` | Серверы, RPC, subgraph, Grafana, Tenderly |
| Bug bounty | `<amount>` | `<%>` | Программа (см. SECURITY.md) |
| Юристы | `<amount>` | `<%>` | Jurisdiction opinion, Terms, ToS |
| Маркетинг / коммуникации | `<amount>` | `<%>` | Анонсы, документация, перевод |
| Резерв | `<amount>` | `<%>` | Непредвиденные расходы (5–10%) |
| **Итого** | **`<total>`** | **100%** | |

---

## 3. Milestones

| # | Milestone | Дедлайн | Сумма | Критерий приёмки |
|---|---|---|---:|---|
| 1 | `<milestone>` | `<date>` | `<amount>` | `<acceptance criteria>` |
| 2 | `<milestone>` | `<date>` | `<amount>` | `<acceptance criteria>` |
| 3 | `<milestone>` | `<date>` | `<amount>` | `<acceptance criteria>` |

**Формат milestone:** конкретный результат (merge PR, публикация
аудита, деплой контракта), а не «начать работу».

---

## 4. Reporting schedule

| Отчёт | Срок | Что включено |
|---|---|---|
| Monthly | 5-е число каждого месяца | расходы, прогресс milestones, риски |
| Quarterly | конец квартала | полный отчёт, аудит расходов, обновление roadmap |
| Post-milestone | 7 дней после milestone | отчёт о выполнении критериев |

**Публикация:** `<GitHub | docs/ | IPFS>`

**Формат:** markdown-документ с таблицей расходов, ссылками на
on-chain транзакции, прогрессом по milestones.

---

## 5. Распределение

**Способ 1: одноразовый перевод на Safe Multisig получателя.**

```solidity
// Safe Multisig 3/5 → treasury Safe
// 1. Governance.propose(BUDGET_ID, amount)
// 2. Timelock.queue — 7 дней
// 3. Governance.execute(BUDGET_ID)
// 4. treasury.multisend([recipient], [amount])
Способ 2: поэтапное (streaming) — предпочтительно для крупных сумм.

Деплой SablierV2 stream на Safe Multisig получателя.

Stream duration: <X> месяцев.

Monthly vesting, unlocked каждую неделю.

Способ 3: milestone-based escrow.

Деплой escrow-контракта (custom) с release по milestone.

Safe Multisig 3/5 (proposer) + Safe Multisig 3/5 (verifier) —
dual approval на каждый milestone.

Реализация: в рамках этой proposal не описывается код escrow —
только распределение через Safe Multisig после approve по milestone.
Для крупных сумм — отдельная proposal с кодом.

6. KPI
KPI	Цель	Метрика
Аудит пройден	да	legal/audit-report.pdf
Bug bounty запущен	да	SECURITY.md обновлён
TVL (ReserveManager)	>$X	O.1.01.01 dashboard reserve
Пользователи	>N	O.2.01.01 subgraph User.id
Аудит-репортов	≥1	legal/audit-report.pdf
Если KPI не достигнуты — следующий бюджет обсуждается с учётом
результатов (публично).

7. Голосование
Snapshot:

Space: xartia.eth

Quorum: 100 000 XRT (budget, G.1.01.03)

Период: 7 дней

Порог: 60% «за»

Ссылка: <https://snapshot.org/#/xartia.eth/proposal/0x...>

Результат:

Участвовало: <total_weight> XRT

За / Против / Воздержались: <yes> / <no> / <abstain>

Кворум: <yes|no>

8. Исполнение
Safe Multisig 3/5 → Governance.propose(BUDGET_PARAM, amount) —
если BUDGET_PARAM зарегистрирован в ParameterRegistry.

Timelock.queue → 7 дней.

Safe Multisig 3/5 → Governance.execute(BUDGET_PARAM).

Safe Multisig 3/5 → перевод amount USDC с treasury на
получателя (Safe Multisig, см. §5).

Примечание: Governance.execute поддерживает только bytes32 param
→ setter(uint256). Для бюджета BUDGET_PARAM должен быть зарегистрирован
в ParameterRegistry с target = treasury (или Safe Multisig), setter =
transfer(address,uint256) — но transfer не подходит под setter(uint256).

Решение: для бюджета использовать прямой перевод от Safe Multisig 3/5 с timelock на стороне Safe (Safe Multisig имеет native timelock
модуль). Не через Governance.execute.

Pipeline (уточнённый):

Snapshot-голосование → 7 дней.

Safe Multisig 3/5 → queue transaction с 7-дневным Safe timelock.

Через 7 дней — execute на Safe Multisig → перевод USDC.

Это соответствует духу Timelock, даже если не идёт через Timelock.queue
контракта (который ограничен параметрами ParameterRegistry).

9. Риски
Риск	Митигация
Средства потрачены не по назначению	Safe Multisig 3/5 + Timelock 7 дней + публичный отчёт
Milestones не достигнуты	clawback clause (не возвращены — публичный отчёт)
Перерасход	escalation в Snapshot с обоснованием
Treasury опустел	hold 5–10% в резерве, не тратить всё сразу
Safe Multisig получателя скомпрометирован	отдельный Safe для ops, не тот же, что treasury
10. Clawback / возврат
Если milestone не достигнут:

Опция A (мягкая): перенос на следующий период, публичный отчёт.

Опция B (жёсткая): возврат USDC на treasury через Safe Multisig
получателя. Требует согласия получателя (не принудительно on-chain).

Опция C (юридическая): если есть договор — escalation через юристов.

11. Ссылки
treasury (immutable адрес в XartIAFactory)

O.1.01.01 — dashboard (treasuryBalance)

O.1.01.02 — alerts (treasury_balance_anomaly, treasury_balance_decrease)

R.3.01.07 — roadmap

CHANGELOG.md (I.2.01.05) — запись «Budget»

SECURITY.md — bug bounty (если статья бюджета)

G.1.01.03 — validation (budget type)

text

---

## `.github/workflows/test.yml` (I.1.01.01)

```yaml
# =============================================================================
# CI: Test workflow
#
# Runs on every PR to develop/main and push to main.
# Stages: build → unit → fuzz → invariant → crash → integration → gas → coverage.
# Fails if coverage < 95%.
#
# Block: I.1.01.01
# Depends on: D.2.01.04 (foundry.toml), T.1.*–T.7.*
# =============================================================================

name: Test

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main, develop]

concurrency:
  group: test-${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

env:
  FOUNDRY_PROFILE: default
  FOUNDRY_FUZZ_RUNS: "10000"
  FOUNDRY_INVARIANT_RUNS: "1000"
  FOUNDRY_INVARIANT_DEPTH: "100"
  COVERAGE_MIN: "95"

jobs:
  build:
    name: Build
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v4
        with:
          submodules: recursive

      - name: Install Foundry
        uses: foundry-rs/foundry-toolchain@v1
        with:
          version: stable

      - name: Cache Foundry
        uses: actions/cache@v4
        with:
          path: |
            ~/.foundry/cache
            out
            cache
          key: ${{ runner.os }}-foundry-build-${{ hashFiles('foundry.toml', 'remappings.txt', 'lib/**/foundry.toml') }}
          restore-keys: |
            ${{ runner.os }}-foundry-build-

      - name: Install Solidity deps
        run: |
          forge install foundry-rs/forge-std --no-commit || true
          forge install OpenZeppelin/openzeppelin-contracts --no-commit || true

      - name: forge build --sizes
        run: forge build --sizes

  test-unit:
    name: Unit tests
    runs-on: ubuntu-latest
    needs: build
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v4
        with: { submodules: recursive }
      - uses: foundry-rs/foundry-toolchain@v1
        with: { version: stable }
      - name: Restore cache
        uses: actions/cache@v4
        with:
          path: |
            ~/.foundry/cache
            out
            cache
          key: ${{ runner.os }}-foundry-build-${{ hashFiles('foundry.toml', 'remappings.txt') }}
      - name: Install deps
        run: |
          forge install foundry-rs/forge-std --no-commit || true
          forge install OpenZeppelin/openzeppelin-contracts --no-commit || true
      - name: Run unit tests
        run: forge test --match-path 'test/unit/*' -vv

  test-fuzz:
    name: Fuzz tests
    runs-on: ubuntu-latest
    needs: build
    timeout-minutes: 20
    steps:
      - uses: actions/checkout@v4
        with: { submodules: recursive }
      - uses: foundry-rs/foundry-toolchain@v1
        with: { version: stable }
      - name: Restore cache
        uses: actions/cache@v4
        with:
          path: |
            ~/.foundry/cache
            out
            cache
          key: ${{ runner.os }}-foundry-build-${{ hashFiles('foundry.toml', 'remappings.txt') }}
      - name: Install deps
        run: |
          forge install foundry-rs/forge-std --no-commit || true
          forge install OpenZeppelin/openzeppelin-contracts --no-commit || true
      - name: Run fuzz tests
        env:
          FOUNDRY_FUZZ_RUNS: "10000"
        run: forge test --match-path 'test/fuzz/*' -vv

  test-invariant:
    name: Invariant tests
    runs-on: ubuntu-latest
    needs: build
    timeout-minutes: 45
    steps:
      - uses: actions/checkout@v4
        with: { submodules: recursive }
      - uses: foundry-rs/foundry-toolchain@v1
        with: { version: stable }
      - name: Restore cache
        uses: actions/cache@v4
        with:
          path: |
            ~/.foundry/cache
            out
            cache
          key: ${{ runner.os }}-foundry-build-${{ hashFiles('foundry.toml', 'remappings.txt') }}
      - name: Install deps
        run: |
          forge install foundry-rs/forge-std --no-commit || true
          forge install OpenZeppelin/openzeppelin-contracts --no-commit || true
      - name: Run invariant tests
        env:
          FOUNDRY_INVARIANT_RUNS: "1000"
          FOUNDRY_INVARIANT_DEPTH: "100"
        run: forge test --match-path 'test/invariant/*' -vv

  test-crash:
    name: Crash tests
    runs-on: ubuntu-latest
    needs: build
    timeout-minutes: 20
    steps:
      - uses: actions/checkout@v4
        with: { submodules: recursive }
      - uses: foundry-rs/foundry-toolchain@v1
        with: { version: stable }
      - name: Restore cache
        uses: actions/cache@v4
        with:
          path: |
            ~/.foundry/cache
            out
            cache
          key: ${{ runner.os }}-foundry-build-${{ hashFiles('foundry.toml', 'remappings.txt') }}
      - name: Install deps
        run: |
          forge install foundry-rs/forge-std --no-commit || true
          forge install OpenZeppelin/openzeppelin-contracts --no-commit || true
      - name: Run crash tests
        run: forge test --match-path 'test/crash/*' -vv

  test-integration:
    name: Integration tests
    runs-on: ubuntu-latest
    needs: build
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v4
        with: { submodules: recursive }
      - uses: foundry-rs/foundry-toolchain@v1
        with: { version: stable }
      - name: Restore cache
        uses: actions/cache@v4
        with:
          path: |
            ~/.foundry/cache
            out
            cache
          key: ${{ runner.os }}-foundry-build-${{ hashFiles('foundry.toml', 'remappings.txt') }}
      - name: Install deps
        run: |
          forge install foundry-rs/forge-std --no-commit || true
          forge install OpenZeppelin/openzeppelin-contracts --no-commit || true
      - name: Run integration tests
        run: forge test --match-path 'test/integration/*' -vv

  test-gas:
    name: Gas tests
    runs-on: ubuntu-latest
    needs: build
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@v4
        with: { submodules: recursive }
      - uses: foundry-rs/foundry-toolchain@v1
        with: { version: stable }
      - name: Restore cache
        uses: actions/cache@v4
        with:
          path: |
            ~/.foundry/cache
            out
            cache
          key: ${{ runner.os }}-foundry-build-${{ hashFiles('foundry.toml', 'remappings.txt') }}
      - name: Install deps
        run: |
          forge install foundry-rs/forge-std --no-commit || true
          forge install OpenZeppelin/openzeppelin-contracts --no-commit || true
      - name: Run gas tests
        run: forge test --match-path 'test/gas/*' -vv

  coverage:
    name: Coverage (≥ ${{ env.COVERAGE_MIN }}%)
    runs-on: ubuntu-latest
    needs: build
    timeout-minutes: 30
    steps:
      - uses: actions/checkout@v4
        with: { submodules: recursive }
      - uses: foundry-rs/foundry-toolchain@v1
        with: { version: stable }
      - name: Restore cache
        uses: actions/cache@v4
        with:
          path: |
            ~/.foundry/cache
            out
            cache
          key: ${{ runner.os }}-foundry-build-${{ hashFiles('foundry.toml', 'remappings.txt') }}
      - name: Install deps
        run: |
          forge install foundry-rs/forge-std --no-commit || true
          forge install OpenZeppelin/openzeppelin-contracts --no-commit || true
      - name: Run coverage
        run: forge coverage --report lcov --report summary > coverage-summary.txt 2>&1 || true
      - name: Print coverage summary
        run: cat coverage-summary.txt
      - name: Check coverage >= 95%
        run: |
          PCT=$(grep -E '^\| Total' coverage-summary.txt | grep -oE '[0-9]+(\.[0-9]+)?' | tail -1 | cut -d. -f1 || echo "0")
          echo "Coverage: ${PCT}%"
          if [ "${PCT}" -lt "${COVERAGE_MIN}" ]; then
            echo "::error::Coverage ${PCT}% < ${COVERAGE_MIN}%"
            exit 1
          fi
      - name: Upload coverage artifact
        uses: actions/upload-artifact@v4
        if: always()
        with:
          name: coverage-lcov
          path: lcov.info
          retention-days: 30
      - name: Upload coverage summary
        uses: actions/upload-artifact@v4
        if: always()
        with:
          name: coverage-summary
          path: coverage-summary.txt
          retention-days: 30

  summary:
    name: Test summary
    runs-on: ubuntu-latest
    needs:
      - build
      - test-unit
      - test-fuzz
      - test-invariant
      - test-crash
      - test-integration
      - test-gas
      - coverage
    if: always()
    steps:
      - name: Print result
        run: |
          echo "build:              ${{ needs.build.result }}"
          echo "test-unit:          ${{ needs.test-unit.result }}"
          echo "test-fuzz:          ${{ needs.test-fuzz.result }}"
          echo "test-invariant:     ${{ needs.test-invariant.result }}"
          echo "test-crash:         ${{ needs.test-crash.result }}"
          echo "test-integration:   ${{ needs.test-integration.result }}"
          echo "test-gas:           ${{ needs.test-gas.result }}"
          echo "coverage:           ${{ needs.coverage.result }}"
      - name: Fail if any job failed
        if: contains(needs.*.result, 'failure')
        run: exit 1