#!/usr/bin/env bash
set -euo pipefail

NETWORK="${NETWORK:-amoy}"
DEP="deployments/${NETWORK}.json"
[[ -f "$DEP" ]] || { echo "missing $DEP"; exit 1; }

jq_get() { python3 -c "import json,sys; print(json.load(open('$DEP'))['$1'])"; }

verify() {
  local addr="$1" name="$2" args="${3:-}"
  echo "verifying $name at $addr"
  forge verify-contract "$addr" "$name" \
    --chain "$(jq_get chainId)" \
    --constructor-args "$args" \
    --etherscan-api-key "$POLYGONSCAN_API_KEY"
}

verify "$(jq_get token)"            "contracts/token/XartIAToken.sol:XartIAToken" ""
verify "$(jq_get levels)"           "contracts/math/Levels.sol:Levels" ""
verify "$(jq_get registry)"         "contracts/core/ParameterRegistry.sol:ParameterRegistry" ""
verify "$(jq_get poolState)"        "contracts/math/PoolState.sol:PoolState" ""
# ReserveManager(usdc, levels)
verify "$(jq_get reserveManager)"   "contracts/reserve/ReserveManager.sol:ReserveManager" \
  "$(cast abi-encode 'f(address,address)' "$(jq_get usdc)" "$(jq_get levels)")"
# Vesting(safe, token)
verify "$(jq_get vesting)"          "contracts/vesting/Vesting.sol:Vesting" \
  "$(cast abi-encode 'f(address,address)' "$(jq_get safe)" "$(jq_get token)")"
# CircuitBreaker(threshold, reserveManager) — threshold из config/amoy.toml
verify "$(jq_get circuitBreaker)"   "contracts/safety/CircuitBreaker.sol:CircuitBreaker" \
  "$(cast abi-encode 'f(uint256,address)' 1000 "$(jq_get reserveManager)")"
verify "$(jq_get timelock)"         "contracts/governance/Timelock.sol:Timelock" ""
# Governance(safe, timelock, registry)
verify "$(jq_get governance)"       "contracts/governance/Governance.sol:Governance" \
  "$(cast abi-encode 'f(address,address,address)' "$(jq_get safe)" "$(jq_get timelock)" "$(jq_get registry)")"
# CurveController(reserveManager, vesting, circuitBreaker, poolState, token, levels, usdc, treasury)
verify "$(jq_get curveController)"  "contracts/controllers/CurveController.sol:CurveController" \
  "$(cast abi-encode 'f(address,address,address,address,address,address,address,address)' \
     "$(jq_get reserveManager)" "$(jq_get vesting)" "$(jq_get circuitBreaker)" \
     "$(jq_get poolState)" "$(jq_get token)" "$(jq_get levels)" \
     "$(jq_get usdc)" "$(jq_get treasury)")"
# PoolController(curveController, reserveManager, circuitBreaker, poolState, token, levels, usdc, treasury)
verify "$(jq_get poolController)"   "contracts/controllers/PoolController.sol:PoolController" \
  "$(cast abi-encode 'f(address,address,address,address,address,address,address,address)' \
     "$(jq_get curveController)" "$(jq_get reserveManager)" "$(jq_get circuitBreaker)" \
     "$(jq_get poolState)" "$(jq_get token)" "$(jq_get levels)" \
     "$(jq_get usdc)" "$(jq_get treasury)")"
verify "$(jq_get factory)"          "contracts/factory/XartIAFactory.sol:XartIAFactory" ""
verify "$(jq_get curveMathWrapper)" "contracts/math/CurveMathWrapper.sol:CurveMathWrapper" ""