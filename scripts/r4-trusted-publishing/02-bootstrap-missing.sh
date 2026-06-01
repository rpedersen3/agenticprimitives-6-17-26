#!/usr/bin/env bash
# R4.6 — one-time bootstrap publish of the 16 packages not yet on npm.
#
# Trusted Publishing (`npm trust github`) requires the package to exist
# on the registry. For brand-new packages we need a one-shot manual
# publish via a short-lived granular token. After this script:
#
#   1. Generate a granular token at npmjs.com (script prompts you).
#   2. Bootstrap-publishes each missing @agenticprimitives/* package
#      at its current version (0.1.0-alpha.2).
#   3. Reminds you to REVOKE the token immediately afterward.
#
# `@agenticprimitives/types` is already published — skipped.

set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

PACKAGES=(
  audit
  connect-auth
  connect
  key-custody
  account-custody
  agent-account
  delegation
  tool-policy
  mcp-runtime
  agent-naming
  agent-profile
  agent-relationships
  identity-directory
  identity-directory-adapters
  ontology
  contracts
)

echo "── R4.6 bootstrap publish ───────────────────"
echo ""
echo "  Will bootstrap 16 packages (types@0.1.0-alpha.2 already on npm)."
echo ""

# Quick check: skip any already-published ones.
TO_PUBLISH=()
for p in "${PACKAGES[@]}"; do
  if curl -s -o /dev/null -w "%{http_code}" "https://registry.npmjs.org/@agenticprimitives/$p" | grep -q '^200$'; then
    echo "  skip  @agenticprimitives/$p (already on npm)"
  else
    TO_PUBLISH+=("$p")
  fi
done

if [ ${#TO_PUBLISH[@]} -eq 0 ]; then
  echo ""
  echo "  ✓ All 16 already published. Run 03-configure-trusted-publishing.sh next."
  exit 0
fi

echo ""
echo "  TO PUBLISH (${#TO_PUBLISH[@]}): ${TO_PUBLISH[*]}"
echo ""
echo "──────────────────────────────────────────────"
echo "STEP 1: generate a short-lived granular token"
echo "──────────────────────────────────────────────"
cat <<'INSTRUCTIONS'

  Open https://www.npmjs.com/settings/<your-user>/tokens

  Click "Generate New Token" → "Granular Access Token"

    Name:                  agenticprimitives-r4-bootstrap
    Expiration:            7 days  (revoke earlier; this is temporary)
    Allowed IP Ranges:     leave empty
    Packages and scopes:   "Read and write" → all packages
    Organizations:         "Read and write" → agenticprimitives
    Require 2FA on this token: OFF

  Copy the npm_... value (only shown once).

INSTRUCTIONS

read -rp "Paste token: " -s NPM_TOKEN
echo ""
echo ""

if [ -z "$NPM_TOKEN" ]; then
  echo "  ✗ No token. Aborting."
  exit 1
fi

# Build packages first so dist/ + ABIs are fresh.
echo "──────────────────────────────────────────────"
echo "STEP 2: build packages"
echo "──────────────────────────────────────────────"
pnpm install --frozen-lockfile
pnpm -r --filter './packages/*' build

# Publish each missing package using the granular token. Use an explicit
# --userconfig so we don't write to the user's permanent ~/.npmrc.
echo ""
echo "──────────────────────────────────────────────"
echo "STEP 3: publish each missing package"
echo "──────────────────────────────────────────────"

TMP_NPMRC=$(mktemp)
chmod 600 "$TMP_NPMRC"
cat > "$TMP_NPMRC" <<EOF
//registry.npmjs.org/:_authToken=$NPM_TOKEN
provenance=true
EOF
trap 'shred -u "$TMP_NPMRC" 2>/dev/null || rm -f "$TMP_NPMRC"' EXIT

DONE=()
FAIL=()
for p in "${TO_PUBLISH[@]}"; do
  echo ""
  echo "── @agenticprimitives/$p ──"
  if (cd "packages/$p" && npm publish \
        --access public \
        --tag alpha \
        --userconfig "$TMP_NPMRC"); then
    DONE+=("$p")
  else
    FAIL+=("$p")
  fi
done

echo ""
echo "──────────────────────────────────────────────"
echo "STEP 4: REVOKE the temporary token"
echo "──────────────────────────────────────────────"
cat <<INSTRUCTIONS

  Open https://www.npmjs.com/settings/<your-user>/tokens
  Click the trash icon on \`agenticprimitives-r4-bootstrap\`.
  Confirm.

INSTRUCTIONS

read -rp "Press Enter once revoked..."

echo ""
echo "── Summary ──────────────────────────────────"
echo "  DONE (${#DONE[@]}): ${DONE[*]}"
echo "  FAIL (${#FAIL[@]}): ${FAIL[*]}"

if [ ${#FAIL[@]} -gt 0 ]; then
  exit 1
fi

echo ""
echo "  Next: 03-configure-trusted-publishing.sh"
