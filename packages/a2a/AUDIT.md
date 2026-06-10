# @agenticprimitives/a2a — security audit notes

**Status:** W1 (runtime core). Spec [269](../../specs/269-async-delegation-authorized-a2a.md) ·
boundary [ADR-0034](../../docs/architecture/decisions/0034-a2a-transport-is-its-own-package-with-cloudflare-adapter.md).

## Surface shipped in W1 (this is what's auditable today)

Transport-agnostic Task lifecycle only — no network, no signing, no storage durability:

- `newTaskRecord` — builds a `submitted` record; sets `permissionGrantRef`.
- `applyTransition` — **fail-closed** via `fulfillment.canTaskTransition`; rejects illegal + no-op
  transitions; bumps `rev`; emits the status event.
- `dispatchTask` — unknown skill → `rejected`; handler `AuthRequired` → `auth-required`; handler throw
  → `failed`; an illegal handler-returned state → `failed`. Never runs an unregistered skill.
- `TaskStore` port + an in-memory reference impl; `SkillHandler` contract; `buildSkillRegistry` rejects
  duplicate skills.

## Invariants (enforced now)

- Every state change goes through `canTaskTransition` — no direct state writes. (test-covered)
- Unknown skill is rejected, not silently dropped. (test-covered)
- The core imports **no** `@cloudflare/*`, `mcp-runtime`, `tool-policy`, or MCP SDK (boundary scan +
  dependency-graph facet firewall green).

## NOT yet present (deferred by wave — DO NOT assume these hold)

- **W2 — delegation auth gate.** Until then, `dispatchTask`/`newTaskRecord` trust the caller to have
  verified the grant. The JSON-RPC entrypoints (W3) MUST call the auth gate before `newTaskRecord`:
  `verifyDelegation` (delegate===requester, timestamp, on-chain `isRevoked` fail-closed, ERC-1271) +
  the `allowedTargets`/`allowedMethods` caveat decode + the message-id replay nonce (FR-4).
- **W3 — JSON-RPC + Cloudflare DO.** No HTTP surface or durable store yet; the in-memory store is NOT
  production-safe (no cross-isolate durability; `reserveMessageId` is non-atomic in-memory).
- **W4 — vault residency + signed delivery.** Bodies are not yet vault-backed; push/artifact signing
  not yet implemented.
- **Signing.** No signing in this package. When the assignee signs artifacts/pushes (W4), it MUST use a
  KMS/session signer — never a long-lived private key in a worker (spec-235 §10).

## Test posture

`test/runtime.test.ts` — 11 tests covering create, every transition class (legal/illegal/no-op),
dispatch (complete/reject/auth-required/fail), duplicate-skill rejection, and the in-memory store.
