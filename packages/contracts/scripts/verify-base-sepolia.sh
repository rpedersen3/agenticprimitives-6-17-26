#!/usr/bin/env bash
# verify-base-sepolia.sh — verify every deployed contract on Base Sepolia
# against the published flattened sources.
#
# Closure: EXT3-001 (publishable verification per chain).
#
# Inputs (env):
#   BASESCAN_API_KEY  — required
#   BASE_SEPOLIA_RPC  — required for compiler-input reconstruction
#
# Reads deployments-base-sepolia.json + iterates each contract.

set -euo pipefail

: "${BASESCAN_API_KEY:?BASESCAN_API_KEY required}"
: "${BASE_SEPOLIA_RPC:?BASE_SEPOLIA_RPC required}"

cd "$(dirname "$0")/.."

DEPLOYMENTS="deployments-base-sepolia.json"
if [ ! -f "$DEPLOYMENTS" ]; then
  echo "ERROR: $DEPLOYMENTS missing. Run \`pnpm deploy:base-sepolia\` first."
  exit 1
fi

CHAIN_ID=84532
VERIFIER_URL="https://api-sepolia.basescan.org/api"

# Each contract entry — extend as more land. Pattern:
#   contract_name address [constructor-args-shape]
contracts=(
  "EntryPoint:entryPoint"
  "AgentAccount:agentAccountImpl"
  "AgentAccountFactory:agentAccountFactory"
  "DelegationManager:delegationManager"
  "CustodyPolicy:custodyPolicy"
  "SmartAgentPaymaster:paymaster"
  "UniversalSignatureValidator:universalSignatureValidator"
  "ApprovedHashRegistry:approvedHashRegistry"
  "AgentNameRegistry:agentNameRegistry"
)

for entry in "${contracts[@]}"; do
  name="${entry%%:*}"
  key="${entry##*:}"
  addr=$(jq -r ".${key} // empty" "$DEPLOYMENTS")
  if [ -z "$addr" ] || [ "$addr" = "null" ]; then
    echo "SKIP $name — not in $DEPLOYMENTS"
    continue
  fi
  echo "VERIFY $name @ $addr"
  forge verify-contract \
    --chain-id "$CHAIN_ID" \
    --verifier-url "$VERIFIER_URL" \
    --etherscan-api-key "$BASESCAN_API_KEY" \
    "$addr" \
    "src/${name}.sol:${name}" || echo "WARN $name verification failed (may already be verified)"
done

echo "Done. Re-run with \`forge verify-check\` to confirm propagation."
