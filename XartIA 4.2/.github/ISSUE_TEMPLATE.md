---
name: Bug report
about: Report a reproducible issue with XartIA
title: "[Bug] <short description>"
labels: ["bug", "triage"]
assignees: []
---

## Описание

<Кратко: что происходит, что ожидалось. 1–3 предложения.>

---

## Шаги воспроизведения

1. <Конкретное действие 1: команда, вызов, клик>
2. <Конкретное действие 2>
3. <...>

**Минимальный воспроизводимый пример:**

```solidity
// Foundry test (если применимо)
function test_reproduce() public {
    // ...
}
или

bash
# Команда
forge test --match-test test_xxx -vvv
Ожидаемое поведение
<Что должно было произойти.>

Фактическое поведение
<Что происходит на самом деле. Логи, revert-сообщения, gas usage.>

text
// Текст ошибки / лог / revert
Контекст
Компонент: <contracts | scripts | tests | dApp | docs | ops>

Контракт/файл: contracts/.../X.sol (если применимо)

Блок спецификации: C.3.01.01 (если применимо)

Версия / коммит: <git rev-parse --short HEAD>

Сеть: <amoy | polygon | local>

Foundry: <forge --version>

Solidity: <solc --version>

Severity (ваша оценка)
□ critical — потеря средств, кража, блокировка протокола
□ high — нарушение инварианта, DoS
□ medium — некорректное поведение без потери средств
□ low — UX, документация, minor
□ trivial — опечатка, стиль
Для уязвимостей безопасности — НЕ создавайте публичный Issue.
Используйте SECURITY.md (security@xartia.example).

Дополнительно
□ Я проверил docs/registry/faq.md (R.3.01.06)
□ Я проверил docs/tech/known-issues (R.2.01.11)
□ Я проверил открытые Issues (не дубликат)
□ Я могу воспроизвести баг стабильно
□ Я могу помочь с исправлением (PR)
Скриншоты / логи
<Приложить, если применимо. Не прикладывать приватные ключи, seed phrases, персональные данные.>

text

---

## `.github/PULL_REQUEST_TEMPLATE.md` (I.1.01.05)

```markdown
## Описание

<Кратко: что меняется, зачем, ссылка на Issue.>

**Связанный Issue:** Closes #`<number>`
**Тип изменения:** `<feature | fix | refactor | docs | test | chore | security>`

---

## Мотивация

<Почему это изменение необходимо? Какую проблему решает? Какие альтернативы
рассматривались?>

---

## Что изменилось

- <Изменение 1: файл, функция>
- <Изменение 2>
- <...>

**Затронутые блоки спецификации:** `<C.3.01.01>`, `<R.2.01.08>`, ...

---

## Чеклист автора

### Код

- [ ] `forge build --sizes` проходит (нет EIP-170 violations)
- [ ] `forge test` проходит локально
- [ ] `forge coverage` ≥ 95%
- [ ] Нет `console.log` / `console2.log` в production-коде
- [ ] NatSpec для всех новых `external`/`public` функций
- [ ] Нет `tx.origin`
- [ ] Нет `delegatecall` без обоснования
- [ ] `unchecked`-блоки с обоснованием
- [ ] Нет magic numbers (использовать `Constants.sol`)
- [ ] Нет magic strings для ролей (использовать `Roles.sol`)
- [ ] Кастомные ошибки из `Errors.sol`

### Тесты

- [ ] Unit-тест для каждой новой функции
- [ ] Unit-тест для каждой новой ветки
- [ ] Тест на revert (граничные случаи)
- [ ] Fuzz-тест (если применимо)
- [ ] Invariant-тест (если новый инвариант)
- [ ] Crash-тест (если новый вектор атаки)
- [ ] Gas-тест (если новая функция в hot path)
- [ ] `test_constructor_sets_*` (если новое immutable-поле)

### Документация

- [ ] `docs/tech/contracts.md` (R.2.01.03) обновлён
- [ ] `docs/tech/events.md` (R.2.01.04) обновлён (если новое событие)
- [ ] `docs/tech/api.md` / `api-reference.md` (R.2.01.02 / R.2.01.07) обновлены
- [ ] `docs/tech/security-model.md` (R.2.01.08) обновлён (если новая митигация)
- [ ] `docs/tech/threat-model.md` (R.2.01.09) обновлён (если новый вектор)
- [ ] `docs/tech/audit-checklist.md` (R.2.01.11) обновлён
- [ ] `docs/registry/glossary.md` (R.3.01.02) обновлён (если новый термин)
- [ ] `CHANGELOG.md` (I.2.01.05) — добавлена запись

### Governance-параметр (если применимо)

- [ ] `bytes32 PARAM_*` добавлен в `Constants.sol`
- [ ] Сеттер с `onlyRole(GOVERNANCE_ROLE)` и bounds
- [ ] `register()` в `Factory.registerParams`
- [ ] Событие `*Updated` в `Events.sol`
- [ ] Геттер (если публичный)
- [ ] Тест в `T.5.01.17 RegisterParams`
- [ ] `T.1.01.19 ParameterRegistry` обновлён
- [ ] `docs/tech/integration-guide.md` (R.2.01.06) обновлён

### Immutable-поле (если применимо)

- [ ] Валидация в конструкторе (`!= address(0)`, `code.length > 0`)
- [ ] Геттер в контракте и интерфейсе
- [ ] Передача в `Factory.deploy` (если создаётся через Factory)
- [ ] Тест `test_constructor_sets_<field>`
- [ ] ABI-файлы обновлены (`web/dapp/abi/*.json`)

### Событие (если применимо)

- [ ] Объявлено в `Events.sol`
- [ ] Эмиссия в контракте
- [ ] `docs/tech/events.md` обновлён
- [ ] `ops/indexer/subgraph.yaml` обновлён
- [ ] `ops/indexer/subgraph.ts` — handler
- [ ] `ops/indexer/schema.graphql` — сущность
- [ ] Тест `test_event_<name>`

### Интерфейс (если изменился `I*`)

- [ ] Реализация обновлена (`override`)
- [ ] Моки (`test/utils/*Mock*`) обновлены
- [ ] ABI-файлы регенерированы (`forge inspect <C> abi`)
- [ ] `docs/tech/api.md` / `api-reference.md` обновлены
- [ ] Frontend (`web/dapp/app.js`) обновлён

### Безопасность

- [ ] Reentrancy: все trade-функции — `nonReentrant`
- [ ] Access control: `onlyRole` / `onlyOwner` / `onlySafe`
- [ ] Overflow: Solidity 0.8.24 checked; `unchecked` — с обоснованием
- [ ] Pull vs push: USDC тянется (`safeTransferFrom`), не пушится
- [ ] Approve: `forceApprove` + сброс в 0
- [ ] `msg.sender` vs `tx.origin`: `tx.origin` запрещён
- [ ] `call` / `delegatecall`: только с обоснованием и тестом
- [ ] Инварианты: `reserve ≥ R(S)`, `totalSupply == S_curve`, `poolPrice` в коридоре — не нарушены
- [ ] `treasury` не получает ролей
- [ ] `Factory` не оставляет ролей после `finalize`

### CI

- [ ] `forge fmt` (без diff)
- [ ] `npx prettier --check` (без diff)
- [ ] `npx solhint` (без errors)
- [ ] `slither` (без high-severity)
- [ ] CI зелёный

---

## Чеклист ревьюера

- [ ] Прочитал **всю** диффу (не только `+`-строки)
- [ ] Проверил соответствие спецификации (`C.*`, `T.*`)
- [ ] Проверил тесты: покрытие новой ветки, граничные случаи
- [ ] Проверил инварианты: не нарушены ли `reserve ≥ curveBacking`, `totalSupply == S_curve`, `poolPrice` в коридоре
- [ ] Проверил безопасность: reentrancy, access control, overflow, pull-модель, approve
- [ ] Проверил документацию: NatSpec, `docs/*` синхронизированы
- [ ] Проверил, что CI зелёный
- [ ] Approve или оставил конструктивные комментарии

---

## Скриншоты / логи (если применимо)

<Только для UI-изменений или сложных случаев.>