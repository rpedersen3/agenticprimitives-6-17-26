#!/usr/bin/env bash
# R4.7 — configure npm Trusted Publishing for all 17 packages.
#
# After every package exists on npm (R4.6 took care of any gaps), call
# `npm trust github` so future publishes from this repo's release.yml
# auth via OIDC, no token needed. Idempotent — re-running is a no-op.
#
# Requirements:
#   - npm CLI ≥ 11.10.0
#   - npm whoami must own / be a maintainer on the @agenticprimitives scope
#   - 2FA enabled on the npm account
#   - All 17 packages must already exist on the registry

set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

REPO="agentictrustlabs/agenticprimitives"
WORKFLOW="release.yml"

PACKAGES=(
  "@agenticprimitives/types"
  "@agenticprimitives/audit"
  "@agenticprimitives/connect-auth"
  "@agenticprimitives/connect"
  "@agenticprimitives/key-custody"
  "@agenticprimitives/account-custody"
  "@agenticprimitives/agent-account"
  "@agenticprimitives/delegation"
  "@agenticprimitives/tool-policy"
  "@agenticprimitives/mcp-runtime"
  "@agenticprimitives/agent-naming"
  "@agenticprimitives/agent-profile"
  "@agenticprimitives/agent-relationships"
  "@agenticprimitives/identity-directory"
  "@agenticprimitives/identity-directory-adapters"
  "@agenticprimitives/ontology"
  "@agenticprimitives/contracts"
)

echo "── R4.7 configure Trusted Publishing ────────"
echo "  repo     : $REPO"
echo "  workflow : $WORKFLOW"
echo "  packages : ${#PACKAGES[@]}"
echo ""

DONE=()
FAIL=()
for pkg in "${PACKAGES[@]}"; do
  printf "  %-50s " "$pkg"
  if npm trust github "$pkg" \
       --repo "$REPO" \
       --file "$WORKFLOW" \
       --allow-publish \
       --yes 2>/tmp/r4-trust-err; then
    echo "✓"
    DONE+=("$pkg")
  else
    echo "✗"
    FAIL+=("$pkg")
    sed 's/^/    /' /tmp/r4-trust-err | tail -3
  fi
  # npm's docs recommend a small sleep between bulk calls.
  sleep 2
done

rm -f /tmp/r4-trust-err

echo ""
echo "── Summary ──────────────────────────────────"
echo "  DONE (${#DONE[@]})"
echo "  FAIL (${#FAIL[@]}): ${FAIL[*]}"

if [ ${#FAIL[@]} -gt 0 ]; then
  echo ""
  echo "  Some packages failed. Common causes:"
  echo "    - package doesn't exist on npm yet (rerun 02-bootstrap-missing.sh)"
  echo "    - account lacks publish role for that package"
  echo "    - 2FA not enabled on the npm account"
  exit 1
fi

echo ""
echo "  Next: review scripts/r4-trusted-publishing/04-remove-npm-token.md"
