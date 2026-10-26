# Security Policy — XartIA

**Протокол не прошёл внешний аудит.** Не используйте с реальными средствами до публикации
`legal/audit-report.pdf`. Ниже — процедура раскрытия уязвимостей и модель безопасности.

---

## Поддерживаемые версии

| Версия | Статус | Поддержка |
|---|---|---|
| `0.0.x` (draft) | Pre-audit, pre-mainnet | ✅ активная разработка |
| `main` | Deploy-ready после аудита | ⏳ не задеплоен |

Mainnet-контракты будут иммутабельными после `finalize()`. Обновление — только через pause +
миграцию (`ops/upgrade-guide.md`, O.3.01.03).

---

## Как сообщить об уязвимости

**НЕ создавайте публичный GitHub Issue для уязвимостей безопасности.**

Используйте один из каналов:

1. **GitHub Security Advisory** — приватный канал:
   `https://github.com/<org>/xartia/security/advisories/new`
2. **Email:** `security@xartia.example` — с PGP-шифрованием (ключ ниже).
3. **PGP-ключ:** `0xXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX`
   (fingerprint: `XXXX XXXX XXXX XXXX XXXX  XXXX XXXX XXXX XXXX XXXX`)

### Что включить в отчёт

- **Краткое описание** (1–2 предложения)
- **Контракт и функция** (например, `C.3.01.01 CurveController.redeemFromCurve`)
- **Воспроизведение:** минимальный Foundry-тест, последовательность транзакций, или точные шаги
- **Влияние:** что именно теряется (средства, инвариант, доступ)
- **Severity** (по вашему мнению, см. ниже)
- **Предлагаемое исправление** (если есть)

Не прикладывайте реальные private keys, seed phrases или личные данные. Используйте тестовые.

---

## Что в зоне охвата

**In scope:**

| Контракт | Файл | Блок |
|---|---|---|
| XartIAToken | `contracts/token/XartIAToken.sol` | C.1.01.01 |
| CurveController | `contracts/controllers/CurveController.sol` | C.3.01.01 |
| PoolController | `contracts/controllers/PoolController.sol` | C.3.01.02 |
| ReserveManager | `contracts/reserve/ReserveManager.sol` | C.4.01.01 |
| Vesting | `contracts/vesting/Vesting.sol` | C.5.01.01 |
| CircuitBreaker | `contracts/safety/CircuitBreaker.sol` | C.6.01.01 |
| Governance | `contracts/governance/Governance.sol` | C.7.01.01 |
| Timelock | `contracts/governance/Timelock.sol` | C.7.01.02 |
| XartIAFactory | `contracts/factory/XartIAFactory.sol` | C.8.01.01 |
| CurveMath / LevelMath | `contracts/math/CurveMath.sol`, `LevelMath.sol` | C.2.01.01–02 |
| Levels | `contracts/math/Levels.sol` | C.2.01.09 |
| PoolState | `contracts/math/PoolState.sol` | C.2.01.12 |
| ParameterRegistry | `contracts/core/ParameterRegistry.sol` | C.0.01.02 |
| MathLib / PrecisionLib | `contracts/libraries/*.sol` | C.9.01.01–02 |

**In scope (инфраструктура):**

- Скрипты деплоя (`script/Deploy.s.sol`, `Initialize.s.sol`, `Finalize.s.sol`)
- Обработчик subgraph (`ops/indexer/*`) — если приводит к некорректной индексации
- Python-модели (`e/02_simulation/*`) — если математика расходится с Solidity

**Классы уязвимостей (in scope):**

- Кража или блокировка средств (USDC, XRT)
- Нарушение инвариантов (`reserve ≥ curveBacking`, `totalSupply == S_curve`, `poolPrice` в коридоре)
- Обход access control (`CONTROLLER_ROLE`, `GOVERNANCE_ROLE`, `PAUSER_ROLE`, `MINTER_ROLE`)
- Reentrancy в trade-функциях
- Манипуляция `poolPrice` за пределами коридора
- Некорректное обновление `S_curve` / `pool` / `poolPrice`
- Integer overflow / underflow в математике (при `unchecked`-блоках)
- Precision loss, приводящий к экономическому дисбалансу
- Governance takeover через `Timelock` / `Governance`
- DoS через `circuitBreaker` / `pause` / `maxSellPctPerDay`
- Компрометация `treasury` через `sellTeamFee`

---

## Что НЕ в зоне охвата

**Out of scope:**

- dApp (`web/dapp/*`) — UI-баги, XSS, wallet-connection, frontend-логика
- Ops-инфраструктура (`ops/*`) — Grafana, Prometheus, subgraph (если не влияет на контракты)
- Python-модели (`e/02_simulation/*`) — если расхождение с Solidity объясняется float vs integer
- Юридические документы (`legal/*`) — это не код
- Атаки, требующие компрометации Safe Multisig 3/5 (вне модели)
- Атаки, требующие ≥ 51% hash power на Polygon PoS
- Теоретические атаки без practically-exploitable сценария (например, квантовые)
- Gas-оптимизации без экономического эффекта
- Баги в `MockUSDC` / `MockSafe` — это тестовые контракты, не production
- Уязвимости в OpenZeppelin (репортите в OZ)
- Уязвимости в Polygon PoS, USDC, Safe — репортите соответствующим командам

---

## Disclosure policy

1. **Приватное раскрытие** — вы сообщаете нам приватно (см. выше).
2. **Подтверждение** — мы отвечаем в течение **3 рабочих дней**.
3. **Валидация** — мы анализируем и подтверждаем/опровергаем уязвимость в течение **7 рабочих дней**.
4. **Исправление** — для in-scope high/critical: патч в течение **30 дней**.
5. **Публичное раскрытие** — через **90 дней** после подтверждения или после публикации патча
   (что раньше). Согласовывается с репортером.
6. **Credit** — публикуем ваше имя (или pseudonym) в `CHANGELOG.md` и audit-отчёте, если вы
   согласны.

Если мы не ответили в течение 3 рабочих дней — повторите письмо с темой `[URGENT]`.

---

## Bug bounty (после mainnet)

**До mainnet bug bounty не активен.** Уязвимости в pre-audit коде — сообщайте приватно, без
ожидания вознаграждения. После аудита и деплоя на Polygon PoS — программа будет опубликована
в этом файле и на GitHub Security.

Предварительная структура (TBD):

| Severity | Описание | Bounty |
|---|---|---:|
| Critical | Кража средств, потеря > 50% резерва | до 50 000 USDC |
| High | Нарушение инварианта, блокировка > 1000 USDC | до 15 000 USDC |
| Medium | DoS, ограниченная утечка, precision loss | до 5 000 USDC |
| Low | Best practice, gas, документация | до 500 USDC |

Финальные суммы и условия — после аудита. Bounty не применяется к:
- Out-of-scope (см. выше)
- Known issues в `docs/tech/audit-checklist.md`
- Атакам, требующим компрометации Safe 3/5
- Социальной инженерии

---

## Safe harbor

Мы обязуемся не инициировать юридические действия против исследователей безопасности, которые:

1. Действуют добросовестно (не наносят ущерб, не крадут средства, не публикуют данные
   пользователей).
2. Следуют политике раскрытия (см. выше).
3. Не атакуют инфраструктуру, кроме тестовых сетей (Amoy, local anvil).
4. Не используют уязвимость для извлечения прибыли.

Это соответствует принципам
[disclose.io](https://disclose.io/).

---

## Ключевые инварианты (справка для аудита)

Формальные доказательства — `e/01_core/invariant_proof.md` (E.1.01.06) и
`e/01_core/pool_price_proof.md` (E.1.01.07).

| Инвариант | Проверка в коде | Тест |
|---|---|---|
| `reserve ≥ curveBacking` | `ReserveManager.updateScurve` → `ReserveInvariantViolation` | T.3.01.01 |
| `totalSupply == S_curve` | CurveController mint/burn + PoolController не минтит | T.3.01.02 |
| `poolPrice ∈ [P(S)/(1+GAP), P(S)*(1+GAP)]` | `_enforcePoolPriceFloor`, `_clampPoolPriceToCorridor` | T.3.01.03 |
| `freeReserve + curveBacking == reserve` | `ReserveManager.freeReserve()` | T.3.01.04 |
| `poolPrice` монотонен при `sellToPool` | `PoolController.sellToPool` (`mult_bp ≥ 1`) | T.3.01.05 |
| `P(S)` непрерывна на границах | `Levels.init()` (проверка `P_end_i == P_start_{i+1}`) | T.3.01.06 |
| `reserve() == toWei(balanceOf(reserveManager))` | `ReserveManager.reserve()` | T.3.01.07 |
| `balanceOf(poolController) == poolState.pool()` | `PoolController` (transfer в/из pool) | T.3.01.08 |
| `treasury_balance` монотонно неубывающий | `sellTeamFee` только добавляет в treasury | T.3.01.09 |
| `balanceOf(poolController) == 0` между tx | `sweep-dust` (шаг 14b) | T.3.01.08 |
| `reserve >= R(S_curve)` после любой операции | доказательство в E.1.01.06 | T.3.01.01 |
| `sellTeamFee` не нарушает `reserve` | доказательство в E.1.01.06 (rev 4) | T.5.01.21 |

При аудите — **в первую очередь** проверять эти инварианты на регрессию.

---

## История аудитов

| Дата | Аудитор | Отчёт | Critical | High | Medium | Low |
|---|---|---|---:|---:|---:|---:|
| — | — | не проведён | — | — | — | — |

После аудита — публикуется в `legal/audit-report.pdf` и в этом разделе.

---

## Известные ограничения

1. **`MathLib.abs(int256.min)`** — не защищён от `type(int256).min` (`-x` переполнит). Не
   используется в протоколе, но помечено в audit-checklist.

2. **`CurveMath.deltaSForBuy` — бинарный поиск**, а не аналитическое решение. Для типовых
   параметров работает детерминированно (floor), но при экстремальных `X` (близко к `S_end_last`)
   может возвращать `ΔS` на границе. Покрыто invariant-тестом T.3.01.01.

3. **`poolPrice` не проверяется `> 0` в `setPoolPrice`** — по спецификации это ответственность
   контроллеров. Если governance-параметр или баг контроллера передаст 0, торговля остановится
   (`NotInitialized`). Мониторинг `PoolPriceUpdated(_, 0)` — alert (O.1.01.02).

4. **`CircuitBreaker.active()` при `reserve == 0`** возвращает `false`. Это по дизайну: «нет
   резерва — нет торговли» уже покрыто `NotInitialized` (poolPrice == 0). Не путать с
   «безопасным состоянием».

5. **`sellTeamFee` — protocol revenue**, не распределяется между держателями XRT. Это влияет
   на юридическую квалификацию (см. `legal/token-classification.md`, L.1.01.03) — специально
   вынесено в отдельный раздел там.

---

## Контакты

- **Security:** `security@xartia.example`
- **Conduct:** `conduct@xartia.example`
- **General:** GitHub Issues
- **Legal:** `legal@xartia.example`