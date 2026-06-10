# @agenticprimitives/fulfillment — Claude guide

> **Status:** Foundational (W1) — code shipped; not production enforcement. See [AUDIT.md](./AUDIT.md).

## What this package owns

**Spine Layers 10–12 (FulfillmentCase + Task lifecycle + Artifact)** — per [spec 244](../../specs/244-fulfillment.md).

- **`FulfillmentCase` operational container** — per-Agreement, lifecycle state machine (`drafted` → ... → `archived`), participant set, task topology (linear / parallel / DAG), payment binding, visibility, JV ref, trace span root.
- **`Task` re-export + case binding** — from `@agenticprimitives/mcp-runtime/a2a` per spec 245 §11; the A2A Task state machine is implemented in `mcp-runtime`; this package adds `parentCaseId` + lifecycle synchronization.
- **`Message` + `Artifact`** — re-exported from `mcp-runtime/a2a`; this package adds case-level binding + promotion path.
- **`HandoffPolicy`** — `allowedTargetAgents` + `allowedAgentClasses` + `requiresUserApproval` + `preservePrivacyTier` + `allowedScopes` + `maxHopCount`. First-class authority binding for cross-agent handoffs.
- **`EvidenceCredential`** — Artifact promotion to attestation per [ADR-0023](../../docs/architecture/decisions/0023-attestation-registry-eas-aligned-bilateral-consent.md) (holder-only revoke).
- **`OutcomeCredential`** — outcome assertion with mandatory `EvidenceCredential` citation (FLF-OUT-1 + D-40).
- **`IntentTraceSpan` emission** — typed trace spans per ADR-0024 Decision 7 (lives in `mcp-runtime` runtime; spec 244 + this package emit).
- **Lifecycle ↔ spec 241 status sync** — `case.lifecycle = 'archived'` requires reconciled `AgreementRegistry` status (FLF-INV-01).

## What this package does NOT own

- **`AgreementCommitment` registration** — `agreements`.
- **`AttestationRegistry.sol` contract** — `attestations`.
- **A2A wire transport** — `mcp-runtime` (per spec 245).
- **Payment execution** — `payments` (PaymentMandate.contextBinding.taskId links Layer 9b ↔ 11 per FLF-INV-11).
- **Validator runtime / validation logic** — Validator agents are external; this package owns the `ValidationCredential` citation + the `OutcomeCredential` assertion path that requires the citation.
- **Workflow orchestration engine** (Temporal / Airflow / DAG runners) — app-layer.

## Read these first

1. [`spec.md`](./spec.md) → [`specs/244-fulfillment.md`](../../specs/244-fulfillment.md)
2. [spec 245 — A2A Task in mcp-runtime](../../specs/245-a2a-task-adoption-in-mcp-runtime.md) — Task substrate
3. [`coordination-substrate.md`](../../docs/architecture/coordination-substrate.md) Layers 10–12
4. [ADR-0023](../../docs/architecture/decisions/0023-attestation-registry-eas-aligned-bilateral-consent.md) (EvidenceCredential + OutcomeCredential rows)
5. [`privacy-and-self-sovereign-identity.md`](../../docs/architecture/privacy-and-self-sovereign-identity.md) §4 Layers 10–12 + D-46 JV residency

## Stable public exports (planned)

`buildFulfillmentCase`, `transitionLifecycle`, `archiveCase`, `transitionTaskState`, `handoffTask`, `postMessage`, `getThread`, `buildArtifact`, `publishArtifact`, `promoteToEvidence`, `buildOutcomeCredential`, `assertOutcome`, `getTraceTree`, `FulfillmentCase`, `HandoffPolicy`, `EvidenceCredential`, `OutcomeCredential`. Re-exports: `Task`, `Message`, `Artifact`, `AgentCard` from `mcp-runtime/a2a`.

## Allowed imports

- `@agenticprimitives/types`, `@agenticprimitives/verifiable-credentials` (type-only), `@agenticprimitives/attestations` (type-only), `@agenticprimitives/agreements` (type-only — for lifecycle sync), `@agenticprimitives/mcp-runtime` (re-exports), `@agenticprimitives/delegation` (type-only — for HandoffPolicy delegation minting), `@agenticprimitives/ontology` (IRI constants)
- `viem`

## Forbidden imports

- `apps/*`
- Vertical vocabulary
- Direct workflow-engine runtime (Temporal / Airflow / Camunda) — apps choose; the substrate is engine-agnostic

## Drift triggers — STOP and route

- "Messages on chain" — **STOP.** A2A-INV-04 + D-46.1. JV only.
- "Artifact body on chain" — **STOP.** A2A-INV-05; hash-anchored only.
- "OutcomeCredential without EvidenceCredential citation" — **STOP.** FLF-OUT-1 + D-40.
- "Skip lifecycle ↔ agreement-status reconciliation" — **STOP.** FLF-INV-01.
- "Handoff without `HandoffPolicy` check" — **STOP.** FLF-INV-09.
- "Handoff to lower-privacy assignee under `preservePrivacyTier = true`" — **STOP.** FLF-INV-10.

## Validate

```bash
pnpm --filter @agenticprimitives/fulfillment typecheck
pnpm --filter @agenticprimitives/fulfillment test
```
