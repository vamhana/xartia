#!/usr/bin/env bash
# =============================================================================
# test.sh — запуск тестов XartIA
#
# Использование:
#   ./scripts/shell/test.sh                # все тесты (unit + fuzz + invariant + crash + integration + gas)
#   ./scripts/shell/test.sh unit           # только test/unit/*
#   ./scripts/shell/test.sh fuzz           # test/fuzz/* (10 000 runs)
#   ./scripts/shell/test.sh invariant      # test/invariant/* (1000 runs × 100 depth)
#   ./scripts/shell/test.sh crash          # test/crash/*
#   ./scripts/shell/test.sh integration    # test/integration/*
#   ./scripts/shell/test.sh gas            # test/gas/* -vv
#   ./scripts/shell/test.sh coverage       # forge coverage + проверка >= 95%
#   ./scripts/shell/test.sh all            # синоним для "все тесты"
#
# Переменные окружения:
#   FUZZ_RUNS         (по умолчанию 10000)
#   INVARIANT_RUNS    (по умолчанию 1000)
#   INVARIANT_DEPTH   (по умолчанию 100)
#   COVERAGE_MIN      (по умолчанию 95)
#   VERBOSITY         (по умолчанию 2; -vvv = 3, -vvvv = 4)
#
# Блок: S.2.01.02
# Зависимости: T.1.*, T.2.*, T.3.*, T.4.*, T.5.*, T.6.*, T.7.*
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"

cd "${ROOT_DIR}"

# ---------------------------------------------------------------------------
# Параметры
# ---------------------------------------------------------------------------
FUZZ_RUNS="${FUZZ_RUNS:-10000}"
INVARIANT_RUNS="${INVARIANT_RUNS:-1000}"
INVARIANT_DEPTH="${INVARIANT_DEPTH:-100}"
COVERAGE_MIN="${COVERAGE_MIN:-95}"
VERBOSITY="${VERBOSITY:-2}"
MODE="${1:-all}"

# ---------------------------------------------------------------------------
# Проверки
# ---------------------------------------------------------------------------
if ! command -v forge >/dev/null 2>&1; then
    echo "error: forge not found in PATH" >&2
    exit 127
fi

V_FLAG=""
for ((i = 0; i < VERBOSITY; i++)); do
    V_FLAG="${V_FLAG}-v"
done

# ---------------------------------------------------------------------------
# Вспомогательные функции
# ---------------------------------------------------------------------------
run_unit() {
    echo "==> unit tests (test/unit/*)"
    forge test --match-path 'test/unit/*' ${V_FLAG}
}

run_fuzz() {
    echo "==> fuzz tests (test/fuzz/*, runs=${FUZZ_RUNS})"
    FOUNDRY_FUZZ_RUNS="${FUZZ_RUNS}" forge test --match-path 'test/fuzz/*' ${V_FLAG}
}

run_invariant() {
    echo "==> invariant tests (test/invariant/*, runs=${INVARIANT_RUNS}, depth=${INVARIANT_DEPTH})"
    FOUNDRY_INVARIANT_RUNS="${INVARIANT_RUNS}" \
        FOUNDRY_INVARIANT_DEPTH="${INVARIANT_DEPTH}" \
        forge test --match-path 'test/invariant/*' ${V_FLAG}
}

run_crash() {
    echo "==> crash tests (test/crash/*)"
    forge test --match-path 'test/crash/*' ${V_FLAG}
}

run_integration() {
    echo "==> integration tests (test/integration/*)"
    forge test --match-path 'test/integration/*' ${V_FLAG}
}

run_gas() {
    echo "==> gas tests (test/gas/*)"
    forge test --match-path 'test/gas/*' -vv
}

run_coverage() {
    echo "==> coverage (target: >= ${COVERAGE_MIN}%)"
    forge coverage --report lcov --report summary

    # Парсинг summary: ищем строку "| Total | ... | N% |"
    local summary
    summary=$(forge coverage --report summary 2>&1 | grep -E '^\| Total' || true)
    if [[ -z "${summary}" ]]; then
        echo "warn: could not parse coverage summary" >&2
        return 0
    fi

    # Последнее поле с процентом (lines coverage) — берём цифру
    local pct
    pct=$(echo "${summary}" | grep -oE '[0-9]+\.[0-9]+|[0-9]+' | tail -1 | cut -d. -f1)
    if [[ -z "${pct}" ]]; then
        echo "warn: could not extract coverage percentage" >&2
        return 0
    fi

    if (( pct < COVERAGE_MIN )); then
        echo ""
        echo "FAIL: coverage ${pct}% < ${COVERAGE_MIN}%" >&2
        return 1
    fi

    echo ""
    echo "coverage OK: ${pct}%"
}

run_all() {
    run_unit
    run_fuzz
    run_invariant
    run_crash
    run_integration
    run_gas
    echo ""
    echo "========================================"
    echo "ALL TEST SUITES PASSED"
    echo "========================================"
}

# ---------------------------------------------------------------------------
# Диспетчер
# ---------------------------------------------------------------------------
case "${MODE}" in
    unit)        run_unit ;;
    fuzz)        run_fuzz ;;
    invariant)   run_invariant ;;
    crash)       run_crash ;;
    integration) run_integration ;;
    gas)         run_gas ;;
    coverage)    run_coverage ;;
    all)         run_all ;;
    -h|--help)
        sed -n '2,29p' "$0"
        ;;
    *)
        echo "error: unknown mode: ${MODE}" >&2
        echo "usage: $0 {unit|fuzz|invariant|crash|integration|gas|coverage|all}" >&2
        exit 2
        ;;
esac