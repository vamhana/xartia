# Price Function P(S) — спецификация

**Блок:** E.1.01.01
**Зависимости:** —
**Потребители:** E.1.01.02 (integral), E.1.01.04 (delta solver), C.2.01.01 (CurveMath), C.2.01.02 (LevelMath), R.1.01.01 (spec)

---

## 1. Определение

Цена токена XRT в точке предложения `S` определяется кусочно-линейной функцией
`P: [0, S_end_last] → ℝ⁺`:
P_i(S) = P_start_i + (P_end_i − P_start_i) · (S − S_start_i) / (S_end_i − S_start_i)

text

для `S ∈ [S_start_i, S_end_i)`, `i = 0..n-1`, где `n` — число уровней, `n ≤ MAX_LEVELS = 10`.

Здесь:

| Символ | Единица | Смысл |
|---|---|---|
| `S` | 18-dec XRT (`1e18 = 1 XRT`) | текущее предложение (эмитированные токены) |
| `P(S)` | 18-dec USDC per XRT (`1e18 = 1 USDC/XRT`) | текущая цена |
| `P_start_i` | 18-dec USDC/XRT | цена в начале уровня `i` |
| `P_end_i` | 18-dec USDC/XRT | цена в конце уровня `i` |
| `S_start_i` | 18-dec XRT | граница начала уровня `i` |
| `S_end_i` | 18-dec XRT | граница конца уровня `i` |

**Пример:** `P_start = 2e15`, что означает `2e15 / 1e18 = 0.002 USDC/XRT`.

---

## 2. Свойства

### 2.1. Монотонность

`P(S)` **неубывающая** на всей области определения: для `S₁ < S₂` выполняется `P(S₁) ≤ P(S₂)`.

Доказательство: на каждом уровне `P_end_i ≥ P_start_i` (проверяется в `Levels.init()`, см. C.2.01.09),
следовательно `P_i` линейно неубывающая на уровне. Между уровнями `P_end_i == P_start_{i+1}`
(тоже проверяется в `Levels.init()`), следовательно монотонность сохраняется на границах.

**Имплементация:** `Levels.init` ревертит с `InvalidLevel`, если `P_end_i < P_start_i` или
`P_end_i != P_start_{i+1}`.

### 2.2. Непрерывность

`P(S)` **непрерывна** на `[0, S_end_last]`.

Доказательство: на границе `S = S_end_i = S_start_{i+1}`:
- слева: `lim_{S → S_end_i⁻} P_i(S) = P_end_i`
- справа: `lim_{S → S_start_{i+1}⁺} P_{i+1}(S) = P_start_{i+1}`
- условие непрерывности `P_end_i = P_start_{i+1}` обеспечивается в `Levels.init()`.

**Имплементация:** `CurveMath.P(S, levels)` для `S == S_end_i` возвращает `P_start_{i+1}` (полуинтервал
`[S_start_i, S_end_i)` — граница относится к следующему уровню). Значение непрерывно, но `getLevel`
возвращает `i+1`, что важно для `maxBalance` проверки в контроллерах.

### 2.3. Границы

- `P(0) = P_start_0 > 0` — цена в genesis.
- `P(S_end_last) = P_end_last` — конечная цена.
- Для `S > S_end_last` — не определена (`OutOfBounds`).

**Имплементация:** `CurveMath._getLevelIndex` ревертит `InvalidLevel` при пустом массиве уровней;
для `S > S_end_last` возвращает `n-1` (последний уровень), `LevelMath.P_i` клампит `S` к `S_end_last`.
Однако `CurveMath.R(S)` для `S > S_end_last` ревертит `OutOfBounds` — важно для инварианта.

---

## 3. Табличная форма

Полная таблица — `E.1.01.03 levels_table.md`. Для `config/levels.json` (default):

| Уровень `i` | `S_start` | `S_end` | `P_start` | `P_end` | `maxBalance` |
|---|---:|---:|---:|---:|---:|
| 0 | 0 | 50 000 XRT | 0.002 USDC | 0.002 USDC | 50 000 XRT |
| 1 | 50 000 XRT | 250 000 XRT | 0.002 USDC | 0.004 USDC | 250 000 XRT |
| 2 | 250 000 XRT | 1 250 000 XRT | 0.004 USDC | 0.008 USDC | 1 250 000 XRT |

В 18-dec:

| Уровень | `S_start` | `S_end` | `P_start` | `P_end` | `maxBalance` |
|---|---:|---:|---:|---:|---:|
| 0 | 0 | `50_000e18` | `2e15` | `2e15` | `50_000e18` |
| 1 | `50_000e18` | `250_000e18` | `2e15` | `4e15` | `250_000e18` |
| 2 | `250_000e18` | `1_250_000e18` | `4e15` | `8e15` | `1_250_000e18` |

---

## 4. Примеры

### Пример 1: значение в начале

`S = 0`, уровень 0 → `P(0) = P_start_0 = 2e15` (0.002 USDC/XRT).

### Пример 2: середина уровня 1

`S = 150_000e18`, уровень 1, `D = S_end_1 − S_start_1 = 200_000e18`, `d = S − S_start_1 = 100_000e18`:
P_1(150_000e18) = 2e15 + (4e15 − 2e15) · 100_000e18 / 200_000e18
= 2e15 + 2e15 · 0.5
= 3e15 (= 0.003 USDC/XRT)

text

### Пример 3: граница уровня

`S = 50_000e18 = S_end_0 = S_start_1`:

- `getLevel(50_000e18) = 1` (полуинтервал)
- `P(50_000e18) = P_start_1 = 2e15`
- `P(50_000e18 − 1) = P_end_0 = 2e15` (та же цена, непрерывность)

### Пример 4: конец последнего уровня

`S = 1_250_000e18 = S_end_2` → `P(1_250_000e18) = P_end_2 = 8e15` (0.008 USDC/XRT).

### Пример 5: `S > S_end_last`

`S = 2_000_000e18 > 1_250_000e18` → `CurveMath.R` ревертит `OutOfBounds`.
`CurveMath.P` возвращает `P_end_2 = 8e15` (клампится).

---

## 5. Граничные случаи и edge cases

### 5.1. `S == 0`

`P(0) = P_start_0 > 0` (проверяется в `CurveMath.P`: `Levels` не допускает `P_start = 0`,
но `_checkP_S0 > 0` явно в `Factory.initializePoolPrice`).

`Factory.initializePoolPrice` ревертит `InvalidParam`, если `P(0) == 0`.

### 5.2. `S_end_i == S_start_i` (пустой уровень)

`Levels.init` ревертит `InvalidLevel` — `S_end > S_start` требуется.

### 5.3. `P_start == P_end` (плоский уровень)

`P_i(S) = P_start` — постоянная цена. Default `L0` использует плоский уровень
`P = 2e15`. Это упрощает `R_i(S) = P_start · d / 1e18`.

### 5.4. `n = 0` (нет уровней)

`CurveMath.P(S, [])` ревертит `InvalidLevel`. `Factory.initializeLevels` требует `n ∈ [1, MAX_LEVELS]`.

### 5.5. `n > MAX_LEVELS`

`Levels.init` ревертит `InvalidLevel`. `MAX_LEVELS = 10`.

---

## 6. Имплементация

| Файл | Функция | Описание |
|---|---|---|
| `contracts/math/LevelMath.sol` | `P_i(S, level)` | формула для одного уровня |
| `contracts/math/CurveMath.sol` | `P(S, levels)` | поиск уровня + делегирование в `P_i` |
| `contracts/math/CurveMath.sol` | `getLevel(S, levels)` | индекс уровня (полуинтервал) |
| `contracts/math/CurveMathWrapper.sol` | `P`, `getLevel` | external обёртка для кросс-проверки |

`P_i`:
```solidity
function P_i(uint256 S, Types.Level memory level) internal pure returns (uint256) {
    uint256 D = level.S_end - level.S_start;
    if (D == 0) return level.P_start;
    if (S <= level.S_start) return level.P_start;
    if (S >= level.S_end) return level.P_end;
    uint256 d = S - level.S_start;
    return level.P_start + MathLib.mulDiv(level.P_end - level.P_start, d, D);
}
getLevel:

solidity
function _getLevelIndex(uint256 S, Types.Level[] memory levels) private pure returns (uint256) {
    uint256 n = levels.length;
    if (n == 0) revert Errors.InvalidLevel();
    for (uint256 i = 0; i < n; i++) {
        if (S < levels[i].S_end) return i;
    }
    return n - 1;
}
7. Тесты
Файл	Что проверяет
test/unit/LevelMath.t.sol::test_P_i_at_start, test_P_i_at_end, test_P_i_mid	значения P_i на границах и в середине
test/unit/CurveMath.t.sol::test_P_at_zero, test_P_at_level_boundaries, test_P_mid_level	значения P на уровнях
test/fuzz/FuzzLevels.t.sol::testFuzz_boundaries	монотонность P(S)
test/integration/LevelTransition.t.sol	непрерывность на границах
test/invariant/InvariantLevels.t.sol	|P(S_end_i) − P(S_start_{i+1})| < ε
8. Ссылки
E.1.01.02 — интеграл R(S) = ∫P

E.1.01.03 — таблица уровней

E.1.01.04 — решение R(S+ΔS) − R(S) = X для ΔS

R.1.01.01 — спецификация контрактов (раздел «Математика»)

C.2.01.01 — CurveMath

C.2.01.02 — LevelMath

C.2.01.09 — Levels (иммутабельность, проверки при init)

text

---

## `e/01_core/integral_function.md` (E.1.01.02)

```markdown
# Integral Function R(S) — спецификация

**Блок:** E.1.01.02
**Зависимости:** E.1.01.01 (P(S))
**Потребители:** E.1.01.04 (delta solver), E.1.01.06 (invariant proof), C.2.01.01 (CurveMath), C.4.01.01 (ReserveManager)

---

## 1. Определение

`R(S)` — определённый интеграл цены от 0 до `S`:
R(S) = ∫₀ˢ P(u) du

text

Смысл: **минимальный резерв USDC**, необходимый для покрытия всех `S` токенов при
ликвидации по кривой. Если пользователь продаёт `ΔS` токенов, он получает `R(S) − R(S−ΔS)` —
это площадь под кривой на отрезке `[S−ΔS, S]`.

Единицы: `R(S)` — 18-dec USDC. `R(S)` показывает, сколько USDC должно быть в ReserveManager,
чтобы при выкупе всех токенов по кривой хватило средств.

На уровне `i` (для `S ∈ [S_start_i, S_end_i]`):
R_i(S) = ∫_{S_start_i}^{S} P_i(u) du

text

где `P_i(u) = P_start_i + (P_end_i − P_start_i) · (u − S_start_i) / D_i`, `D_i = S_end_i − S_start_i`.

Аналитическое решение:
R_i(S) = P_start_i · d / 1e18 + (P_end_i − P_start_i) · d² / (2 · D_i · 1e18)

text

где `d = S − S_start_i`, множитель `/ 1e18` — из-за 18-dec единиц `P` и `S`.

Общий `R(S)` — сумма по уровням до текущего:
R(S) = Σ_{j < i} R_j(S_end_j) + R_i(S)

text

где `i = getLevel(S)`.

---

## 2. Свойства

### 2.1. `R(0) = 0`

При `S = 0` интеграл от 0 до 0 равен 0. **Имплементация:** `CurveMath.R(0, levels) → 0`.

### 2.2. Монотонность

`R(S)` **строго неубывающая**: `dR/dS = P(S) ≥ 0`. При `P(S) > 0` — строго возрастает.

Для `S₁ < S₂`: `R(S₂) − R(S₁) = ∫_{S₁}^{S₂} P(u) du > 0`, если `P > 0` на `(S₁, S₂)`.

**Имплементация:** покрыто `test/fuzz/FuzzLevels.t.sol::testFuzz_R_monotonic`.

### 2.3. Непрерывность

`R(S)` непрерывна на `[0, S_end_last]` как интеграл непрерывной `P(S)`.

На границе `S = S_end_i`: `R_i(S_end_i) = площадь трапеции = (P_start_i + P_end_i)/2 · D_i / 1e18`,
что совпадает с `R_{i+1}(S_start_{i+1}) = 0`, поэтому сумма непрерывна.

### 2.4. Границы

- `R(S) = 0` при `S = 0`
- `R(S_end_last) = Σ_i (P_start_i + P_end_i)/2 · D_i / 1e18` — полная площадь
- `S > S_end_last` → **revert `OutOfBounds`** (явная защита от выхода за пределы)

Для `config/levels.json`:

| Уровень | `S_end` | `P_start` | `P_end` | Площадь уровня |
|---|---:|---:|---:|---:|
| 0 | 50 000 XRT | 0.002 | 0.002 | `50_000e18 · 2e15 / 1e18 = 100e18` USDC |
| 1 | 250 000 XRT | 0.002 | 0.004 | `200_000e18 · 3e15 / 1e18 = 600e18` USDC |
| 2 | 1 250 000 XRT | 0.004 | 0.008 | `1_000_000e18 · 6e15 / 1e18 = 6_000e18` USDC |

`R(1_250_000e18) = 100e18 + 600e18 + 6_000e18 = 6_700e18` USDC = 6 700 USDC.

---

## 3. Примеры

### Пример 1: `R(0) = 0`

Тривиально.

### Пример 2: `R(50_000e18)` (граница L0/L1)

Уровень 0 (плоский, `P = 2e15`):
`R_0(50_000e18) = 2e15 · 50_000e18 / 1e18 = 100e18` USDC.

### Пример 3: `R(150_000e18)` (середина L1)

`R(150_000e18) = R_0(S_end_0) + R_1(150_000e18)`:

- `R_0(S_end_0) = 100e18`
- Уровень 1: `d = 100_000e18`, `D = 200_000e18`, `P_start = 2e15`, `P_end = 4e15`
- `linearPart = 2e15 · 100_000e18 / 1e18 = 200e18`
- `quadPart = 2e15 · (100_000e18)² / (2 · 200_000e18 · 1e18) = 2e15 · 1e40 / (4e23 · 1e18) = 50e18`
- `R_1(150_000e18) = 200e18 + 50e18 = 250e18`
- **Итого: `R(150_000e18) = 100e18 + 250e18 = 350e18` USDC**

### Пример 4: `R(S_end_last)` (полная площадь)

`R(1_250_000e18) = 6_700e18` USDC (см. таблицу выше).

### Пример 5: `S > S_end_last`

`R(2_000_000e18)` → `OutOfBounds`. Это **не** клампится до `R(S_end_last)` — важно для
`ReserveManager.updateScurve`, чтобы не допустить `S_curve > S_end_last`.

### Пример 6: `R` на плоском уровне

Уровень 0 плоский (`P_start == P_end`): `quadPart = 0`, `R_0(S) = P_start · d / 1e18`.
Простая линейная формула.

---

## 4. Имплементация

`LevelMath.R_i`:
```solidity
function R_i(uint256 S, Types.Level memory level) internal pure returns (uint256) {
    uint256 D = level.S_end - level.S_start;
    if (D == 0) return 0;
    if (S <= level.S_start) return 0;
    uint256 capped = S > level.S_end ? level.S_end : S;
    uint256 d = capped - level.S_start;

    uint256 linearPart = MathLib.mulDiv(level.P_start, d, SCALE);
    uint256 quadPart   = MathLib.mulDiv(level.P_end - level.P_start, d * d, 2 * D * SCALE);
    return linearPart + quadPart;
}
CurveMath.R:

solidity
function R(uint256 S, Types.Level[] memory levels) internal pure returns (uint256) {
    uint256 n = levels.length;
    if (n == 0) revert Errors.InvalidLevel();
    if (S == 0) return 0;
    if (S > levels[n - 1].S_end) revert Errors.OutOfBounds();

    uint256 acc = 0;
    for (uint256 i = 0; i < n; i++) {
        uint256 sStart = levels[i].S_start;
        uint256 sEnd   = levels[i].S_end;
        if (S <= sStart) break;
        if (S >= sEnd) {
            acc += LevelMath.R_i(sEnd, levels[i]);
        } else {
            acc += LevelMath.R_i(S, levels[i]);
            break;
        }
    }
    return acc;
}
Точность. d * d может достигать (1_250_000e18)² = 1.5625e45, что в uint256 (max ≈ 1.15e77)
влезает с запасом. MathLib.mulDiv использует 512-bit промежуточное значение — overflow невозможен.

Nesting. На границе S == S_end_i цикл добавляет R_i(S_end_i) (полная площадь) и
переходит к i+1. Для S == S_start_{i+1} следующий уровень даёт R_{i+1}(S_start_{i+1}) = 0.
Итого: непрерывность сохраняется.

5. Связь с ReserveManager
ReserveManager.curveBacking() = CurveMath.R(S_curve_stored, levels.all()).

Инвариант: reserve() ≥ curveBacking(). Доказательство — E.1.01.06 invariant_proof.md.

ReserveManager.updateScurve(newS):

S_curve_stored = newS

require(reserve() >= curveBacking()) — иначе ReserveInvariantViolation

freeReserve() = max(0, reserve() − curveBacking()). Покрыто T.3.01.04 InvariantFreeReserve.

6. Тесты
Файл	Что проверяет
test/unit/LevelMath.t.sol::test_R_i_*	значения R_i на границах и в середине
test/unit/CurveMath.t.sol::test_R_*	R(0), R(S_end_i), R(S_end_last), revert на S > S_end_last
test/fuzz/FuzzLevels.t.sol::testFuzz_R_monotonic	монотонность
test/invariant/InvariantReserve.t.sol	reserve ≥ R(S_curve)
test/invariant/InvariantFreeReserve.t.sol	freeReserve + curveBacking == reserve
7. Ссылки
E.1.01.01 — P(S)

E.1.01.03 — таблица уровней (значения R(S_end_i) для default)

E.1.01.04 — решение R(S+ΔS) − R(S) = X для ΔS

E.1.01.06 — доказательство reserve ≥ R(S_curve)

C.2.01.01 — CurveMath

C.4.01.01 — ReserveManager.curveBacking()

text

---

## `e/01_core/levels_table.md` (E.1.01.03)

```markdown
# Levels Table — спецификация

**Блок:** E.1.01.03
**Зависимости:** E.1.01.02 (integral)
**Потребители:** C.2.01.09 (Levels), C.8.01.01 (Factory.initializeLevels), D.2.01.01 (config)

---

## 1. Определение

`Levels` — иммутабельная таблица уровней bonding curve. Хранит `n` записей
`struct Level { uint256 S_start; uint256 S_end; uint256 P_start; uint256 P_end; uint256 maxBalance; }`,
где `n ≤ MAX_LEVELS = 10`.

Инициализируется один раз через `Levels.init(Level[] memory newLevels)` — `onlyOwner`
(владелец при деплое — `XartIAFactory`; после `finalize` — `safe`). Повторный `init` → `AlreadyInitialized`.

---

## 2. Инварианты таблицы

`Levels.init` проверяет:

1. `n > 0` и `n ≤ MAX_LEVELS` (10)
2. `S_end_i > S_start_i` для всех `i`
3. `P_end_i ≥ P_start_i` для всех `i`
4. Непрерывность: для `i > 0` `S_start_i == S_end_{i-1}` и `P_start_i == P_end_{i-1}`

Нарушение любого условия → `InvalidLevel`.

**Дополнительные проверки** (не в спеке 4.2, но в нашей имплементации):
- `P_start_0 > 0` — иначе `initializePoolPrice` ревертит `InvalidParam` из-за `P(S_0) == 0`.

---

## 3. Default-таблица (`config/levels.json`)

```json
{
  "count": 3,
  "levels": [
    {
      "S_start": "0",
      "S_end": "50000000000000000000000",
      "P_start": "2000000000000000",
      "P_end": "2000000000000000",
      "maxBalance": "50000000000000000000000"
    },
    {
      "S_start": "50000000000000000000000",
      "S_end": "250000000000000000000000",
      "P_start": "2000000000000000",
      "P_end": "4000000000000000",
      "maxBalance": "250000000000000000000000"
    },
    {
      "S_start": "250000000000000000000000",
      "S_end": "1250000000000000000000000",
      "P_start": "4000000000000000",
      "P_end": "8000000000000000",
      "maxBalance": "1250000000000000000000000"
    }
  ]
}
В человеческих единицах
Уровень i	S_start	S_end	P_start	P_end	maxBalance	R(S_end_i) − R(S_start_i)
0	0	50 000 XRT	0.002 USDC/XRT	0.002 USDC/XRT	50 000 XRT	100 USDC
1	50 000 XRT	250 000 XRT	0.002 USDC/XRT	0.004 USDC/XRT	250 000 XRT	600 USDC
2	250 000 XRT	1 250 000 XRT	0.004 USDC/XRT	0.008 USDC/XRT	1 250 000 XRT	6 000 USDC
В 18-dec
Уровень i	S_start	S_end	P_start	P_end	maxBalance
0	0	50_000e18	2e15	2e15	50_000e18
1	50_000e18	250_000e18	2e15	4e15	250_000e18
2	250_000e18	1_250_000e18	4e15	8e15	1_250_000e18
4. Функции уровней
4.1. P_i(S) (см. E.1.01.01)
L0: P_0(S) = 2e15 (плоский)

L1: P_1(S) = 2e15 + 2e15 · (S − 50_000e18) / 200_000e18

L2: P_2(S) = 4e15 + 4e15 · (S − 250_000e18) / 1_000_000e18

4.2. R_i(S) (см. E.1.01.02)
L0: R_0(S) = 2e15 · d / 1e18 (линейно)

L1: R_1(S) = 2e15 · d / 1e18 + 2e15 · d² / (2 · 200_000e18 · 1e18)

L2: R_2(S) = 4e15 · d / 1e18 + 4e15 · d² / (2 · 1_000_000e18 · 1e18)

4.3. Накопленный R(S_end_i)
R(S_end_0) = R(50_000e18) = 100e18 USDC

R(S_end_1) = R(250_000e18) = 100e18 + 600e18 = 700e18 USDC

R(S_end_2) = R(1_250_000e18) = 100e18 + 600e18 + 6_000e18 = 6_700e18 USDC

5. maxBalance
maxBalance_i — максимальный баланс одного пользователя, когда S_curve в границах уровня i.

Семантика проверки в контракте (C.3.01.01 шаг 13, C.3.01.02 шаг 10):

После покупки вычисляется level_new = getLevel(newS) (по финальному S)

Проверка: balanceOf(buyer) + ΔS − teamTokens ≤ maxBalance_{level_new}

Проверяется только maxBalance финального уровня, не промежуточных

Пример: покупка с S = 30_000e18 до S = 60_000e18 (переход L0 → L1):

level_old = 0, level_new = 1

Проверка по maxBalance_1 = 250_000e18, не по maxBalance_0 = 50_000e18

Покупка до 60 000 XRT (при балансе пользователя < 250 000) — проходит

Рациональность maxBalance_i = S_end_i
В default-таблице maxBalance_i = S_end_i — один пользователь не может удерживать больше, чем
весь supply уровня. Это не жёсткое ограничение (пользователь может иметь 60k XRT при S_end_1 = 250k),
но защищает от доминирования на ранних уровнях.

Можно изменить через config/levels.json при деплое — Levels иммутабельны после init.

6. Примеры
Пример 1: getLevel(0) = 0
0 < S_end_0 = 50_000e18 → уровень 0.

Пример 2: getLevel(50_000e18) = 1
Полуинтервал: 50_000e18 = S_end_0, но < S_end_1 = 250_000e18 → уровень 1.

Пример 3: getLevel(1_250_000e18) = 2
1_250_000e18 = S_end_2, < S_end_2 + 1? Нет — это S_end_2, но в цикле S < levels[i].S_end
условие ложно, поэтому возвращается n-1 = 2.

Важно: getLevel на границе последнего уровня возвращает n-1, не revert. Это для
поддержки maxBalance проверки при покупке точно на S_end_last.

Пример 4: getBounds(i)
getBounds(0) = (0, 50_000e18)

getBounds(1) = (50_000e18, 250_000e18)

getBounds(2) = (250_000e18, 1_250_000e18)

getBounds(3) → OutOfBounds

Пример 5: getMaxBalance(i)
getMaxBalance(0) = 50_000e18

getMaxBalance(1) = 250_000e18

getMaxBalance(2) = 1_250_000e18

7. Иммутабельность
После init():

_levels в storage не меняется

Нет admin-функции для изменения уровней

transferOwnership не даёт права на изменение

Обновление таблицы возможно только через деплой новой системы + миграция.
См. ops/upgrade-guide.md (O.3.01.03).

Это осознанное решение: изменение уровней в работающей системе нарушило бы все инварианты
(reserve ≥ curveBacking, poolPrice в коридоре) без возможности корректно пересчитать состояние.

8. Имплементация
contracts/math/Levels.sol:

_levels — Types.Level[] в storage

_initialized — bool

init(newLevels) — onlyOwner, проверки, push

getLevel(S), getBounds(i), getMaxBalance(i), all(), length()

contracts/math/ILevels.sol — интерфейс (C.2.01.10).

9. Тесты
Файл	Что проверяет
test/unit/Levels.t.sol::test_init, test_reinit_revert	инициализация
test/unit/Levels.t.sol::test_getLevel, test_getBounds, test_getMaxBalance	геттеры
test/unit/Levels.t.sol::test_init_revert_*	все проверки init (empty, too many, zero end, negative slope, discontinuous S/P)
test/fuzz/FuzzLevels.t.sol::testFuzz_getLevel	getLevel соответствует границам
test/invariant/InvariantLevels.t.sol	непрерывность P на границах
10. Ссылки
E.1.01.01 — P(S)

E.1.01.02 — R(S)

C.2.01.09 — Levels

C.2.01.10 — ILevels

C.8.01.01 — XartIAFactory.initializeLevels

D.2.01.01 — config/polygon.toml

D.2.01.02 — config/amoy.toml

config/levels.json — default таблица

text

---

## `e/01_core/delta_s_solver.md` (E.1.01.04)

```markdown
# Delta S Solver — спецификация

**Блок:** E.1.01.04
**Зависимости:** E.1.01.02 (integral)
**Потребители:** C.2.01.01 (CurveMath.deltaSForBuy), C.3.01.01 (CurveController.buyFromCurve)

---

## 1. Постановка задачи

Дано:
- `S` — текущее предложение (18-dec XRT)
- `X` — сумма USDC (18-dec), которую пользователь платит **за вычетом fee** (`X_net`)
- `levels` — таблица уровней

Найти `ΔS ≥ 0` такое, что:
R(S + ΔS) − R(S) = X

text

где `R` — интеграл цены (E.1.01.02).

Смысл: сколько XRT пользователь получит за `X` USDC.

**Контрактная семантика** (`CurveMath.deltaSForBuy`): возвращает `ΔS` с **округлением вниз** —
такой, что `R(S + ΔS) − R(S) ≤ X`. Разница (`X − (R(S+ΔS) − R(S))`) остаётся в резерве
как `freeReserve` (пыль < 1 wei-18 на вызов, но может накапливаться).

Если `X` больше, чем покрывает весь оставшийся supply (`R(S_end_last) − R(S)`), возвращается
`ΔS = S_end_last − S` (максимум возможного).

---

## 2. Аналитическое решение

### 2.1. Один уровень (без пересечения границы)

На уровне `i` с `P_start_i = a`, `P_end_i = b`, `D_i = S_end_i − S_start_i`, `d = S − S_start_i`:
R_i(S + ΔS) − R_i(S) = a · ΔS / 1e18 + (b − a) · ((d + ΔS)² − d²) / (2 · D_i · 1e18)
= a · ΔS / 1e18 + (b − a) · (2d · ΔS + ΔS²) / (2 · D_i · 1e18)

text

Приравниваем к `X`:
(b − a) / (2 · D_i · 1e18) · ΔS² + [a / 1e18 + (b − a) · d / (D_i · 1e18)] · ΔS − X = 0

text

Обозначим:
- `A = (b − a) / (2 · D_i · 1e18)`
- `B = a / 1e18 + (b − a) · d / (D_i · 1e18)`
- `C = −X`

Квадратное уравнение: `A · ΔS² + B · ΔS + C = 0`.

Положительный корень: `ΔS = (−B + √(B² + 4 · A · X)) / (2 · A)` при `A > 0`.

Для плоского уровня (`b == a`, `A = 0`): `ΔS = X · 1e18 / a` (линейное уравнение).

### 2.2. Несколько уровней (пересечение границ)

Если `ΔS` на текущем уровне превышает `S_end_i − S`, происходит переход на следующий уровень.
Итеративно:

1. Вычислить `X_i = R(S_end_i) − R(S)` — сколько нужно USDC до конца текущего уровня.
2. Если `X < X_i`: решение на уровне `i` (см. 2.1). Возврат.
3. Иначе: `X -= X_i`, `S = S_end_i`, `i++`. Переход к шагу 1.
4. Если `S == S_end_last`: возврат `ΔS = S_end_last − S_start_0` (максимум).

---

## 3. Численная стабильность

### 3.1. Overflow в квадратном решении

`B²` может достигать `(P_end · 1e18)² ~ (1e16)² = 1e32` — в `uint256` влезает. Но `4 · A · X`:
- `A ~ (P_end − P_start) / (2D · 1e18)`, для `D = 200_000e18`, `P_end − P_start = 2e15`: `A ~ 2e15 / 4e23 ~ 5e-9`
- `X` может быть до `1e30` (максимальная покупка)
- `4 · A · X ~ 4 · 5e-9 · 1e30 = 2e22` — влезает

Однако **без нормализации** точность падает: при `X` маленьком (например, 1 USDC = `1e18`),
`ΔS` получается как разность двух почти равных чисел `(−B + √(B² + ε))`, и может возникнуть
**catastrophic cancellation** — потеря значащих битов.

### 3.2. Решение — бинарный поиск

Вместо аналитической формулы используется **бинарный поиск** по `ΔS` с upper bound:
upper = ceil(X · 1e18 / P(S))

text

Это максимальный `ΔS`, если бы вся покупка шла по текущей цене. Реальный `ΔS` ≤ `upper`
(цена растёт по кривой, поэтому за `X` получим меньше, чем `X/P(S)`).

Бинарный поиск на `[0, upper]`:
- `lo = 0`, `hi = upper`
- Пока `lo < hi`: `mid = (lo + hi + 1) / 2`; если `R(S + mid) − R(S) ≤ X`, `lo = mid`; иначе `hi = mid - 1`.
- Возврат `lo`.

Инвариант: `R(S + lo) − R(S) ≤ X < R(S + lo + 1) − R(S)`. Это даёт `ΔS` с округлением вниз.

**Сложность:** ~`log2(upper) ≈ 60–80` итераций для типовых параметров. Для `upper = 500e18`
это `~70` итераций. Каждая итерация — 2 вызова `R_i` (один в `S + mid`, один в `S` cached).
Укладывается в газ-лимит `buyFromCurve ≤ 250k` (проверено `T.6.01.01`).

### 3.3. Кросс-уровневое решение

Для многоуровневого случая итерация по уровням:

```solidity
uint256 currentS = S;
uint256 remainingX = X;
uint256 startLevel = _getLevelIndex(S, levels);

for (uint256 i = startLevel; i < n; i++) {
    uint256 sEnd = levels[i].S_end;
    if (currentS >= sEnd) continue;

    uint256 capX = R_i(sEnd, levels[i]) - R_i(currentS, levels[i]);
    if (remainingX < capX) {
        uint256 d = _solveOnLevel(currentS, remainingX, levels[i]);
        return (currentS - S) + d;
    }
    remainingX -= capX;
    currentS = sEnd;
}
return currentS - S; // максимум (S_end_last)
solveOnLevel — бинарный поиск (см. 3.2) с upper = min(X · 1e18 / P_i(currentS), S_end_i − currentS).

4. Граничные случаи
4.1. X = 0
Возврат 0. Имплементация: if (X == 0) return 0; — early return.

4.2. S == S_end_last
capX = 0 для последнего уровня, цикл не выполнится, return currentS - S = 0.
Покупка невозможна (supply исчерпан). ReserveManager.updateScurve ревертит OutOfBounds
при попытке установить S > S_end_last — buyFromCurve с X > 0 при S == S_end_last
фактически ревертит (через updateScurve).

4.3. X больше всего оставшегося supply
ΔS = S_end_last − S. X «излишек» остаётся в резерве — увеличивает freeReserve. Это не ошибка:
пользователь переплатил, но получил максимум. UX-проблема, не безопасность.

Спека рекомендует frontend проверять X ≤ R(S_end_last) − R(S) перед отправкой.

4.4. Плоский уровень (P_start == P_end)
В бинарном поиске pS = P_i(currentS) = P_start, upper = ceil(X · 1e18 / P_start).
Решение точное: ΔS = floor(X · 1e18 / P_start).

4.5. P_i(S) == 0
Ревертит MathOverflow (защита от деления на ноль). P_start > 0 проверяется в Levels.init,
поэтому достижимо только при прямом вызове LevelMath.P_i с P == 0 (тест T.1.01.16).

4.6. ΔS = 0 при X > 0
Возможно, если X меньше, чем R для ΔS = 1. При P ~ 2e15 и ΔS = 1, R_i даёт 2e15/1e18 = 0.002 USDC
на 1 wei XRT. Для X = 1 wei (1e-18 USDC) ΔS = 0. Пользователь ничего не получает.

Имплементация: deltaSForBuy возвращает 0. Контроллер buyFromCurve минтит 0 токенов
(фактически revert из-за _mint(to, 0) — нет, OZ _mint(0) не ревертит; пользователь
платит X, получает 0 токенов). Это известное поведение — minimalPurchase (1 USDC)
защищает от этого.

5. Точность
deltaSForBuy — floor-округление. Это значит:

R(S + ΔS) − R(S) ≤ X (пользователь не переплатил больше, чем на пыль)

R(S + ΔS + 1) − R(S) > X (нельзя получить ещё 1 wei XRT)

Остаток X − (R(S + ΔS) − R(S)) — пыль ≤ P(S + ΔS) / 1e18 wei USDC. Для P ~ 2e15 это
≤ 0.002 USDC — незначимо. Накопление пыли: за N покупок максимум N · 0.002 USDC.
При 1000 покупках — 2 USDC в резерве. Покрыто test_buyFromCurveFor_rounding_invariant_holds
и test_buyFromCurveFor_limit_epsilon_bypass_blocked.

Альтернатива: ceiling-округление (R(S + ΔS) − R(S) ≥ X). Тогда пользователь получает
чуть больше, но резерв уменьшается. Мы выбрали floor — безопаснее для инварианта reserve ≥ R(S).

6. Примеры
Пример 1: простая покупка на плоском уровне
S = 0, X = 1e18 (1 USDC), уровень 0 плоский P = 2e15.

upper = ceil(1e18 · 1e18 / 2e15) = 500e18.

Проверка: R(500e18) = 500e18 · 2e15 / 1e18 = 1e18 = X → ΔS = 500e18 XRT.

Имплементация: возвращает 500e18.

Пример 2: с пересечением уровня
S = 0, X = 200e18 (200 USDC). L0 плоский, S_end_0 = 50_000e18.

capX_0 = R_0(50_000e18) = 100e18 < 200e18. Переход: remainingX = 100e18, currentS = 50_000e18, i = 1.

Уровень 1: P_start = 2e15, P_end = 4e15, D = 200_000e18.

upper = min(100e18 · 1e18 / 2e15, 200_000e18) = min(50_000e18, 200_000e18) = 50_000e18.

Бинарный поиск находит d такой, что R_1(50_000e18 + d) − R_1(50_000e18) ≤ 100e18 и < R_1 + 1.

Приблизительно: d ~ 47_500e18 (R_1 линейно-квадратичная). ΔS = 50_000e18 + 47_500e18 = 97_500e18.

Пример 3: X больше supply
S = 0, X = 10_000e18 (10 000 USDC). R(S_end_last) = 6_700e18 < 10_000e18.

ΔS = S_end_last − 0 = 1_250_000e18. Остаток 3_300e18 USDC остаётся в резерве (увеличивает freeReserve).

Пример 4: X меньше 1 wei
S = 0, X = 1 (1 wei-18 USDC = 1e-18 USDC). upper = ceil(1 · 1e18 / 2e15) = 1.

Проверка: R(1) = 1 · 2e15 / 1e18 = 0.002 wei-18? Нет, R(1) = 2e15 / 1e18 = 0.002 wei-18 USDC.
Это 0 из-за целочисленного деления 2e15 * 1 / 1e18 = 0.

Значит R(1) ≤ 1 (с округлением), ΔS = 1. Но mint(1) — пользователь получит 1 wei XRT.
При minimalPurchase = 1e6 (1 USDC) это невозможно — защита от пыли.

7. Имплементация
contracts/math/CurveMath.sol:

solidity
function deltaSForBuy(uint256 S, uint256 X, Types.Level[] memory levels)
    internal pure returns (uint256)
{
    if (X == 0) return 0;
    uint256 n = levels.length;
    if (n == 0) revert Errors.InvalidLevel();

    uint256 currentS = S;
    uint256 remainingX = X;
    uint256 startLevel = _getLevelIndex(S, levels);

    for (uint256 i = startLevel; i < n; i++) {
        uint256 sEnd = levels[i].S_end;
        if (currentS >= sEnd) continue;

        uint256 capX = LevelMath.R_i(sEnd, levels[i]) - LevelMath.R_i(currentS, levels[i]);
        if (remainingX < capX) {
            uint256 d = _solveOnLevel(currentS, remainingX, levels[i]);
            return (currentS - S) + d;
        }
        remainingX -= capX;
        currentS = sEnd;
    }
    return currentS - S;
}

function _solveOnLevel(uint256 currentS, uint256 X, Types.Level memory level)
    private pure returns (uint256)
{
    uint256 maxD = level.S_end - currentS;
    uint256 pS = LevelMath.P_i(currentS, level);
    if (pS == 0) revert Errors.MathOverflow();

    uint256 upper = MathLib.mulDiv(X, Constants.PRECISION, pS);
    if (upper > maxD) upper = maxD;
    if (upper == 0) return 0;

    uint256 rStart = LevelMath.R_i(currentS, level);
    if (LevelMath.R_i(currentS + upper, level) - rStart <= X) {
        return upper;
    }

    uint256 lo = 0;
    uint256 hi = upper - 1;
    while (lo < hi) {
        uint256 mid = (lo + hi + 1) / 2;
        if (LevelMath.R_i(currentS + mid, level) - rStart <= X) {
            lo = mid;
        } else {
            hi = mid - 1;
        }
    }
    return lo;
}
8. Тесты
Файл	Что проверяет
test/unit/CurveMath.t.sol::test_deltaSForBuy_simple	простая покупка
test/unit/CurveMath.t.sol::test_deltaSForBuy_zero_X	X = 0
test/unit/CurveMath.t.sol::test_deltaSForBuy_exact_to_level_boundary	граница уровня
test/unit/CurveMath.t.sol::test_deltaSForBuy_crosses_level	переход на следующий уровень
test/unit/CurveMath.t.sol::test_deltaSForBuy_never_overshoots	R(S+ΔS) − R(S) ≤ X
test/fuzz/FuzzCurve.t.sol::testFuzz_buy	случайные X
test/invariant/InvariantReserve.t.sol	инвариант после покупок
test/gas/GasBuyCurve.t.sol	газ ≤ 250k
9. Ссылки
E.1.01.01 — P(S)

E.1.01.02 — R(S)

E.1.01.06 — доказательство reserve ≥ R(S)

C.2.01.01 — CurveMath

C.3.01.01 — CurveController.buyFromCurve

test/gas/GasBuyCurve.t.sol — газ-тест

text

---

## `e/01_core/pool_price_formula.md` (E.1.01.05)

```markdown
# Pool Price Formula — спецификация

**Блок:** E.1.01.05
**Зависимости:** E.1.01.02 (integral)
**Потребители:** E.1.01.07 (pool price proof), C.3.01.01 (CurveController), C.3.01.02 (PoolController), C.8.01.01 (Factory)

---

## 1. Определение

`poolPrice` — цена XRT в USDC внутри внутреннего пула `PoolController`. Хранится в `PoolState` в
**18 decimals** (USDC per XRT). Не зависит от `S_curve`; определяется ликвидностью пула и
действиями пользователей.

`poolPrice` всегда ограничен **симметричным коридором** относительно `P(S_curve)`:
P(S) / (1 + MAX_GAP) ≤ poolPrice ≤ P(S) · (1 + MAX_GAP)

text

где `MAX_GAP = 1000 bp = 10% = 0.1`.

Ширина коридора: `[P(S) / 1.1, P(S) · 1.1]`. Для `P = 2e15`: `[1.818e15, 2.2e15]`.

---

## 2. Инициализация

`PoolState.initializePoolPrice(initialPrice_18)` вызывается один раз из `Factory.initializePoolPrice`.

**Требования:**
1. `initialPrice_18 > 0` — иначе `InvalidAmount`
2. `initialPrice_18 ∈ [lower, upper]`, где:
   - `P_S0 = CurveMath.P(0, levels.all())` — цена при `S = 0` (начало кривой)
   - `lower = P_S0 · BASIS_POINTS / (BASIS_POINTS + MAX_GAP) = P_S0 / 1.1`
   - `upper = P_S0 · (BASIS_POINTS + MAX_GAP) / BASIS_POINTS = P_S0 · 1.1`
3. `P_S0 > 0` — иначе `InvalidParam` (проверяется в `Factory.initializePoolPrice`)
4. `S_curve() == 0` — иначе `InvalidParam` (genesis-гейт)

**Пример (default):** `P_S0 = 2e15`, `MAX_GAP = 1000`:
- `lower = 2e15 · 10000 / 11000 ≈ 1.818e15`
- `upper = 2e15 · 11000 / 10000 = 2.2e15`
- `p0_initial_pool_price_6dec = 2000` (0.002 USDC) в `config/amoy.toml` → `initialPrice_18 = 2e15`
- `2e15 ∈ [1.818e15, 2.2e15]` ✓

**Имплементация:** `Factory.initializePoolPrice` (C.8.01.01 шаги 6–9), `PoolState.initializePoolPrice`
(C.2.01.12).

---

## 3. Обновление при `sellToPool`

Пользователь продаёт `ΔP` XRT в пул.

### 3.1. Формула
q_bp = min(ΔP · BASIS_POINTS / max(S_curve, 1), MAX_SOLD_PCT)
mult_bp = BASIS_POINTS + K · q_bp / BASIS_POINTS
newPrice_raw = poolPrice · mult_bp / BASIS_POINTS
ceiling = P(S_curve) · (BASIS_POINTS + MAX_GAP) / BASIS_POINTS
newPrice = min(newPrice_raw, ceiling)

text

где:
- `K = 15_000` (1.5 в bp-форме)
- `MAX_SOLD_PCT = 100` (1%)
- `MAX_GAP = 1000` (10%)

**Смысл:** каждая продажа увеличивает `poolPrice` пропорционально `ΔP / S_curve` (доля от supply)
с множителем `K = 1.5`. Например, продажа 1% supply (`q = 1%`) увеличивает `poolPrice` на `1.5%`.

### 3.2. Верхняя граница (ceiling)

`newPrice ≤ P(S) · (1 + MAX_GAP)`. Обрезает рост `poolPrice` — не даёт превысить коридор
даже при серии продаж.

### 3.3. `q_bp` clamp

`q_bp = min(ΔP · 10000 / max(S, 1), 100)`. Защита:
- При `S_curve = 0` (`max(S, 1) = 1`) — большие `ΔP` дают `q_bp > 100`, clamp до `100` (1%).
  Практически невозможно (`S = 0` → в пуле нет токенов для продажи), но защита от деления на ноль.
- Для `ΔP > 1%` supply — `q_bp = 100`, `mult = 1.015` (максимальный шаг).

**Пример:** `ΔP = 10_000e18`, `S_curve = 500_000e18` → `q_bp = 10000 · 10000 / 500_000 = 200` → clamp до `100`.
`mult = 1 + 1.5 · 100 / 10000 = 1 + 0.015 = 1.015` → `newPrice = poolPrice · 1.015`.

### 3.4. Имплементация

`PoolController.sellToPool` (C.3.01.02, шаги 16–17):

```solidity
Types.Level[] memory levelsArr = ILevels(levels).all();
uint256 pS = CurveMath.P(sCurve, levelsArr);
uint256 q_bp = _min((deltaP * Constants.BASIS_POINTS) / (sCurve > 0 ? sCurve : 1), Constants.MAX_SOLD_PCT);
uint256 mult_bp = Constants.BASIS_POINTS + (Constants.K * q_bp) / Constants.BASIS_POINTS;
uint256 newPrice = (IPoolState(poolState).poolPrice() * mult_bp) / Constants.BASIS_POINTS;
uint256 ceiling = (pS * (Constants.BASIS_POINTS + Constants.MAX_GAP)) / Constants.BASIS_POINTS;
if (newPrice > ceiling) newPrice = ceiling;
IPoolState(poolState).setPoolPrice(newPrice);
4. Обновление при buyFromCurve и buyFromCurveFor
Пользователь покупает на кривой, S_curve растёт, P(S) растёт, поэтому нижняя граница
коридора тоже растёт. Нужно подтянуть poolPrice, если он оказался ниже новой нижней границы.

4.1. Формула
text
newP_S = P(newS)
floor = newP_S · BASIS_POINTS / (BASIS_POINTS + MAX_GAP)
if poolPrice < floor:
    poolPrice = floor
Имплементация: CurveController._enforcePoolPriceFloor (C.3.01.01):

solidity
function _enforcePoolPriceFloor(uint256 newS, Types.Level[] memory levelsArr) internal {
    uint256 pNewS = CurveMath.P(newS, levelsArr);
    uint256 floor = (pNewS * Constants.BASIS_POINTS) / (Constants.BASIS_POINTS + Constants.MAX_GAP);
    uint256 cur = IPoolState(poolState).poolPrice();
    if (cur < floor) IPoolState(poolState).setPoolPrice(floor);
}
Вызывается из buyFromCurve (шаг 21) и buyFromCurveFor (шаг 18).

4.2. Не обрезается по ceiling
Если poolPrice уже был близок к P(oldS) · (1+MAX_GAP), а S растёт, то ceiling = P(newS) · 1.1
тоже растёт. poolPrice не превышает ceiling по построению (все операции, уменьшающие S
или увеличивающие poolPrice, дополнительно проверяют ceiling). Так что floor-enforcement
не может «выпихнуть» poolPrice за ceiling — ceiling растёт быстрее.

Покрыто E.1.01.07 pool_price_proof.md, Утверждение 1.

5. Обновление при redeemFromCurve (defensive)
При redeemFromCurve S_curve уменьшается, P(S) уменьшается. poolPrice может оказаться
выше нового ceiling (если он был близок к P(oldS) · 1.1, а P(newS) < P(oldS)).
Применяются обе границы:

5.1. Формула
text
newP_S = P(newS)
ceiling = newP_S · (BASIS_POINTS + MAX_GAP) / BASIS_POINTS
floor = newP_S · BASIS_POINTS / (BASIS_POINTS + MAX_GAP)
if poolPrice > ceiling:
    poolPrice = ceiling
else if poolPrice < floor:
    poolPrice = floor
Имплементация: CurveController._clampPoolPriceToCorridor (C.3.01.01 шаги 15–15c):

solidity
function _clampPoolPriceToCorridor(uint256 newS, Types.Level[] memory levelsArr) internal {
    uint256 pNewS = CurveMath.P(newS, levelsArr);
    uint256 ceiling = (pNewS * (Constants.BASIS_POINTS + Constants.MAX_GAP)) / Constants.BASIS_POINTS;
    uint256 floor = (pNewS * Constants.BASIS_POINTS) / (Constants.BASIS_POINTS + Constants.MAX_GAP);
    uint256 cur = IPoolState(poolState).poolPrice();
    if (cur > ceiling) {
        IPoolState(poolState).setPoolPrice(ceiling);
    } else if (cur < floor) {
        IPoolState(poolState).setPoolPrice(floor);
    }
}
5.2. Почему defensive
redeemFromCurve не изменяет poolPrice напрямую — оно меняется только через S_curve.
Но poolPrice может быть в ceiling до redeem, а после — превышать новый ceiling. Пример:

S = 500_000e18, P(S) = 3e15, ceiling = 3.3e15, poolPrice = 3.3e15 (на ceiling)

Пользователь продаёт ΔS = 100_000e18, S_new = 400_000e18

P(S_new) = 2.8e15, ceiling_new = 3.08e15

Старый poolPrice = 3.3e15 > 3.08e15 — нужно обрезать до ceiling

Иначе poolPrice вне коридора — нарушение инварианта

Floor в redeemFromCurve — тоже defensive. Если S уменьшилось на много, P(S_new) может
уменьшиться, но floor = P(S_new) / 1.1 уменьшится, так что poolPrice не окажется ниже floor.
Однако если poolPrice был ниже floor до redeem (edge case, например после ручного
vm.store в тестах или бага в контроллере), redeem даст шанс восстановить инвариант.

6. Сводная таблица обновлений
Операция	Что происходит с poolPrice	Формула
initializePoolPrice	задаётся один раз	initialPrice ∈ [P(S_0)/1.1, P(S_0)·1.1]
sellToPool	растёт (пропорционально ΔP/S)	min(poolPrice · (1 + 1.5·q), P(S)·1.1)
buyFromCurve	подтягивается к floor, если ниже	if < P(newS)/1.1 → P(newS)/1.1
buyFromCurveFor	подтягивается к floor, если ниже	if < P(newS)/1.1 → P(newS)/1.1
redeemFromCurve	обрезается по ceiling и floor	if > P(newS)·1.1 → ceiling; if < P(newS)/1.1 → floor
buyFromPool	не меняется (каскад через buyFromCurveFor меняет)	—
7. Примеры
Пример 1: инициализация
P(0) = 2e15, MAX_GAP = 1000 (10%):

lower = 2e15 · 10000/11000 ≈ 1.818e15 (≈ 0.00182 USDC/XRT)

upper = 2e15 · 11000/10000 = 2.2e15 (0.0022 USDC/XRT)

initialPoolPrice = 2e15 — в коридоре ✓

Пример 2: sellToPool
S_curve = 500_000e18, P(S) = 3e15, poolPrice = 3e15, ΔP = 5_000e18.

q_bp = min(5_000 · 10000 / 500_000, 100) = min(100, 100) = 100.
mult_bp = 10000 + 15000 · 100 / 10000 = 10000 + 150 = 10150.
newPrice_raw = 3e15 · 10150 / 10000 = 3.045e15.
ceiling = 3e15 · 11000 / 10000 = 3.3e15.
newPrice = min(3.045e15, 3.3e15) = 3.045e15.

poolPrice вырос на 1.5% (от 3e15 до 3.045e15). Все ещё в коридоре.

Пример 3: sellToPool на ceiling
S_curve = 500_000e18, P(S) = 3e15, poolPrice = 3.29e15, ΔP = 5_000e18.

q_bp = 100, mult_bp = 10150, newPrice_raw = 3.29e15 · 1.015 = 3.33935e15.
ceiling = 3.3e15.
newPrice = min(3.33935e15, 3.3e15) = 3.3e15 — обрезано по ceiling.

Пример 4: buyFromCurve поднимает floor
S_before = 400_000e18, P = 2.8e15, poolPrice = 2.7e15.
buyFromCurve на 100 USDC, ΔS ≈ 35_000e18, S_new = 435_000e18, P_new ≈ 2.87e15.
floor_new = 2.87e15 / 1.1 ≈ 2.609e15.
poolPrice = 2.7e15 > floor_new — floor не применяется (poolPrice уже выше).

Пример 5: buyFromCurve где floor применяется
S_before = 400_000e18, P = 2.8e15, poolPrice = 2.5e15 (близко к floor старого).
buyFromCurve на 1000 USDC, ΔS ≈ 350_000e18, S_new = 750_000e18, P_new ≈ 3.4e15 (на L2).
floor_new = 3.4e15 / 1.1 ≈ 3.09e15.
poolPrice = 2.5e15 < floor_new → применяется floor: poolPrice = 3.09e15.

Пример 6: redeemFromCurve обрезает ceiling
S_before = 500_000e18, P = 3e15, poolPrice = 3.29e15 (на ceiling).
redeemFromCurve на 100_000 XRT, S_new = 400_000e18, P_new = 2.8e15.
ceiling_new = 2.8e15 · 1.1 = 3.08e15.
floor_new = 2.8e15 / 1.1 ≈ 2.545e15.
poolPrice = 3.29e15 > ceiling_new = 3.08e15 → обрезается до 3.08e15.

8. Арбитражные следствия
Коридор ±10% ограничивает арбитраж между кривой и пулом:

Купить в пуле, продать на кривой: buyFromPool (по poolPrice) → redeemFromCurve (по R(S)).
Прибыль возможна, если P(S) > poolPrice. Но poolPrice ≥ P(S)/1.1, поэтому
максимум прибыли — ~10% − buyFee − redeemFee ≈ 10% − 1.1% = 8.9%.

Купить на кривой, продать в пул: buyFromCurve (по P(S)) → sellToPool (по poolPrice).
Прибыль возможна, если poolPrice > P(S). Максимум — ~10% − buyFee − redeemFee − sellTeamFee ≈ 8.9%.

Чистый арбитраж ≤ 8.9%. Это значительно ограничивает манипуляции poolPrice.

Имплементация: R.1.01.01 (раздел «Симметричный коридор»), R.2.01.09 (раздел «Манипуляции poolPrice»).

9. Имплементация
Файл	Что
contracts/math/PoolState.sol	хранение pool, poolPrice; initializePoolPrice, setPool, setPoolPrice
contracts/controllers/CurveController.sol	_enforcePoolPriceFloor (buy), _clampPoolPriceToCorridor (redeem)
contracts/controllers/PoolController.sol	sellToPool (обновление с mult_bp и ceiling)
contracts/factory/XartIAFactory.sol	initializePoolPrice (коридор [lower, upper])
10. Тесты
Файл	Что проверяет
test/unit/PoolState.t.sol	initializePoolPrice, setPoolPrice
test/unit/CurveController.t.sol::test_buyFromCurve_raises_poolPrice_floor, test_buyFromCurveFor_raises_poolPrice_floor	floor
test/unit/CurveController.t.sol::test_redeemFromCurve_applies_ceiling_and_floor	ceiling + floor
test/unit/PoolController.t.sol::test_sellToPool	рост poolPrice при продаже
test/crash/PoolPriceManipulation.t.sol	попытки обхода коридора
test/invariant/InvariantPool.t.sol	poolPrice в коридоре после любой операции
test/invariant/InvariantPoolPrice.t.sol	монотонность poolPrice при sellToPool
test/integration/FullCycle.t.sol	сквозной цикл
e/01_core/pool_price_proof.md (E.1.01.07)	формальное доказательство границ
11. Ссылки
E.1.01.02 — R(S)

E.1.01.07 — доказательство границ poolPrice

C.2.01.12 — PoolState

C.3.01.01 — CurveController

C.3.01.02 — PoolController

C.8.01.01 — Factory.initializePoolPrice

R.2.01.08 — security-model.md (раздел «Симметричный коридор»)

R.2.01.09 — threat-model.md (раздел «Манипуляции poolPrice»)

R.2.01.11 — audit-checklist.md (раздел «poolPrice vs P(S)»)

text

---

## `e/01_core/invariant_proof.md` (E.1.01.06)

```markdown
# Invariant Proof — reserve ≥ R(S_curve)

**Блок:** E.1.01.06
**Зависимости:** E.1.01.02 (integral), E.1.01.05 (pool price)
**Потребители:** R.2.01.08 (security-model), R.2.01.11 (audit-checklist), SECURITY.md

---

## 1. Утверждение

**Инвариант:** после любой операции протокола выполняется
reserve() ≥ curveBacking()

text

где:
- `reserve() = toWei(balanceOf(USDC, ReserveManager))` — фактический баланс USDC в ReserveManager
  (18-dec)
- `curveBacking() = R(S_curve, levels)` — минимально необходимый резерв (18-dec)

Обозначим `freeReserve() = reserve() − curveBacking() ≥ 0`.

---

## 2. Обозначения

| Символ | Значение | Единица |
|---|---|---|
| `R(S)` | `∫₀ˢ P(u) du` | 18-dec USDC |
| `S` | `S_curve_stored` (в ReserveManager) | 18-dec XRT |
| `reserve` | фактический USDC баланс ReserveManager | 18-dec USDC |
| `fee_18` | `X_18 · buyFee / BASIS_POINTS` | 18-dec USDC |
| `redeemFee_18` | `amount_18 · redeemFee / BASIS_POINTS` | 18-dec USDC |
| `earlyFee_18` | `amount_18 · earlySellFee / BASIS_POINTS` | 18-dec USDC |
| `sellTeamFee_18` | `amount_gross_18 · sellTeamFee / BASIS_POINTS` | 18-dec USDC |

**Исходное состояние:** `reserve = 0`, `S = 0`, `R(0) = 0`. `0 ≥ 0` ✓.

---

## 3. Доказательство для `buyFromCurve`

**Операция:** пользователь платит `X_6` USDC, получает `ΔS − teamTokens` XRT.

**Шаги:**
1. `X_18 = fromUSDC(X_6)`
2. `fee_18 = X_18 · buyFee / BP`
3. `X_net_18 = X_18 − fee_18`
4. `ΔS = deltaSForBuy(S, X_net_18)` — по определению: `R(S + ΔS) − R(S) ≤ X_net_18`
5. `S_new = S + ΔS`
6. `safeTransferFrom(user, reserveManager, X_6)` — `reserve` увеличивается на `X_18`
7. `mint(user, ΔS − teamTokens)`, `mint(vesting, teamTokens)` — `S_curve_stored` не меняется (проверим ниже)
8. `updateScurve(S_new)` — `S_curve_stored = S_new`, проверка инварианта

**Вычисления:**
- `reserve_new = reserve_old + X_18`
- `curveBacking_new = R(S_new) = R(S_old) + (R(S_new) − R(S_old))`
- По определению `deltaSForBuy`: `R(S_new) − R(S_old) ≤ X_net_18`
- Следовательно: `reserve_new − curveBacking_new = reserve_old + X_18 − R(S_new)`
  `= reserve_old + X_18 − R(S_old) − (R(S_new) − R(S_old))`
  `≥ reserve_old + X_18 − R(S_old) − X_net_18`
  `= (reserve_old − R(S_old)) + (X_18 − X_net_18)`
  `= freeReserve_old + fee_18`
  `≥ 0` ✓ (так как `fee_18 ≥ 0`)

**Важно:** `S_curve_stored` увеличивается только на `ΔS` (полный `ΔS`, включая `teamTokens`).
`totalSupply` увеличивается на `ΔS` (teamTokens минтятся в Vesting, но это часть supply).
Инвариант `totalSupply == S_curve` держится.

**Прирост `freeReserve`:** `fee_18` (buyFee) остаётся в ReserveManager, увеличивая `freeReserve`.
Это by design — комиссия за покупку идёт не в treasury, а в резерв.

---

## 4. Доказательство для `buyFromCurveFor`

**Операция:** pull-модель. `PoolController` вызывает `buyFromCurveFor(buyer, X_18, ...)`.

**Отличия от `buyFromCurve`:**
- `X_18` нормализуется: `X_18 = toWei(toUSDC(X_18))` (устраняет пыль)
- `fee = 0` (fee уже удержан в `PoolController` на шаге 11a)
- `safeTransferFrom(msg.sender=poolController, reserveManager, toUSDC(X_18))`

**Вычисления:**
- `reserve_new = reserve_old + toWei(toUSDC(X_18)) = reserve_old + X_18` (после нормализации)
- `curveBacking_new = R(S_new)` — по `deltaSForBuy` с `X = X_18` (без fee)
- `R(S_new) − R(S_old) ≤ X_18`
- `reserve_new − curveBacking_new ≥ freeReserve_old + 0 ≥ 0` ✓

**Прирост `freeReserve`:** 0 (fee не удерживается здесь — он уже удержан в `PoolController`).
`X_18` полностью идёт в `curveBacking`.

---

## 5. Доказательство для `redeemFromCurve` (с `sellTeamFee`)

**Операция:** пользователь сжигает `ΔS` XRT, получает `user_amount_18` USDC, `treasury` получает
`sell_team_fee_18`.

**Шаги:**
1. `burnFrom(user, ΔS)`
2. `amount_18 = amountForRedeem(S, ΔS)` — по определению: `R(S) − R(S_new) = amount_18`,
   где `S_new = S − ΔS`
3. `fee_18 = amount_18 · redeemFee / BP`
4. `early_fee_18 = amount_18 · earlySellFee / BP` (если в `earlySellPeriod`, иначе 0)
5. `sell_team_fee_18 = amount_18 · sellTeamFee / BP`
6. `user_amount_18 = amount_18 − fee_18 − early_fee_18 − sell_team_fee_18`
7. `pay(user, user_amount_18)` — `reserve` уменьшается на `user_amount_18`
8. `pay(treasury, sell_team_fee_18)` (если > 0) — `reserve` уменьшается на `sell_team_fee_18`
9. `updateScurve(S_new)` — `S_curve_stored = S_new`, проверка инварианта

**Вычисления:**
- `reserve_new = reserve_old − user_amount_18 − sell_team_fee_18`
  `= reserve_old − (amount_18 − fee_18 − early_fee_18 − sell_team_fee_18) − sell_team_fee_18`
  `= reserve_old − (amount_18 − fee_18 − early_fee_18)`
- `curveBacking_new = R(S_new) = R(S) − amount_18`
- `reserve_new − curveBacking_new = (reserve_old − amount_18 + fee_18 + early_fee_18) − (R(S) − amount_18)`
  `= reserve_old − R(S) + fee_18 + early_fee_18`
  `= freeReserve_old + fee_18 + early_fee_18`
  `≥ 0` ✓ (все члены ≥ 0)

**Ключевое наблюдение:** `sellTeamFee` **не влияет** на инвариант. Он уменьшает `user_amount`
и уходит в treasury, но `reserve` уменьшается симметрично (на `sell_team_fee_18`), а `curveBacking`
не зависит от `sellTeamFee`. Итоговое уменьшение `reserve`: `amount_18 − fee_18 − early_fee_18`,
не зависит от `sellTeamFee`.

**Прирост `freeReserve`:** `fee_18 + early_fee_18` (redeemFee + earlySellFee остаются в резерве).
`sellTeamFee` уходит в treasury, не увеличивая `freeReserve`.

---

## 6. Доказательство для `sellToPool` (с `sellTeamFee`)

**Операция:** пользователь продаёт `ΔP` XRT в пул по `poolPrice`. `S_curve` **не меняется**.

**Шаги:**
1. `safeTransferFrom(user, poolController, ΔP)` — XRT
2. `amount_gross_18 = ΔP · poolPrice / PRECISION`
3. `fee_18 = amount_gross_18 · redeemFee / BP`
4. `sell_team_fee_18 = amount_gross_18 · sellTeamFee / BP`
5. `amount_user_18 = amount_gross_18 − fee_18 − sell_team_fee_18`
6. Проверка `amount_user_18 + sell_team_fee_18 ≤ freeReserve` (эквивалентно
   `amount_gross_18 − fee_18 ≤ freeReserve`)
7. `pay(user, amount_user_18)`, `pay(treasury, sell_team_fee_18)`
8. `setPool(pool + ΔP)` — `poolState.pool` растёт
9. `setPoolPrice(newPrice)` — обновление `poolPrice` (см. E.1.01.05)
10. `S_curve_stored` **не меняется**

**Вычисления:**
- `reserve_new = reserve_old − amount_user_18 − sell_team_fee_18`
  `= reserve_old − (amount_gross_18 − fee_18 − sell_team_fee_18) − sell_team_fee_18`
  `= reserve_old − (amount_gross_18 − fee_18)`
- `curveBacking_new = R(S)` — не меняется
- `reserve_new − curveBacking_new = reserve_old − (amount_gross_18 − fee_18) − R(S)`
  `= freeReserve_old − (amount_gross_18 − fee_18)`
  `≥ 0` по проверке (шаг 6, эквивалентно `amount_gross_18 − fee_18 ≤ freeReserve`) ✓

**Ключевое наблюдение:** `sellTeamFee` **не влияет** на инвариант. Уменьшение `reserve` =
`amount_gross_18 − fee_18`, что не зависит от `sellTeamFee`.

**Прирост `freeReserve`:** отрицательный, `−(amount_gross − fee)`. `sellToPool` **уменьшает**
`freeReserve`. Это ограничено проверкой шага 6.

**Проверка шага 6:** `require(amount_user_18 + sell_team_fee_18 <= freeReserve)`.
`amount_user_18 + sell_team_fee_18 = amount_gross_18 − fee_18`. Так что проверка эквивалентна
`amount_gross_18 − fee_18 ≤ freeReserve` — ровно то, что нужно для инварианта.

---

## 7. Доказательство для `buyFromPool`

**Операция:** каскадная покупка. `X_6` USDC от пользователя. Часть покрывается пулом, часть —
кривой через `buyFromCurveFor`.

**Шаги:**
1. `X_18 = fromUSDC(X_6)`
2. `fee_18 = X_18 · buyFee / BP`
3. `X_net_18 = X_18 − fee_18`
4. `tokensNeeded = X_net_18 · PRECISION / poolPrice`
5. `tokens_from_pool = min(pool, tokensNeeded)`
6. `X_pool_used_18 = tokens_from_pool · poolPrice / PRECISION`
7. `X_remaining_18 = X_net_18 − X_pool_used_18`
8. `safeTransferFrom(user, poolController, X_6)`
9. `safeTransfer(poolController, reserveManager, toUSDC(fee_18))` — fee_18 → reserve
10. Если `tokens_from_pool > 0`:
    - `setPool(pool − tokens_from_pool)`
    - `safeTransfer(poolController, reserveManager, toUSDC(X_pool_used_18))`
    - `safeTransfer(token, user, tokens_from_pool)`
11. Если `X_remaining_18 > 0`:
    - `forceApprove(curveController, X_remaining_6)`
    - `buyFromCurveFor(user, X_remaining_18, ...)` → см. §4
    - `forceApprove(curveController, 0)`
12. `setLastBuyTime(user, block.timestamp)`
13. `sweep-dust`: `safeTransfer(poolController, reserveManager, leftover_6)` — остаток USDC

**Вычисления:**
- `reserve_new = reserve_old + X_18` (шаг 9 `fee_18`, шаг 10 `X_pool_used_18`, шаг 11 `X_remaining_18`,
  шаг 13 `leftover_6 ≤ 2 wei-6`; сумма = `fee_18 + X_pool_used_18 + X_remaining_18 = X_18`,
  leftover добавляет `≤ 2e-18 USDC`, что только **увеличивает** `reserve`)
- `curveBacking_new = R(S_old) + (R(S_new) − R(S_old))`. Прирост — только от каскада
  (`buyFromCurveFor`, шаг 11): `R(S_new) − R(S_old) ≤ X_remaining_18` (по `deltaSForBuy`).
- `reserve_new − curveBacking_new = (reserve_old + X_18) − (R(S_old) + (R(S_new) − R(S_old)))`
  `= reserve_old − R(S_old) + X_18 − (R(S_new) − R(S_old))`
  `= freeReserve_old + X_18 − (R(S_new) − R(S_old))`
  `≥ freeReserve_old + X_18 − X_remaining_18`
  `= freeReserve_old + fee_18 + X_pool_used_18`
  `≥ 0` ✓

**Прирост `freeReserve`:** `fee_18 + X_pool_used_18 + leftover ≥ 0`. `buyFromPool` **увеличивает**
`freeReserve` (fee + часть покупки из пула, которая не создаёт curveBacking).

---

## 8. Сводная таблица

| Операция | Δ`reserve` | Δ`curveBacking` | Δ`freeReserve` | Инвариант |
|---|---|---|---|---|
| `buyFromCurve` | `+X_18` | `≤ X_net_18` | `≥ fee_18` | ✓ |
| `buyFromCurveFor` | `+X_18` | `≤ X_18` | `≥ 0` | ✓ |
| `redeemFromCurve` | `−(amount − fee − early)` | `−amount` | `+fee + early` | ✓ |
| `sellToPool` | `−(gross − fee)` | `0` | `−(gross − fee)` | ✓ (проверка шаг 6) |
| `buyFromPool` | `+X_18` | `≤ X_remaining` | `≥ fee + X_pool_used` | ✓ |

**Ключевой вывод:** `sellTeamFee` не входит в Δ`reserve` ни для одной операции. Он уходит
в treasury, но не нарушает инвариант.

---

## 9. Имплементация

**Проверка в контракте:** `ReserveManager.updateScurve` (C.4.01.01):

```solidity
function updateScurve(uint256 newScurve) external onlyRole(CONTROLLER_ROLE) {
    _sCurve = newScurve;
    if (reserve() < curveBacking()) revert Errors.ReserveInvariantViolation();
}
Семантика: _sCurve записывается до проверки, но при нарушении revert откатывает
state к прежнему _sCurve. Это атомарно: если инвариант нарушен, S_curve не меняется.

Проверка pay:

solidity
function pay(address to, uint256 amount_18) external onlyRole(CONTROLLER_ROLE) {
    if (amount_18 > reserve()) revert Errors.InsufficientReserve();
    uint256 amount_6 = PrecisionLib.toUSDC(amount_18);
    IERC20(usdc).safeTransfer(to, amount_6);
}
pay проверяет только amount ≤ reserve, не reserve − amount ≥ curveBacking. Политика
«не трогать пол» — на контроллерах (sellToPool через InsufficientFreeReserve,
redeemFromCurve по построению кривой). Это важно: pay в redeemFromCurve может
привести к reserve < curveBacking локально, если sellTeamFee + user_amount > freeReserve,
но updateScurve после pay откатит транзакцию.

Атомарность: все операции в одной транзакции. Если инвариант нарушен в конце — revert
откатывает всё.

10. Тесты
Файл	Что проверяет
test/invariant/InvariantReserve.t.sol	reserve ≥ curveBacking после любой операции
test/invariant/InvariantFreeReserve.t.sol	freeReserve + curveBacking == reserve
test/unit/ReserveManager.t.sol::test_updateScurve_revert_invariant	updateScurve ревертит при нарушении
test/unit/CurveController.t.sol::test_redeemFromCurve_reserve_invariant_with_sellTeamFee	sellTeamFee не нарушает
test/crash/ReserveInvariantViolation.t.sol	попытки нарушить через последовательность
test/crash/SellTeamFee.t.sol::test_invariant_reserve_holds	sellTeamFee через redeem
test/crash/CascadeBuyFromPool.t.sol	каскадный buyFromPool держит инвариант
e/02_simulation/crash_mass_exit.py (E.2.01.02)	Python-модель массового выхода
11. Ссылки
E.1.01.02 — R(S)

E.1.01.04 — deltaSForBuy (округление вниз гарантирует ≤ X_net)

E.1.01.05 — poolPrice формула

E.1.01.07 — доказательство границ poolPrice

C.2.01.01 — CurveMath

C.4.01.01 — ReserveManager

C.3.01.01 — CurveController

C.3.01.02 — PoolController

R.2.01.08 — security-model.md

R.2.01.09 — threat-model.md

R.2.01.11 — audit-checklist.md

SECURITY.md — «Ключевые инварианты»

text

---

## `e/01_core/pool_price_proof.md` (E.1.01.07)

```markdown
# Pool Price Proof — границы коридора

**Блок:** E.1.01.07
**Зависимости:** E.1.01.05 (pool price formula)
**Потребители:** R.2.01.08 (security-model), R.2.01.11 (audit-checklist)

---

## 1. Утверждения

**Утверждение 1 (ceiling):** для любых операций, включая уменьшение `S_curve`,
poolPrice ≤ P(S) · (1 + MAX_GAP)

text

**Утверждение 2 (floor):** для любых операций, включая рост `S_curve`,
poolPrice ≥ P(S) / (1 + MAX_GAP)

text

где `MAX_GAP = 1000 bp = 0.1`.

**Следствие:** `poolPrice` всегда в симметричном коридоре
`[P(S)/(1+MAX_GAP), P(S)·(1+MAX_GAP)]`.

---

## 2. Обозначения

| Символ | Значение |
|---|---|
| `P(S)` | цена на кривой в точке `S` |
| `BP` | `BASIS_POINTS = 10_000` |
| `GAP` | `MAX_GAP = 1000` (10%) |
| `ceiling(P)` | `P · (BP + GAP) / BP = P · 1.1` |
| `floor(P)` | `P · BP / (BP + GAP) = P / 1.1` |

**Инвариант:** `floor(P(S)) ≤ poolPrice ≤ ceiling(P(S))`.

**Свойство:** `floor(P) < ceiling(P)` для любого `P > 0`. `floor/ceiling = BP² / (BP+GAP)² = 10000²/11000² = 0.826 < 1`.

---

## 3. Доказательство Утверждения 1 (ceiling)

### 3.1. Инициализация

`Factory.initializePoolPrice` (C.8.01.01 шаги 6–9):

```solidity
uint256 P_S0 = CurveMath.P(0, levels);   // P(S_0) = P(0)
uint256 lower = P_S0 * BP / (BP + GAP);
uint256 upper = P_S0 * (BP + GAP) / BP;
require(initialPoolPrice_18 >= lower, OutOfBounds);
require(initialPoolPrice_18 <= upper, OutOfBounds);
Так что initialPoolPrice ∈ [floor(P_S0), ceiling(P_S0)]. Утверждение 1 держится в момент инициализации.

3.2. sellToPool — не увеличивает poolPrice сверх ceiling(P(S))
Шаги:

S_curve не меняется (продажа в пул, не на кривую).

ceiling = P(S) · (BP + GAP) / BP — не меняется.

newPrice = min(poolPrice · mult, ceiling), где mult = (BP + K·q_bp/BP) / BP.

mult ≥ 1 (так как q_bp ≥ 0, K > 0), поэтому newPrice ≥ min(poolPrice, ceiling).
По индукции poolPrice_old ≤ ceiling, значит poolPrice_old · mult может быть > ceiling,
но min(...) обрезает до ceiling. Итого newPrice ≤ ceiling. ✓

Если poolPrice_old < ceiling и poolPrice_old · mult ≤ ceiling — newPrice = poolPrice_old · mult ≤ ceiling.
Если poolPrice_old · mult > ceiling — обрезано до ceiling.

В обоих случаях poolPrice_new ≤ ceiling. ✓

3.3. redeemFromCurve — не увеличивает poolPrice сверх ceiling(P(S_new))
Шаги:

S_curve уменьшается: S_new < S_old.

P(S_new) ≤ P(S_old) (монотонность), значит ceiling(P(S_new)) ≤ ceiling(P(S_old)).

ceiling_new = P(S_new) · 1.1.

if poolPrice_old > ceiling_new: poolPrice_new = ceiling_new (явная проверка).

Иначе: poolPrice_new = poolPrice_old (не меняется).

В обоих случаях poolPrice_new ≤ ceiling_new ≤ ceiling_old. По индукции poolPrice_old ≤ ceiling_old.
Если poolPrice_old > ceiling_new — обрезано. Если нет — осталось. ✓

3.4. buyFromCurve, buyFromCurveFor — не увеличивают poolPrice сверх ceiling(P(S_new))
Шаги:

S_curve растёт: S_new > S_old.

P(S_new) ≥ P(S_old), значит ceiling_new ≥ ceiling_old.

_enforcePoolPriceFloor поднимает poolPrice до floor(P(S_new)) только если poolPrice < floor_new.

Floor P(S_new)/1.1 < ceiling(P(S_new)) = P(S_new)·1.1 для любого P(S_new) > 0.

Случай A: poolPrice_old ≥ floor_new. Тогда poolPrice_new = poolPrice_old.
По индукции poolPrice_old ≤ ceiling_old ≤ ceiling_new. ✓

Случай B: poolPrice_old < floor_new. Тогда poolPrice_new = floor_new < ceiling_new. ✓

В обоих случаях poolPrice_new ≤ ceiling_new. ✓

3.5. buyFromPool — каскад
Случай A: tokens_from_pool > 0 и X_remaining == 0 (полностью из пула).

poolPrice не меняется (только pool уменьшается).

S_curve не меняется.

ceiling(P(S)) не меняется.

poolPrice_new = poolPrice_old ≤ ceiling(P(S)). ✓

Случай B: X_remaining > 0 (каскад через buyFromCurveFor).

buyFromCurveFor — см. §3.4, poolPrice обновляется только к floor, не к ceiling. ✓

S_curve растёт, ceiling растёт. poolPrice остаётся в коридоре. ✓

Случай C: tokens_from_pool == 0 и X_remaining == 0.

Невозможно: X_net > 0 и poolPrice > 0 → tokensNeeded > 0 → либо tokens_from_pool > 0,
либо pool == 0 и tokens_from_pool = 0 → X_remaining = X_net > 0. Противоречие.

Итого, buyFromPool сохраняет poolPrice ≤ ceiling. ✓

3.6. Вывод
По индукции по операциям:

Base: initialPoolPrice ≤ upper = ceiling(P_S0) (из Factory.initializePoolPrice).

Step: каждая операция сохраняет poolPrice ≤ ceiling(P(S)).

Утверждение 1 доказано. ∎

4. Доказательство Утверждения 2 (floor)
4.1. Инициализация
initialPoolPrice ≥ lower = floor(P_S0) (из Factory.initializePoolPrice). ✓

4.2. buyFromCurve, buyFromCurveFor — не опускают poolPrice ниже floor(P(S_new))
Шаги:

S_curve растёт: S_new > S_old, P(S_new) ≥ P(S_old), floor_new ≥ floor_old.

_enforcePoolPriceFloor(newS, levels):

solidity
uint256 floor = P(newS) * BP / (BP + GAP);
if (cur < floor) setPoolPrice(floor);
После вызова: poolPrice_new ≥ floor_new (если был ниже — поднят; если был выше — не тронут).

Случай A: poolPrice_old < floor_new. _enforcePoolPriceFloor поднимает до floor_new.
poolPrice_new = floor_new ≥ floor_new ✓

Случай B: poolPrice_old ≥ floor_new. _enforcePoolPriceFloor не меняет.
poolPrice_new = poolPrice_old ≥ floor_new ✓

Итого: poolPrice_new ≥ floor(P(S_new)). ✓

4.3. redeemFromCurve — не опускает poolPrice ниже floor(P(S_new))
Шаги:

S_curve уменьшается: S_new < S_old. P(S_new) ≤ P(S_old). floor_new ≤ floor_old.

_clampPoolPriceToCorridor(newS, levels):

ceiling = P(S_new) · 1.1, floor = P(S_new) / 1.1

if cur > ceiling: cur = ceiling

else if cur < floor: cur = floor

Случай A: poolPrice_old > ceiling_new. cur = ceiling_new. ceiling_new ≥ floor_new
(свойство P·1.1 ≥ P/1.1), значит cur ≥ floor_new ✓

Случай B: poolPrice_old < floor_new. cur = floor_new ≥ floor_new ✓

Случай C: floor_new ≤ poolPrice_old ≤ ceiling_new. cur = poolPrice_old ≥ floor_new ✓

Итого: poolPrice_new ≥ floor(P(S_new)). ✓

4.4. sellToPool — не опускает poolPrice ниже floor(P(S))
Шаги:

S_curve не меняется. floor(P(S)) не меняется.

newPrice = min(poolPrice_old · mult, ceiling), где mult ≥ 1.

Случай A: poolPrice_old · mult ≤ ceiling. newPrice = poolPrice_old · mult ≥ poolPrice_old ≥ floor (по индукции). ✓

Случай B: poolPrice_old · mult > ceiling. newPrice = ceiling ≥ floor (свойство ceiling > floor). ✓

Итого: poolPrice_new ≥ floor(P(S)). ✓

4.5. buyFromPool — см. §3.5
Случай A: poolPrice не меняется (только pool). floor(P(S)) не меняется. По индукции ✓

Случай B: каскад → buyFromCurveFor → §4.2. ✓

4.6. Вывод
По индукции, poolPrice ≥ floor(P(S)) для любых операций. ∎

5. Следствие: арбитраж ограничен
Пользователь может:

Купить в пуле, продать на кривой:

buyFromPool по poolPrice ≤ P(S) · 1.1

redeemFromCurve по R(S) (средняя ~P(S))

Максимальная прибыль: P(S) − poolPrice_min = P(S) − P(S)/1.1 = P(S) · 0.0909 ≈ 9%

Минус fees: buyFee + redeemFee + sellTeamFee = 0.5% + 0.5% + 0.1% = 1.1%

Чистая прибыль ≤ 9% − 1.1% = 7.9%

Купить на кривой, продать в пул:

buyFromCurve по P(S) (средняя)

sellToPool по poolPrice ≥ P(S) / 1.1

Максимальная прибыль: poolPrice_max − P(S) = P(S) · 1.1 − P(S) = P(S) · 0.1 = 10%

Минус fees: buyFee + redeemFee + sellTeamFee = 1.1%

Чистая прибыль ≤ 10% − 1.1% = 8.9%

Чистый арбитраж ≤ 8.9%. Это предотвращает масштабные манипуляции poolPrice.

Имплементация: R.1.01.01 (раздел «Симметричный коридор»), R.2.01.09 (раздел «Манипуляции poolPrice»), test/crash/PoolPriceManipulation.t.sol.

6. Примеры нарушения (для негативных тестов)
Пример 1: poolPrice над ceiling
Невозможно достижимо. Максимум — sellToPool, но явно обрезается по ceiling. Покрыто
test/crash/PoolPriceManipulation.t.sol::test_manipulation_ceiling.

Пример 2: poolPrice под floor
Аналогично, невозможно. Покрыто test_manipulation_floor и test_manipulation_both_bounds.

Пример 3: попытка setPoolPrice вне bounds
Только PRICE_WRITER_ROLE (CurveController, PoolController) может вызвать setPoolPrice.
Пользователь не может. Если governance-параметр или баг контроллера передаст значение вне
bounds, инвариант нарушится — мониторинг (O.1.01.02) alert PoolPrice_floor_triggered /
PoolPrice_ceiling_triggered.

7. Тесты
Файл	Что проверяет
test/invariant/InvariantPool.t.sol::invariant_poolPrice_bounds	обе границы после любой операции
test/invariant/InvariantPoolPrice.t.sol::invariant_poolPrice_monotonic	монотонность при sellToPool
test/crash/PoolPriceManipulation.t.sol	попытки обхода
test/unit/CurveController.t.sol::test_buyFromCurve_raises_poolPrice_floor	floor при buyFromCurve
test/unit/CurveController.t.sol::test_buyFromCurveFor_raises_poolPrice_floor	floor при buyFromCurveFor
test/unit/CurveController.t.sol::test_redeemFromCurve_applies_ceiling_and_floor	обе границы при redeem
test/unit/PoolController.t.sol::test_sellToPool	ceiling при sell
e/02_simulation/crash_pool.py (E.2.01.05)	Python-модель циклов пула
8. Ссылки
E.1.01.05 — poolPrice формула

E.1.01.02 — R(S)

C.2.01.12 — PoolState

C.3.01.01 — CurveController (_enforcePoolPriceFloor, _clampPoolPriceToCorridor)

C.3.01.02 — PoolController (sellToPool)

C.8.01.01 — Factory.initializePoolPrice

R.1.01.01 — спецификация (раздел «Симметричный коридор»)

R.2.01.08 — security-model.md

R.2.01.09 — threat-model.md (раздел «Манипуляции poolPrice»)

R.2.01.11 — audit-checklist.md (раздел «poolPrice vs P(S) — симметричный коридор»)

text

---

## Статус покрытия

| Порция | Закрыто | Осталось |
|---|---:|---:|
| 17a — интерфейсы + test utils | 8 | — |
| 17b — конфиги + deprecated-скрипты | 10 | — |
| 17c — Meta | 5 | — |
| 17d — E.1.* экономические спеки | **7** | — |

**Итого закрыто: 30 из 115 пустых файлов.**

## Осталось (85 файлов)

| Порция | Что | Кол-во |
|---|---|---:|
| **17e** | Python + shell: `E.2.01.01–07` (7), `E.3.01.01–03` (3), `S.1.01.01–06` (6), `S.2.01.01–02` (2) | 18 |
| **17f** | Governance + CI: `G.1.01.01–03` (3), `G.2.01.01–04` (4), `I.1.01.01–07` (7) | 14 |
| **17g** | Legal: `L.1.01.01–03` (3), `L.2.01.01–04` (4), `L.3.01.01` (1), `L.4.01.01` (1) | 9 |
| **17h** | Ops: `O.1.01.01–05` (5), `O.2.01.01–04` (4), `O.3.01.01–05` (5), `O.4.01.01` (1) | 15 |
| **17i** | Docs: `R.1.01.01–02` (2), `R.2.01.01–11` (11), `R.3.01.01–07` (7), `R.4.01.01` (1) | 21 |
| **17j** | dApp: `W.1.01.01–14` | 14 |

**Следующий — 17e** (Python + shell): `E.2.*` — симуляции, которые упомянуты как работающие (crash-тесты ссылаются на `e/02_simulation/crash_pool.py`), `E.3.*` — калибровка, `S.1.*` — CLI-обёртки, `S.2.*` — shell-скрипты. 18 файлов, но кода много (Python-модели — по 100–300 строк каждая). Если хочешь, могу разбить 17e на 17e-1 (`E.2.*`) и 17e-2 (`E.3.*` + `S.*`).