#!/usr/bin/env bash
set -euo pipefail

NETWORK="${NETWORK:-amoy}"
if [[ "$NETWORK" == "polygon" ]]; then
  read -rp "Deploy to MAINNET (polygon)? Type 'yes': " confirm
  [[ "$confirm" == "yes" ]] || { echo "aborted"; exit 1; }
fi

mkdir -p deployments
forge script script/Deploy.s.sol \
  --rpc-url "$(grep '^rpc_url' "config/${NETWORK}.toml" | cut -d'"' -f2)" \
  --private-key "$PRIVATE_KEY" \
  --broadcast