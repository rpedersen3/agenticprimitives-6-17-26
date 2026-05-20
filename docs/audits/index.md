# Security & Architecture Audit Index

**Last refreshed:** 2026-05-20

The agenticprimitives audit lives in two layers:

1. **System-level audit** — cross-cutting risks, app-level findings, and the
   priority backlog. One document:
   [`../architecture/product-readiness-audit.md`](../architecture/product-readiness-audit.md).
2. **Per-package audits** — each `@agenticprimitives/*` package ships its
   own `AUDIT.md` so the package can stand alone as an audit target. An
   external reviewer asked to evaluate ONE package should be able to do
   so by reading just that package's source + its AUDIT.md, with
   cross-references to the system audit for shared concerns.

## Per-package audit docs

| Package | Risk | Audit | Spec |
| --- | --- | --- | --- |
| `@agenticprimitives/types` | low | [packages/types/AUDIT.md](../../packages/types/AUDIT.md) | — |
| `@agenticprimitives/audit` | medium (cross-cutting forensics) | [packages/audit/AUDIT.md](../../packages/audit/AUDIT.md) | [specs/206-audit.md](../../specs/206-audit.md) (TODO) |
| `@agenticprimitives/identity-auth` | high | [packages/identity-auth/AUDIT.md](../../packages/identity-auth/AUDIT.md) | [specs/200-identity-auth.md](../../specs/200-identity-auth.md) |
| `@agenticprimitives/agent-account` | high | [packages/agent-account/AUDIT.md](../../packages/agent-account/AUDIT.md) | [specs/201-agent-account.md](../../specs/201-agent-account.md) |
| `@agenticprimitives/delegation` | **critical** (keystone) | [packages/delegation/AUDIT.md](../../packages/delegation/AUDIT.md) | [specs/202-delegation.md](../../specs/202-delegation.md) |
| `@agenticprimitives/key-custody` | **critical** (KMS surface) | [packages/key-custody/AUDIT.md](../../packages/key-custody/AUDIT.md) | [specs/203-key-custody.md](../../specs/203-key-custody.md) |
| `@agenticprimitives/tool-policy` | medium | [packages/tool-policy/AUDIT.md](../../packages/tool-policy/AUDIT.md) | [specs/204-tool-policy.md](../../specs/204-tool-policy.md) |
| `@agenticprimitives/mcp-runtime` | high | [packages/mcp-runtime/AUDIT.md](../../packages/mcp-runtime/AUDIT.md) | [specs/205-mcp-runtime.md](../../specs/205-mcp-runtime.md) |

## Template + process

- [`_template.md`](./_template.md) — the canonical structure every package audit follows.
- New PR rule (TODO: enforce in `scripts/check-all.ts`): any PR touching `packages/<name>/src/index.ts` must also update `packages/<name>/AUDIT.md`'s "Last refreshed" date and findings table.

## Audit refresh cadence

- **Per-PR**: update the affected package's `AUDIT.md` when public API, security invariants, or test posture changes.
- **Per-phase**: refresh the system audit at the end of each named hardening phase (e.g. "Phase 5 refresh" landed 2026-05-20).
- **Quarterly**: full pass across all per-package audits + system audit. Re-prioritize findings.
- **Pre-release**: every public release (alpha/beta/rc/ga) gets a dedicated audit refresh.

## What lives where

| Concern | System audit | Per-package audit |
| --- | --- | --- |
| Cross-package risk (e.g. C1 service-auth gap) | ✓ (the master list) | ✓ (cross-reference by ID, in the package(s) that own implementation) |
| Package-local finding too narrow for system view | — | ✓ (use `<PKG>-N` ID, e.g. `DEL-1`) |
| App-level finding (e.g. demo-mcp `/_dev/seed`) | ✓ | — (the package wouldn't carry this) |
| Roadmap / priority ranking | ✓ (top-5 + checklist) | — (refer to system) |
| Charter / scope exclusions | — (refer to package) | ✓ |
| Test posture per package | — (summary only) | ✓ (detailed) |
| External audit readiness checklist | — | ✓ (per package) |

## Findings ID space

- **System IDs**: `C1`–`Cn` (critical), `H1`–`Hn` (high), `M1`–`Mn` (medium), `L1`–`Ln` (low), `N1`–`Nn` (new, raised after the initial draft). Managed in the system audit.
- **Per-package IDs**: `<PKG>-N` (e.g. `DEL-1`, `KC-1`, `AA-1`, `IA-1`, `MR-1`, `TP-1`, `TYP-1`). Managed in the package audit.
- Cross-references: system findings appear in the relevant package(s) by ID; package-local findings stay local unless they escalate.
