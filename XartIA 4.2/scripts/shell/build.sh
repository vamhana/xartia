#!/usr/bin/env bash
# =============================================================================
# build.sh — сборка контрактов XartIA
#
# Использование:
#   ./scripts/shell/build.sh            # forge build --sizes
#   ./scripts/shell/build.sh --no-sizes # forge build (без отчёта о размерах)
#   ./scripts/shell/build.sh --clean    # сначала clean, потом build
#
# Блок: S.2.01.01
# Зависимости: D.2.01.04 (foundry.toml)
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"

cd "${ROOT_DIR}"

# ---------------------------------------------------------------------------
# Парсинг аргументов
# ---------------------------------------------------------------------------
USE_SIZES=1
DO_CLEAN=0

for arg in "$@"; do
    case "$arg" in
        --no-sizes) USE_SIZES=0 ;;
        --clean)    DO_CLEAN=1 ;;
        -h|--help)
            sed -n '2,14p' "$0"
            exit 0
            ;;
        *)
            echo "unknown argument: $arg" >&2
            exit 2
            ;;
    esac
done

# ---------------------------------------------------------------------------
# Проверки
# ---------------------------------------------------------------------------
if ! command -v forge >/dev/null 2>&1; then
    echo "error: forge not found in PATH" >&2
    echo "hint: install foundry via https://getfoundry.sh" >&2
    exit 127
fi

if [[ ! -f "foundry.toml" ]]; then
    echo "error: foundry.toml not found in ${ROOT_DIR}" >&2
    exit 1
fi

# ---------------------------------------------------------------------------
# Опциональная очистка
# ---------------------------------------------------------------------------
if [[ "${DO_CLEAN}" -eq 1 ]]; then
    echo "==> forge clean"
    forge clean
fi

# ---------------------------------------------------------------------------
# Сборка
# ---------------------------------------------------------------------------
echo "==> forge build"

if [[ "${USE_SIZES}" -eq 1 ]]; then
    forge build --sizes
else
    forge build
fi

# ---------------------------------------------------------------------------
# Отчёт о размерах (если --sizes)
# ---------------------------------------------------------------------------
if [[ "${USE_SIZES}" -eq 1 ]]; then
    echo ""
    echo "==> Contract sizes (EIP-170 limit = 24576 bytes)"

    # forge build --sizes сам печатает таблицу; здесь — резюме
    OVERSIZE=$(forge build --sizes 2>&1 | grep -E '^\|.*\| (exceed|too large)' || true)
    if [[ -n "${OVERSIZE}" ]]; then
        echo ""
        echo "WARNING: some contracts exceed EIP-170 limit:" >&2
        echo "${OVERSIZE}" >&2
        exit 1
    fi
fi

echo ""
echo "build complete."