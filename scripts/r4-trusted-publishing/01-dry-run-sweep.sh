#!/usr/bin/env bash
# R4.5 — local dry-run sweep. Catches packaging / metadata / build
# issues BEFORE any npm-side action.

set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

echo "── R4.5 dry-run sweep ───────────────────────"

echo ""
echo "── 1. clean install ─"
pnpm install --frozen-lockfile

echo ""
echo "── 2. doctrine ─"
pnpm check:all

echo ""
echo "── 3. build all packages ─"
pnpm -r --filter './packages/*' build

echo ""
echo "── 4. api surface gate ─"
pnpm check:api-surface

echo ""
echo "── 5. per-package publish --dry-run ─"
# Per-package loop because `pnpm -r publish --dry-run` historically
# bails on the first failure. We want to see ALL failures in one pass.
FAIL=()
for pkg_dir in packages/*/; do
  pkg_name=$(node -p "require('./$pkg_dir/package.json').name")
  pkg_priv=$(node -p "require('./$pkg_dir/package.json').private || false")
  if [ "$pkg_priv" = "true" ]; then
    echo "  skip $pkg_name (private)"
    continue
  fi
  printf "  %-50s " "$pkg_name"
  if (cd "$pkg_dir" && npm publish --dry-run --no-git-checks --access public --tag alpha > /tmp/r4-dry-run-out 2>&1); then
    echo "✓"
  else
    echo "✗"
    FAIL+=("$pkg_name")
    echo "    ─── $pkg_name dry-run error ─────────────"
    sed 's/^/    /' /tmp/r4-dry-run-out | tail -10
    echo ""
  fi
done

rm -f /tmp/r4-dry-run-out

if [ ${#FAIL[@]} -gt 0 ]; then
  echo ""
  echo "  ✗ ${#FAIL[@]} package(s) failed dry-run: ${FAIL[*]}"
  exit 1
fi

echo ""
echo "  ✓ all packages dry-run clean."
