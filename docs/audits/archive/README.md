# Audit archive — historical snapshots

These are **immutable, point-in-time** audit artifacts. They are kept for provenance only and are **not
maintained**. The authoritative, current security status lives in:

- [`../findings.yaml`](../findings.yaml) — the machine-readable finding ledger (CI-enforced fresh).
- [`../../architecture/product-readiness-audit.md`](../../architecture/product-readiness-audit.md) — the living system tracker.

Anything in these snapshots that conflicts with current source is **superseded** by `findings.yaml`.

## Contents

### `2026-06-09/` — independent audit + remediation log
- `2026-06-09-independent-package-audit.md` — independent package audit (DEL-001, VC-1/2, AN-1, KC-001, CN-1, CA-001, …).
- `2026-06-09-independent-contracts-audit.md` — independent contracts audit (SC-1..SC-5).
- `2026-06-09-remediation-status.md` — the closure log for the above. **Reconciled into `findings.yaml`** (note: its
  DEL-001 entry describes a pre-activation state — DEL-001 is now closed + live).

### `2026-06-03/` — frozen public-review packet (tag/commit `a2ebfa0`)
- `self-audit-2026-06.md`, `validation-results-2026-06.md`, `open-review-2026-06.md`, `bug-bounty-2026-06.md`.

### `2026-06-01/` — R10 internal readiness
- `2026-06-01-r10-internal-readiness-assessment.md` — the P0–P3 readiness backlog; the still-open item (disclosed
  testnet deployer, N1) is tracked as `CON-FACTORY-001` in `findings.yaml`.

### `2026-05/` — pre-R9 ledgers + recon
- `2026-05-packages-contracts-production-readiness.md` (the large 193-row pre-R9 tracker),
  `2026-05-pre-production-readiness.md`, `r6-contracts-recon-2026-05-31.md`, `sso-wave-audit-findings.md`.
