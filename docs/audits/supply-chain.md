# Supply-Chain Security — workflow, scope, triage

**Closes:** audit finding **M7** (supply-chain + static-analysis gates)
**Last refreshed:** 2026-05-20
**Workflow:** [`.github/workflows/security.yml`](../../.github/workflows/security.yml)
**Local mirror:** `pnpm check:supply-chain`

## What this covers

Four independent scanners run on every PR + push to master + a weekly
schedule. Each is fail-closed on high/critical findings except where
explicitly marked advisory.

| Scanner | What it catches | Failure mode |
| --- | --- | --- |
| **CodeQL** (`security-extended`) | SAST findings in JS/TS — prototype pollution, ReDoS, command-injection, unsafe deserialization, hardcoded credentials, weak crypto, insecure URL parsing | Fails CI on any new high/critical alert |
| **`pnpm audit`** | Known CVEs in npm dependency tree at HIGH or CRITICAL severity | Fails CI |
| **gitleaks** | Committed secrets across full git history — private keys, API tokens, JWT secrets, AWS/GCP creds | Fails CI on any detected secret |
| **CycloneDX SBOM** | Inventory of every npm dep + version (artifact for audit trail) | Advisory only; uploaded as a workflow artifact, never blocks |

## What this does NOT cover

- **Solidity static analysis** — Slither, Mythril, or Foundry's `forge inspect`. Out of scope for this pass; spec/120 will address contract-side SAST separately.
- **Runtime behavior** — supply-chain CI is build-time only. Runtime checks live in the audit-event trail (C3) and the e2e suite.
- **Type-checking** — `tsc --noEmit` already runs in `ci.yml`; supply-chain CI doesn't duplicate.
- **License compliance scanning** — out of scope. SBOM is the input if you want to wire a license checker later.

## How to triage a finding

### CodeQL alert

1. Open the alert in GitHub → Security → Code Scanning.
2. Decide:
   - **Real**: fix the code; the rerun on the next commit will close the alert.
   - **False positive**: dismiss in GitHub UI with a justification (rule produces noise on a benign pattern in this codebase). The dismissal lives in GH state, not in this repo.
   - **Accepted risk**: dismiss with rationale + open a tracking issue. Add an entry to "Accepted findings" below.

### `pnpm audit` finding

1. Read the CVE report (`pnpm audit --json` for machine-readable).
2. Options:
   - **Bump the affected package**: `pnpm update <pkg>` then `pnpm install`. Open a PR.
   - **No fix available yet**: add to "Accepted findings" with the upstream tracking link + expected fix window.
   - **Indirect dep, no direct fix**: use `pnpm.overrides` in the root `package.json` to force a non-vuln version.

### gitleaks finding

1. **Rotate the leaked secret immediately** — don't wait for the fix. Treat the value as exposed.
2. Scrub from git history with `git-filter-repo --replace-text` BEFORE pushing the fix. The history rewrite is destructive; coordinate with anyone else who has a checkout.
3. Add a `.gitleaks.toml` allowlist entry only if the finding was a false positive (e.g. a test fixture that looks like a key).

## Accepted findings

_Empty as of 2026-05-20._ Track each accepted CVE / dismissed alert as a row in the table below with reason + expiry.

| Date | Scanner | Finding | Reason | Re-evaluate by |
| --- | --- | --- | --- | --- |

## Branch protection (manual GitHub UI step)

CI is only load-bearing if PRs can't bypass it. After `security.yml` lands the first time, set:

**Settings → Branches → Branch protection rules → `master`:**

- ☑ Require a pull request before merging
  - ☑ Require approvals (1)
  - ☑ Dismiss stale approvals when new commits are pushed
- ☑ Require status checks to pass
  - Required checks: `validate` (from `ci.yml`), `codeql`, `dep-audit`, `secret-scan`
- ☑ Require branches to be up to date before merging
- ☑ Require linear history
- ☑ Do not allow bypassing the above settings (including for admins)

The `sbom` check is intentionally NOT a required gate (advisory-only).

## Local dev: pre-flight checks

```bash
pnpm check:supply-chain          # runs pnpm audit + gitleaks (if installed)
pnpm check:supply-chain --warn-only   # advisory mode
pnpm check:all                   # full doctrine including supply-chain
```

`gitleaks` is optional locally — install via `brew install gitleaks` or skip. CI is the load-bearing gate.

## Audit-prep export

External reviewers should receive:

- This document
- The latest `sbom-cyclonedx` artifact from GitHub Actions (most recent run on master)
- The system audit (`docs/architecture/product-readiness-audit.md`)
- The per-package `AUDIT.md` files
- Active dismissed alerts (if any) with rationale

## Refresh cadence

- **Per-PR**: full workflow runs automatically.
- **Weekly**: cron-triggered Monday 04:17 UTC — catches new CVEs disclosed over the weekend.
- **Pre-release**: human reviews the latest CodeQL + audit reports as part of the audit refresh process.
- **Quarterly**: re-evaluate every "Accepted findings" row.
