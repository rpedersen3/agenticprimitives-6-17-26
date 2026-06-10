# Security & audit — index

> **Source of truth for finding status:** [`findings.yaml`](./findings.yaml). Prose docs describe; the
> ledger decides. CI (`check:audit-freshness`) fails if a finding marked closed isn't actually in source.

## Start here

| Read | For |
| --- | --- |
| [`findings.yaml`](./findings.yaml) | Current status of every first-class finding (id, severity, status, source-linked). |
| [`2026-06-10-production-readiness-audit.md`](./2026-06-10-production-readiness-audit.md) | **Latest full pass (post-remediation)** — all 29 packages + all 42 contracts re-audited after the 2026-06-10 remediation wave; verifies CA-F1 / AN-1-ONCHAIN / ATT-1 closures in source; current production-blocker list. |
| [`2026-06-10-contract-by-contract-audit.md`](./2026-06-10-contract-by-contract-audit.md) | Contract-layer deep dive — independent per-contract review of all 42 `.sol` files (corrected severities + remediation roadmap). Closure deltas tracked in the production-readiness audit + ledger. |
| [`../architecture/product-readiness-audit.md`](../architecture/product-readiness-audit.md) | Living system-level readiness verdict + backlog. |
| [`audit-evidence-index.md`](./audit-evidence-index.md) | "What proves what" — the artifact/evidence map. |

## CI gates (the dossier can't lie)

- `check:audit-freshness` — every `findings.yaml` entry's `concerns` path exists; a `closed`/`accepted-risk`
  finding's `anchor` must appear in source. Status can't drift from code.
- `check:audit-stub-drift` — an `AUDIT.md` may not say "STUB" over a non-trivial `src/` (closes ARCH-1).
- Both run in `check:all` + `check:all-publish`. Plus the SAST/supply-chain workflow (CodeQL, Slither,
  Solhint, Halmos, `pnpm audit`, gitleaks, SBOM) and the EIP-712 typehash-equality + storage-layout gates.

## Living reference docs

| Doc | Scope |
| --- | --- |
| [`threat-model.md`](./threat-model.md) | STRIDE per trust boundary. |
| [`architecture-diagram.md`](./architecture-diagram.md) | System / trust-boundary map. |
| [`evidence-checklist.md`](./evidence-checklist.md) | Per-control closure checklist. |
| [`r9-static-analysis-triage.md`](./r9-static-analysis-triage.md) | Slither / Aderyn triage on master. |
| [`supply-chain.md`](./supply-chain.md) | Supply-chain workflow + accepted-CVE register. |
| [`../architecture/dtk-alignment-audit.md`](../architecture/dtk-alignment-audit.md) | DTK / ERC-7710 parity. |
| [`_template.md`](./_template.md) | Canonical per-package `AUDIT.md` shape. |

## Per-package audit notes

Every package under `packages/*` and the relying apps under `apps/*` carry an `AUDIT.md` (per-package
charter, invariants, findings, test posture, accepted limitations). They are the second living layer;
`check:audit-stub-drift` keeps them from going stale-as-stub over shipped code.

## Archive

Historical, immutable audit snapshots live under [`archive/`](./archive/) (the 2026-06-09 independent
audits, the frozen 2026-06-03 public-review packet, the R10 readiness assessment, the pre-R9 ledgers).
Anything there that conflicts with current source is superseded by `findings.yaml`.
