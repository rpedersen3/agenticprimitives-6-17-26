# Spec 269 — Async, Delegation-Authorized A2A transport (`@agenticprimitives/a2a`)

**Status:** implementation spec (kickoff) · **Builds on:** [spec 245](245-a2a-task-adoption-in-mcp-runtime.md) (A2A Task design), [spec 244](244-fulfillment.md) (Task/Artifact types), [spec 202](202-delegation.md) (delegation + caveats), [ADR-0019](../docs/architecture/decisions/0019-relying-site-authority-is-a-scoped-delegation.md) · **Apps:** demo-a2a (relayer adoption) · **First consumer:** verifiable-content-demo (Scripture Agent ↔ BSB Corpus-Manager)

## Problem

Spec 245 designs an async A2A Task transport but the platform never built the runtime — `/api/a2a` is a stub `message/send`. We need the real thing as a **reusable platform primitive**: any claimed agent can send any other claimed agent an asynchronous, delegation-authorized task and collect the result by poll, push, or stream. Nothing scripture-specific.

## Reference: smart-agent patterns to port

Checked `/home/barb/smart-agent` (branch `003-intent-marketplace-proposal`): **no A2A/Task-transport analog exists** — the closest coordination reference is the intent-marketplace pool (specs 002/003), which is request/match, not async task lifecycle. So this is net-new; we port nothing wholesale. We DO reuse the local substrate: `@agenticprimitives/fulfillment` Task/Artifact types + `canTaskTransition`, `@agenticprimitives/delegation` (`verifyDelegation` shape, `encodeAllowedTargetsTerms`/`encodeAllowedMethodsTerms`, `mintDelegationToken`), the `SessionStoreDO` DO template, and `mcp-runtime.withDelegation` (the receiving-side principal gate).

## Architecture decisions (resolves spec requirements §9)

1. **New package `@agenticprimitives/a2a`, deliberately diverging from spec 245's `mcp-runtime/a2a` placement.** Stakeholder-agreed: build it first-class, not bolted onto a single consumer, no migration constraints. The A2A Task runtime is NOT MCP-specific — making it a `mcp-runtime` subpath would couple agent-to-agent transport to the MCP tool-call layer. Recorded in **ADR-0034**. The `fulfillment` re-export note (which points at `mcp-runtime/a2a`) is updated to point here.

2. **The package is transport-agnostic; the Cloudflare DO is an adapter (boundary doctrine, ADR-0021).** `@agenticprimitives/a2a` owns: the Task/Message/Artifact runtime (create/store/transition/retrieve over a `TaskStore` PORT), the JSON-RPC method handlers, the `SkillHandler` interface + dispatcher, the `A2aWireAdapter` client, the delegation-auth gate, and the scoped-grant caveat builders. The **Cloudflare `TaskStoreDO`** (DurableObjectState-backed `TaskStore` + `alarm()` driver) ships as a thin **`@agenticprimitives/a2a/cloudflare`** subpath — Cloudflare-types-only, like `identity-directory-adapters`. Apps without Workers wire a different `TaskStore`. This keeps the core a reusable primitive AND gives Worker agents the DO they want.

3. **Embedded-per-agent dispatch.** Each agent worker `createA2aAgent(...)` runs its own runtime + DO (sovereign agents). The shared `*.impact-agent.io` relayer becomes ONE consumer (for agents without their own worker) — it forwards a verified task to the agent's registered skill-execution backend. The dispatch contract is the `SkillHandler` interface.

4. **Bodies in the vault (A2A-INV-04).** Message + artifact bodies are records in the **assignee's per-agent demo-mcp vault namespace**; task state carries only `bodyHash` + a `VaultRef { owner, recordType }`. Reuses `callMcpToolViaDelegation` (the a2a→mcp leg).

5. **Off-chain caveat decode + authoritative on-chain `isRevoked`.** At `message/send` we DECODE the `allowedTargets`/`allowedMethods` caveat terms (matching the deployed enforcer semantics) and check them off-chain (cheap); `isRevoked` stays an on-chain authoritative read (fail-closed). Skill → selector = `keccak256(utf8(skill))[:4]` for `allowedMethods`; a documented `0x00000000` sentinel = "any skill".

6. **Signed push envelope.** On terminal state the assignee SA signs `{ taskId, state, artifactIds, ts }` (ERC-1271 / session key); the push POSTs `{ payload, sig }` + the sender-registered token; receiver verifies the assignee signature + dedupes on `taskId+state` (idempotent).

## Functional surface (the consumer contract §8)

```ts
// server (embeddable)
createA2aAgent({ agentSA, signer, handlers, taskStore, vault, mcp }): A2aAgent
//   .fetch(request)            -> JSON-RPC POST /api/a2a + SSE message/stream
//   .agentCard()               -> /.well-known/agent-card.json (capabilities: streaming/push/history)
//   .processDue()              -> the alarm() body (submitted→working→terminal)

// client
class A2aWireAdapter {
  submitTask(targetAgent, { skill, input, delegation, pushConfig? }): { taskId, state }
  getTask(taskId): Task
  subscribeTaskUpdates(taskId): AsyncIterable<TaskEvent>
  cancelTask(taskId): Task
}

// the plug-in
interface SkillHandler {
  skill: string;
  handle(ctx: SkillContext): Promise<{ state: 'completed'|'failed'|'input-required'; artifactIds?; error? }>;
}

// scoped-grant builders (FR-4.2)
buildA2aGrantCaveats({ recipientAgentSA, skill, enforcers, window }): Caveat[]   // allowedTargets + allowedMethods + timestamp
```

## JSON-RPC methods (POST /api/a2a; agent resolved from Host)

`message/send` (async submit), `tasks/get` (poll), `tasks/cancel`, `message/stream` (SSE), `tasks/pushNotificationConfig/set`. Detailed semantics per requirements §2.

## Requirements (carried verbatim from the build brief)

- **FR-2..FR-5** — the JSON-RPC surface, the Task runtime in `processDue()` (never inline), the `SkillHandler` interface, poll/push/stream delivery.
- **FR-4 (auth, net-new for agent endpoints):** reuse `verifyDelegation` (delegate===requester, timestamp, on-chain `isRevoked` fail-closed, ERC-1271); ENFORCE the recipient (`allowedTargets`=this agent SA) + skill (`allowedMethods`=skill selector) caveats; per-agent single-use message-id nonce store; signed inbound messages; bodies vault-only; `Task.permissionGrantRef = hashDelegation(delegation)`.
- **SR-1..SR-8** — fail-closed everywhere; authorization ≠ identity; no long-lived signing key for a claimed agent in any worker (KMS/session signer only — ties to spec-235 §10 + the [remediation status](../docs/audits/2026-06-09-remediation-status.md) KMS criteria).

## Acceptance (the test project — proves the primitive before any consumer)

A standalone harness with two embedded agents and a scripted run of:
- **AC-1** echo task (smoke) via poll, stream, and push.
- **AC-2** delegation gate — expired / wrong-target / revoked / wrong-skill each rejected, no task created.
- **AC-3** entitlement conversation — reader→bsb `request-entitlement`; handler writes a signed Entitlement VC into the **reader's** demo-mcp vault via the reader's captured delegation → `completed`.
- **AC-4** `auth-required` round-trip — suspend on expired grant, resume on a fresh grant.

## Wave plan

- **W1 (this kickoff):** spec + ADR-0034 + package scaffold + the **Task runtime core** (`TaskStore` port, create/transition on fulfillment types, `SkillHandler` interface + dispatcher) with unit tests.
- **W2:** the delegation-auth gate (FR-4) + the scoped-grant caveat builders + the message-id nonce store. Unit tests for AC-2.
- **W3:** JSON-RPC handlers + `A2aWireAdapter` + the Cloudflare `TaskStoreDO` subpath + agent-card.
- **W4:** poll/push/stream delivery + vault body residency (reuse `callMcpToolViaDelegation`).
- **W5:** the two-agent test harness (AC-1..AC-4); then demo-a2a relayer adoption replaces the stub.
