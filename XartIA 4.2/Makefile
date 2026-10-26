# =============================================================================
# XartIA Makefile — D.2.01.10
# =============================================================================
SHELL   := /bin/bash
NETWORK ?= amoy

.PHONY: all build clean \
        test test-unit test-fuzz test-invariant test-crash test-integration test-gas test-all coverage \
        fmt lint \
        deploy deploy-amoy deploy-mainnet init finalize verify \
        python-test python-sim python-calibrate python-audit \
        help

all: build test-all

# -----------------------------------------------------------------------------
# Build
# -----------------------------------------------------------------------------
build:
	forge build --sizes

clean:
	rm -rf out cache broadcast
	rm -rf node_modules .venv
	rm -rf deployments/local.json deployments/*.local.json

# -----------------------------------------------------------------------------
# Tests (T.1–T.6)
# -----------------------------------------------------------------------------
test:
	forge test

test-unit:
	forge test --match-path 'test/unit/*'

test-fuzz:
	FOUNDRY_FUZZ_RUNS=10000 forge test --match-path 'test/fuzz/*'

test-invariant:
	FOUNDRY_INVARIANT_RUNS=1000 FOUNDRY_INVARIANT_DEPTH=100 \
		forge test --match-path 'test/invariant/*'

test-crash:
	forge test --match-path 'test/crash/*'

test-integration:
	forge test --match-path 'test/integration/*'

test-gas:
	forge test --match-path 'test/gas/*' -vv

test-all: test-unit test-fuzz test-invariant test-crash test-integration test-gas

coverage:
	forge coverage --report lcov --report summary

# -----------------------------------------------------------------------------
# Format / lint
# -----------------------------------------------------------------------------
fmt:
	forge fmt
	npx prettier --write 'contracts/**/*.sol' 'test/**/*.sol' 'script/**/*.sol'

fmt-check:
	npx prettier --check 'contracts/**/*.sol' 'test/**/*.sol' 'script/**/*.sol'

lint:
	npx solhint 'contracts/**/*.sol' 'test/**/*.sol' 'script/**/*.sol'

# -----------------------------------------------------------------------------
# Deploy (D.1.01.01 / D.1.01.02 / D.1.01.07)
# -----------------------------------------------------------------------------
deploy-amoy:
	NETWORK=amoy bash scripts/shell/deploy.sh

deploy-mainnet:
	@echo "⚠️  MAINNET deploy requires manual confirmation (scripts/shell/deploy.sh)"
	NETWORK=polygon bash scripts/shell/deploy.sh

deploy: deploy-amoy

init:
	NETWORK=$(NETWORK) forge script script/Initialize.s.sol \
		--rpc-url $$(grep '^rpc_url' config/$(NETWORK).toml | cut -d'"' -f2) \
		--private-key $$PRIVATE_KEY \
		--broadcast \
		--verify

finalize:
	NETWORK=$(NETWORK) forge script script/Finalize.s.sol \
		--rpc-url $$(grep '^rpc_url' config/$(NETWORK).toml | cut -d'"' -f2) \
		--private-key $$PRIVATE_KEY \
		--broadcast

verify:
	NETWORK=$(NETWORK) bash scripts/shell/verify.sh

# -----------------------------------------------------------------------------
# Python (E.2.*, E.3.*, S.1.*)
# -----------------------------------------------------------------------------
python-test:
	python -m pytest e/02_simulation/ scripts/python/ -v

python-sim:
	python scripts/python/simulate.py --scenario mass_exit --pct 50

python-calibrate:
	python scripts/python/calibrate.py \
		--targets config/calibration-targets.json \
		--output e/03_calibration/

python-audit:
	python scripts/python/audit_math.py

# -----------------------------------------------------------------------------
# Help
# -----------------------------------------------------------------------------
help:
	@echo ""
	@echo "XartIA Makefile targets"
	@echo "======================"
	@echo ""
	@echo "  build            — forge build --sizes"
	@echo "  clean            — удалить out/, cache/, node_modules/, .venv/"
	@echo ""
	@echo "  test             — forge test (все)"
	@echo "  test-unit        — test/unit/*"
	@echo "  test-fuzz        — test/fuzz/* (10 000 runs)"
	@echo "  test-invariant   — test/invariant/* (1000 runs × 100 depth)"
	@echo "  test-crash       — test/crash/*"
	@echo "  test-integration — test/integration/*"
	@echo "  test-gas         — test/gas/* -vv"
	@echo "  test-all         — unit + fuzz + invariant + crash + integration + gas"
	@echo "  coverage         — forge coverage (lcov + summary)"
	@echo ""
	@echo "  fmt              — forge fmt + prettier"
	@echo "  fmt-check        — prettier check (CI)"
	@echo "  lint             — solhint"
	@echo ""
	@echo "  deploy-amoy      — деплой на Amoy (NETWORK=amoy)"
	@echo "  deploy-mainnet   — деплой на Polygon (требует подтверждения)"
	@echo "  init             — initializeLevels + initializePoolPrice + registerParams"
	@echo "  finalize         — передача ownership на safe"
	@echo "  verify           — верификация на Polygonscan"
	@echo ""
	@echo "  python-test      — pytest для e/02_simulation/ + scripts/python/"
	@echo "  python-sim       — запустить массовый выход (50%)"
	@echo "  python-calibrate — калибровка параметров кривой"
	@echo "  python-audit     — property-based audit математики"
	@echo ""