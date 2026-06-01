# Security & Architecture Audit Index

**Last refreshed:** 2026-06-01 (added R10 internal readiness assessment — `2026-06-01-r10-internal-readiness-assessment.md` — post-R9 wave, with prioritized P0/P1/P2/P3 backlog for the external-audit handoff. Replaces the predecessor `2026-05-packages-contracts-production-readiness.md` as the active tracker for package+contract production readiness.)

## Auditor packet (the third-party-audit-ready dossier)

| Doc | Owner | Purpose |
| --- | --- | --- |
| [`specs/214-production-audit-dossier.md`](../../specs/214-production-audit-dossier.md) | security + architect | **The master spec.** Closure gates + control list + continuous-update protocol. |
| [`threat-model.md`](./threat-model.md) | security-auditor | STRIDE per trust boundary, mapped to packages. (Stale — does not yet cover `demo-jp`, `demo-sso-next`, or specs 232/234/235/236; refresh queued — see ARCH-005 in the pre-production audit below.) |
| [`architecture-diagram.md`](./architecture-diagram.md) | technical-architect-auditor | System map, dependency graph, deployment topology, trust boundaries. (Same staleness — ARCH-005.) |
| [`evidence-checklist.md`](./evidence-checklist.md) | security + architect | Every security control → source + test + audit event + closure status. (Same staleness — ARCH-005.) |
| [`2026-06-01-r10-internal-readiness-assessment.md`](./2026-06-01-r10-internal-readiness-assessment.md) | security + architect (2026-06-01) | **CURRENT — post-R9 internal readiness assessment.** Verifies the third-party assessment against current repo state; surfaces additional gaps; prioritized P0 (audit-blocking, ~1 day) / P1 (production-blocking, ~1 week) / P2 (post-audit) / P3 (polish) backlog. **This is the doc a third-party reviewer of the production library suite reads first.** Supersedes the 2026-05-30 predecessor below as the active tracker. |
| [`2026-05-packages-contracts-production-readiness.md`](./2026-05-packages-contracts-production-readiness.md) | security + architect (2026-05-30) | Predecessor of the R10 doc above. Captured the package + contract findings before the R9 wave; cross-referenced rows folded into the R10 doc with status updates. Kept for historical context. |
| [`2026-05-pre-production-readiness.md`](./2026-05-pre-production-readiness.md) | security + architect (2026-05-29) | App-focused pre-launch audit of `demo-jp` + `demo-sso-next` + consumed packages. 23 SEC + 22 ARCH + 18 D + 37 EXT rows. **The package-/contract-layer subset is now re-cast in the new doc above**; this one remains the tracker for demo-app + deploy-substrate findings (OIDC flows, app handoffs, app vocabulary drift). |

## Auditor agents (Claude Code subagents)

| Agent | Spec | Subagent definition |
| --- | --- | --- |
| security-auditor | [`docs/agents/security-auditor.md`](../agents/security-auditor.md) | [`.claude/agents/security-auditor.md`](../../.claude/agents/security-auditor.md) |
| technical-architect-auditor | [`docs/agents/technical-architect-auditor.md`](../agents/technical-architect-auditor.md) | [`.claude/agents/technical-architect-auditor.md`](../../.claude/agents/technical-architect-auditor.md) |



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
| `@agenticprimitives/connect-auth` | high | [packages/connect-auth/AUDIT.md](../../packages/connect-auth/AUDIT.md) | [specs/200-connect-auth.md](../../specs/200-connect-auth.md) |
| `@agenticprimitives/agent-account` | high | [packages/agent-account/AUDIT.md](../../packages/agent-account/AUDIT.md) | [specs/201-agent-account.md](../../specs/201-agent-account.md) |
| `@agenticprimitives/delegation` | **critical** (keystone) | [packages/delegation/AUDIT.md](../../packages/delegation/AUDIT.md) | [specs/202-delegation.md](../../specs/202-delegation.md) |
| `@agenticprimitives/key-custody` | **critical** (KMS surface) | [packages/key-custody/AUDIT.md](../../packages/key-custody/AUDIT.md) | [specs/203-key-custody.md](../../specs/203-key-custody.md) |
| `@agenticprimitives/tool-policy` | medium | [packages/tool-policy/AUDIT.md](../../packages/tool-policy/AUDIT.md) | [specs/204-tool-policy.md](../../specs/204-tool-policy.md) |
| `@agenticprimitives/mcp-runtime` | high | [packages/mcp-runtime/AUDIT.md](../../packages/mcp-runtime/AUDIT.md) | [specs/205-mcp-runtime.md](../../specs/205-mcp-runtime.md) |
| `@agenticprimitives/account-custody` | high (custody policy ABI + arg builders) | [packages/account-custody/AUDIT.md](../../packages/account-custody/AUDIT.md) | [specs/213-custody-layer-carve-out.md](../../specs/213-custody-layer-carve-out.md) |
| `@agenticprimitives/agent-naming` | medium (Phase 1 — pure SDK + spec; on-chain authority + writes land in Phase 3+) | [packages/agent-naming/AUDIT.md](../../packages/agent-naming/AUDIT.md) | [specs/215-agent-naming.md](../../specs/215-agent-naming.md) |
| `@agenticprimitives/agent-profile` | medium (Phase 1 — HCS-11 typed profile + HCS-14 CAIP-10 alignment + endpoint verification methods; client wires in Phase 2+) | [packages/agent-profile/AUDIT.md](../../packages/agent-profile/AUDIT.md) | [specs/217-agent-profile.md](../../specs/217-agent-profile.md) |
| `@agenticprimitives/agent-relationships` | medium (Phase 1 — trust-fabric edge primitive + role taxonomy; contracts + writes land Phase 3+) | [packages/agent-relationships/AUDIT.md](../../packages/agent-relationships/AUDIT.md) | [specs/216-agent-relationships.md](../../specs/216-agent-relationships.md) |

## Cross-cutting audits

| Topic | Doc |
| --- | --- |
| Supply chain (M7) | [supply-chain.md](./supply-chain.md) — CodeQL SAST + `pnpm audit` + gitleaks + SBOM; CI workflow + local mirror |

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
- **Per-package IDs**: `<PKG>-N` (e.g. `DEL-1`, `KC-1`, `AA-1`, `IA-1`, `MR-1`, `TP-1`, `TYP-1`, `AN-1` agent-naming, `AI-1` agent-identity, `AR-1` agent-relationships). Managed in the package audit.
- Cross-references: system findings appear in the relevant package(s) by ID; package-local findings stay local unless they escalate.
