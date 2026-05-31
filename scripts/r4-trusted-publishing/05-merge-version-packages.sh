#!/usr/bin/env bash
# R4.9 — merge the Changesets-generated "Version Packages" PR.
#
# changesets/action@v1 watches the master branch for unconsumed
# changeset .md files. When it finds one, it opens a PR titled
# "chore(release): version packages" that bumps versions + writes
# CHANGELOGs. Merging that PR is what actually publishes — the post-
# merge push runs release.yml's release job which authenticates via
# OIDC Trusted Publishing (post-R4.8) and ships everything.
#
# This script:
#   1. Finds the open "Version Packages" PR.
#   2. Shows you the diff summary so you can spot-check the bumps.
#   3. Squash-merges it.
#   4. Tells you what to watch in the resulting Release workflow run.

set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

REPO="agentictrustlabs/agenticprimitives"

echo "── R4.9 merge Version Packages PR ───────────"
echo ""

PR_NUM=$(gh pr list \
  --repo "$REPO" \
  --state open \
  --search "chore(release): version packages" \
  --json number \
  --jq '.[0].number' 2>/dev/null || true)

if [ -z "$PR_NUM" ] || [ "$PR_NUM" = "null" ]; then
  echo "  ✗ No open 'chore(release): version packages' PR found."
  echo ""
  echo "  Possible reasons:"
  echo "    - changesets/action hasn't run yet on master (wait for the next push)"
  echo "    - all changeset .md files in .changeset/ have already been consumed"
  echo "    - the action ran but failed (check the most recent Release workflow run)"
  exit 1
fi

echo "  Found PR #$PR_NUM"
echo ""

# Show the version bumps it proposes.
echo "── version bumps proposed ──"
gh pr diff "$PR_NUM" --repo "$REPO" | grep -E '^\+.*"version":' | sed 's/^/    /' || true

echo ""
echo "── full diff summary ──"
gh pr view "$PR_NUM" --repo "$REPO" --json files --jq '.files[].path' | head -30
echo ""

read -rp "Squash-merge PR #$PR_NUM? (y/N) " CONFIRM
[ "$CONFIRM" = "y" ] || { echo "  Aborted."; exit 1; }

gh pr merge "$PR_NUM" --repo "$REPO" --squash --delete-branch

echo ""
echo "  ✓ Merged PR #$PR_NUM."
echo ""
echo "── what to watch next ──"
cat <<INSTRUCTIONS

  1. The push to master triggers the Release workflow.

  2. Watch the run:
        gh run list -R $REPO --workflow=Release --limit 1
        gh run view <run-id> -R $REPO --log-failed   # if anything goes red

  3. Expected step sequence:
        - validate (full CI gate)              ✓
        - release / install                    ✓
        - release / build packages             ✓
        - release / Publish via changesets     ✓  (OIDC auth, provenance signed)
        - release / SBOM                       ✓  (cdxgen)
        - release / Attach SBOM                ✓  (GH Release tag created)

  4. Verify on npm:
        for p in types audit connect-auth connect key-custody \\
                 account-custody agent-account delegation tool-policy \\
                 mcp-runtime agent-naming agent-profile agent-relationships \\
                 identity-directory identity-directory-adapters ontology contracts; do
          npm view "@agenticprimitives/\$p" version
        done

  All 17 should report the new alpha version. Provenance attestations
  visible at https://search.sigstore.dev (search the workflow's run ID).

INSTRUCTIONS
