# R4 runbook — npm Trusted Publishing transition

End-to-end checklist for moving the `@agenticprimitives/*` scope from
`NPM_TOKEN`-based publishing to OIDC Trusted Publishing.

PR scaffolding (R4.1–R4.4) lands first; these scripts run after those
PRs merge to `master`. Each script is idempotent and safe to re-run.

## Pre-flight (one-time)

```
npm --version            # must be ≥ 11.10.0 (for `npm trust`)
node --version           # must be ≥ 22.14.0 (Trusted Publishing requires it)
gh --version             # for the merge step at the end
npm whoami               # must print the npm account that owns @agenticprimitives
```

If npm is older than 11.10.0:

```
npm install -g npm@^11.10.0
```

## Order of operations

| # | Script | What it does | Needs |
|---|---|---|---|
| 0 | `00-preflight.sh` | Verifies npm + node versions, npm scope ownership, GH auth, R4.1–R4.4 PRs all merged to master. | npm + gh logged in |
| 1 | `01-dry-run-sweep.sh` | `pnpm install` + `check:all` + build + api-surface + per-package `npm publish --dry-run` for all 17. Surface anything wrong BEFORE touching npm-side state. | clean checkout of master |
| 2 | `02-bootstrap-missing.sh` | One-time short-lived granular token publish of the 16 packages NOT yet on npm. **Interactive** — guides you through generating + revoking the temp token. types@0.1.0-alpha.2 is already published; skipped. | npm scope owner login |
| 3 | `03-configure-trusted-publishing.sh` | `npm trust github` for all 17 packages with the `release.yml` workflow + `allow-publish`. Sleeps 2s between calls per npm's bulk-script guidance. | All 17 packages exist on npm |
| 4 | `04-remove-npm-token.md` | Pre-written PR-ready instructions to delete the `NPM_TOKEN` env block from `release.yml` and verify a publish round trip purely via OIDC. | R4.7 verified clean |
| 5 | `05-merge-version-packages.sh` | Once changesets/action opens the "Version Packages" PR on master, this script merges it via `gh pr merge --squash`. That push triggers the Release workflow → publishes as `alpha` dist-tag via OIDC. | NPM_TOKEN removed; Version Packages PR open |

## Resilience notes

- Every script exits non-zero on any failure; nothing silently skips.
- `02-bootstrap-missing.sh` will not run if any of the 17 already exist
  on npm — it's strictly for the not-yet-published delta.
- `03-configure-trusted-publishing.sh` is idempotent: calling
  `npm trust github` on an already-trusted package is a no-op.
- After running `04` (NPM_TOKEN removal), run `01` again to confirm
  nothing accidentally relied on the legacy auth path.

## Rollback

If anything in `02` or `03` goes sideways before the workflow is
swapped over (`04`), the `NPM_TOKEN` secret is still in place and the
existing release path works. Revert any changes via:

```
gh pr close <pr> --delete-branch    # for any in-flight R4 PR
```

The published 1 package (types@0.1.0-alpha.2) is the only thing on
npm; nothing else is yet live, so a roll-back doesn't strand consumers.
