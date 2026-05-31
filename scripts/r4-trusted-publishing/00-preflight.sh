#!/usr/bin/env bash
# R4 preflight — verify environment + repo state before touching npm.

set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

echo "── R4 preflight ─────────────────────────────"

# 1. CLI versions
NPM_V=$(npm --version)
NODE_V=$(node --version | sed 's/^v//')
echo "  npm  : $NPM_V"
echo "  node : $NODE_V"
echo "  gh   : $(gh --version | head -1)"

# Soft version check — fail loudly if too old.
NPM_MAJOR=$(echo "$NPM_V" | cut -d. -f1)
NPM_MINOR=$(echo "$NPM_V" | cut -d. -f2)
if [ "$NPM_MAJOR" -lt 11 ] || { [ "$NPM_MAJOR" -eq 11 ] && [ "$NPM_MINOR" -lt 10 ]; }; then
  echo "  ✗ npm $NPM_V too old; need ≥ 11.10.0 for \`npm trust\`."
  echo "    Run:  npm install -g npm@^11.10.0"
  exit 1
fi

NODE_MAJOR=$(echo "$NODE_V" | cut -d. -f1)
if [ "$NODE_MAJOR" -lt 22 ]; then
  echo "  ✗ node $NODE_V too old; Trusted Publishing requires ≥ 22.14.0."
  exit 1
fi

# 2. npm scope ownership
NPM_USER=$(npm whoami 2>/dev/null || echo "")
if [ -z "$NPM_USER" ]; then
  echo "  ✗ Not logged in to npm.  Run \`npm login\` and try again."
  exit 1
fi
echo "  npm whoami    : $NPM_USER"

if ! npm org ls agenticprimitives 2>/dev/null | grep -q "$NPM_USER"; then
  echo "  ✗ \`$NPM_USER\` is not listed in the agenticprimitives npm org."
  echo "    Verify scope ownership at https://www.npmjs.com/settings/agenticprimitives/members"
  exit 1
fi
echo "  scope owner   : ok ($NPM_USER ∈ agenticprimitives)"

# 3. gh auth + repo
gh auth status >/dev/null || { echo "  ✗ gh not authenticated. Run \`gh auth login\`."; exit 1; }
echo "  gh auth       : ok"

# 4. R4.1–R4.4 PRs merged to master.
echo ""
echo "── R4.1–R4.4 merge status ─────────────────────"
for pr in 17 18 19 20; do
  STATE=$(gh pr view "$pr" --json state -q .state 2>/dev/null || echo "MISSING")
  printf "  PR #%-2d : %s\n" "$pr" "$STATE"
  if [ "$STATE" != "MERGED" ]; then
    echo ""
    echo "  ✗ PR #$pr is not MERGED yet. Merge R4.1–R4.4 before continuing."
    exit 1
  fi
done

# 5. On master + clean
BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [ "$BRANCH" != "master" ]; then
  echo "  ⚠ current branch is \`$BRANCH\`; expected \`master\`."
  echo "    Continue anyway (y/N)?"
  read -r CONFIRM
  [ "$CONFIRM" = "y" ] || exit 1
fi

git fetch origin master --quiet
LOCAL_SHA=$(git rev-parse HEAD)
ORIGIN_SHA=$(git rev-parse origin/master)
if [ "$LOCAL_SHA" != "$ORIGIN_SHA" ]; then
  echo "  ⚠ local HEAD ($LOCAL_SHA) != origin/master ($ORIGIN_SHA). Run \`git pull\` first."
  exit 1
fi
echo ""
echo "  ✓ all preflight checks passed."
