---
'@agenticprimitives/contracts': patch
---

R6.9 — Per-contract coverage aggregator (`pnpm coverage:contracts`).

### Why

R6.1 recon § 3.1 identified that `forge coverage --ir-minimum
--report summary` produces a summary TABLE that **silently skips**
the security-critical contracts (AgentAccount, AgentAccountFactory,
SmartAgentPaymaster, UniversalSignatureValidator, DelegationManager,
CustodyPolicy, the 5 enforcers). The table renders ~10 contracts
when 28 exist under `src/`.

R6.9 finding: **the LCOV report (`--report lcov`) DOES include all
28 contracts.** Only the summary-table rendering hides them.

### What

New `scripts/coverage-contracts.ts` + two pnpm scripts:

- `pnpm coverage:contracts` — runs `forge coverage --ir-minimum
  --report lcov`, parses the LCOV output, emits a per-contract
  JSON + markdown summary.
- `pnpm coverage:contracts:no-run` — reuses the existing
  `lcov.info` (skips the ~2-min forge coverage run).

Output:
- `packages/contracts/coverage-r6-9.json` (gitignored) — full
  per-contract data + category rollups + overall.
- Markdown table on stdout — ready to paste into PRs / audit docs.

### Current baseline (R6.9 + master)

Overall: **28 contracts · 79.0% lines · 60.2% branches · 80.4% functions.**

Per-category rollups:

| Category | Contracts | Lines | Branches |
|---|---:|---:|---:|
| security-critical | 11 | 82.1% | 57.4% |
| core | 1 | 100.0% | 100.0% |
| naming-ontology | 7 | 71.2% | 61.0% |
| identity | 3 | 79.6% | 50.0% |
| governance | 2 | 97.8% | 66.7% |
| library | 4 | 77.7% | 79.5% |

### Highlighted findings

- **Below the 70% security-critical line floor:** SmartAgentPaymaster
  at 50.9% (clear R6.10 target).
- DelegationManager (95.8%), AgentAccount (90.6%), AgentAccountFactory
  (100%), UniversalSignatureValidator (94.4%) all comfortably above.
- CustodyPolicy 70.1% lines but **30.0% branches** — secondary
  R6.10 target (high cyclomatic complexity).
- The 5 enforcers all in the 75-100% lines range.

### Gate posture

The gate is **INFORMATIONAL today** — R6.9 does not fail CI on
critical-contract gaps because R6.10 hasn't run yet. The summary is
intended as evidence for an external auditor's review of the test
pack.

After R6.10 closes the named gaps, R6.9's `RATCHET_ENABLED` flag
flips to `true` and the security-critical floor enforces.

### Existing tooling preserved

The existing `pnpm check:forge-coverage` ratchet (per-contract
accepted-debt list with hard floors) continues to run unchanged.
R6.9 is additive — it surfaces visibility for the security-critical
layer; `check:forge-coverage` continues to enforce baseline floors
on the contracts that DO appear in the summary table.

### Audit doc

"Forge coverage in CI with thresholds" row marked PARTIAL CLOSED.
