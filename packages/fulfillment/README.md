# @agenticprimitives/fulfillment

> **Status: STUB** (Wave 0.5 of the W1 implementation wave). State machines, types, and invariant guards ship today; the full fulfillment runtime lands in Wave 7b per the [w1 implementation wave plan](../../docs/architecture/w1-implementation-wave-plan.md).

An agreement between two agents is worthless if no one can say, afterward, what actually happened. Who did the work, who was it handed to, what did they produce, and does the outcome match what was promised? Agent frameworks orchestrate tasks; almost none of them produce *evidence*. This package is the designed answer: a `FulfillmentCase` container where every task, message, artifact, and handoff is bound to canonical Smart Agent identities, gated by typed policy, and promoted into credentials — an `OutcomeCredential` that cannot exist without citing the `EvidenceCredential` backing it. The claim "we delivered" is structurally forced to point at proof.

This is the fulfillment slice of the substrate — spine Layers 10–12, spec'd in full, scaffolded now, landing in the implementation waves — and it shares one trust chain with the delegations that authorize the work and the payment mandates that settle it.

Part of [agenticprimitives](../../README.md) — the trust substrate for the agent economy: one canonical Smart Agent identity with custody, delegation, naming, credentials, and audit evidence designed as one system.

## What ships today

Types, state machines, and invariant guards — no runtime, storage, or credential issuance yet:

- **`FulfillmentCase` type + lifecycle state machine** — thirteen states (`drafted` → … → `archived` / `canceled` / `disputed`) with `canTransition` enforcing legal edges. Note: transitions are shape-checked only; actor authorization is wave work.
- **A2A `Task` state machine** — `canTaskTransition` per spec 245, including the `auth-required` suspension loop for tasks awaiting a fresh delegation.
- **`HandoffPolicy` type + `isHandoffAllowed`** — typed authority binding for cross-agent handoffs. Today's check covers the agent/class allowlists only; `requiresUserApproval`, `preservePrivacyTier`, `allowedScopes`, and `maxHopCount` enforcement is wave work (tracked openly as NEW-FLF-1 in the [findings ledger](../../docs/audits/findings.yaml)).
- **`Artifact` + `OutcomeCredentialSubject` types** — hash-anchored artifacts (body never on-chain) and `assertOutcomeCitations`, the FLF-OUT-1 guard: an outcome with zero evidence citations throws.
- **`IntentTraceSpan`** — typed trace spans (parse / resolve / handoff / tool_call / user_approval / …) for end-to-end execution forensics.

## What lands in the waves (designed, not shipped)

The operational runtime: `buildFulfillmentCase`, `transitionLifecycle` with actor authorization, `handoffTask` with full policy enforcement, message threads, artifact publication, `promoteToEvidence` / `assertOutcome` credential issuance into the attestation layer, trace-tree assembly, and lifecycle ↔ agreement-status reconciliation (FLF-INV-01). Workflow engines stay app-layer; this package is engine-agnostic.

## Where this is heading / market context

- **Google A2A** defines the Task/Message/Artifact wire model; we adopt it (via `mcp-runtime`, spec 245) rather than invent a rival — this package adds the case container, handoff policy, and evidence promotion A2A leaves out.
- **Google AP2 and x402** give agents payment mandates; a `FulfillmentCase` binds those mandates to the tasks they pay for (`ContextBinding.taskId`, FLF-INV-11), so a machine payment is never unmoored from the work it settled.
- The differentiated combination: task execution, handoff authority, payment binding, and outcome evidence under **one** delegation + custody + audit substrate — the seam where stitched stacks lose the thread is exactly what Layers 10–12 are designed to hold.

**Authoritative spec:** [spec 244 — fulfillment](../../specs/244-fulfillment.md) (see [`spec.md`](./spec.md)). Owns spine layers 10–12; bounded surface in `CLAUDE.md` and `capability.manifest.json`.

## Build

```bash
pnpm --filter @agenticprimitives/fulfillment typecheck
pnpm --filter @agenticprimitives/fulfillment test
pnpm --filter @agenticprimitives/fulfillment build
```

## Status — honest version

STUB. What ships is the typed skeleton plus pure guards; everything operational is wave work, and the two known enforcement gaps (handoff policy fields, transition authorization) are logged publicly in [`docs/audits/findings.yaml`](../../docs/audits/findings.yaml) rather than papered over. Wave sequencing: [w1-implementation-wave-plan.md](../../docs/architecture/w1-implementation-wave-plan.md).
