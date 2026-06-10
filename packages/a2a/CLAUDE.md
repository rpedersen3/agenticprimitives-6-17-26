# @agenticprimitives/a2a — Claude guide

## What this is
Async, delegation-authorized **Agent-to-Agent task transport** (spec 269). Any claimed agent sends any
other claimed agent an asynchronous task and collects the result by poll / push / stream. Built on the
`@agenticprimitives/fulfillment` Task substrate; the delegation primitive is the auth.

## The boundary (ADR-0034 — READ FIRST)
This package is the **transport-agnostic core**: the Task runtime over a `TaskStore` PORT, the
`SkillHandler` contract + dispatcher, the JSON-RPC handlers, the `A2aWireAdapter` client, the
delegation-auth gate, and the scoped-grant caveat builders. **No Cloudflare coupling here.** The
Cloudflare `TaskStoreDO` (DurableObject-backed `TaskStore` + `alarm()`) ships as the `./cloudflare`
subpath. We DIVERGE from spec 245's `mcp-runtime/a2a` placement on purpose — `mcp-runtime` becomes a
consumer (the receiving `withDelegation` gate + the a2a→mcp delivery leg), not the owner.

## Wave status
- **W1 (done):** Task runtime core — `newTaskRecord`, `applyTransition` (fail-closed via
  `canTaskTransition`), `dispatchTask` (skill dispatch; unknown→rejected; AuthRequired→auth-required;
  throw→failed), the `TaskStore` port + in-memory impl, the `SkillHandler` contract.
- **W2 (done):** delegation-auth gate `authorizeA2aMessage` (FR-4: delegate===requester, timestamp
  window, allowedTargets=this-agent + allowedMethods=skill scoping, on-chain `isRevoked` + ERC-1271
  injected fail-closed, signed message, single-use message-id) + `buildA2aGrantCaveats` + `hashA2aMessage`.
- **W3 (done):** `createA2aAgent` (message/send → authorize + persist + return submitted; tasks/get +
  tasks/cancel with party auth; `processDue` alarm body running `dispatchTask`; agent-card) +
  `dispatchA2aRpc`/`handleA2aRpcBody` (JSON-RPC 2.0) + `A2aWireAdapter` (over an injected transport) +
  the `./cloudflare` `createDurableObjectTaskStore` adapter.
- **W4 (done):** vault body residency (`emitArtifact` writes the body to the assignee vault; only
  hashes/refs in state) + signed push (`deliverPush`/`verifyPushEnvelope` — assignee signs the terminal
  envelope, receiver verifies, bounded retry; wired into `processDue`) + `tasks/pushNotificationConfig/set`
  + SSE framing (`formatSseEvent`/`isStreamEnd`). Poll is `tasks/get` (W3).
- **W5 (done):** two-agent acceptance harness (`test/harness.test.ts`, AC-1..AC-4 — happy path, the
  delegation-gate denials at the agent surface, a cross-vault entitlement deposit, the auth-required
  round-trip via `resubmit`) + the demo-a2a relayer adoption (`apps/demo-a2a/src/a2a-task-do.ts`: a
  per-agent `A2aTaskDO` running the real runtime over DO storage, ERC-1271 + isRevoked checks bound to
  Base Sepolia, `alarm()`-driven `processDue`; `/api/a2a` forwards to it — the stub "received" is gone).
  Added `resubmit` (auth-required → submitted) + `tasks/resubmit` routing this wave.

## Read first
1. `capability.manifest.json` — boundary.
2. `../../specs/269-async-delegation-authorized-a2a.md` — the contract + the §9 decisions.
3. `../../docs/architecture/decisions/0034-a2a-transport-is-its-own-package-with-cloudflare-adapter.md`.
4. `src/runtime.ts` (lifecycle) → `src/skill-handler.ts` (the plug-in) → `src/task-store.ts` (the port).

## Allowed imports
`@agenticprimitives/types`, `@agenticprimitives/fulfillment` (Task/Artifact types), `@agenticprimitives/delegation`
(verify + caveats), `viem`. The `./cloudflare` subpath additionally uses `@cloudflare/workers-types` (dev).

## Forbidden imports
- `apps/*`
- `@agenticprimitives/mcp-runtime` / `tool-policy` (they consume us — no back-edges).
- `@modelcontextprotocol/sdk` (MCP transport is not A2A transport).
- **No Cloudflare types in the core `src/` (only in `src/cloudflare/`).**

## Security invariants (DO NOT BREAK)
- Every transition fail-closed via `canTaskTransition`; unknown skill → `rejected`.
- No task created for an unverifiable grant (W2). `task.permissionGrantRef = hashDelegation(grant)`;
  on-chain `isRevoked` fails in-flight closed.
- Message/artifact bodies live in the vault (`VaultRef`) — only hashes/refs in task state (A2A-INV-04).
- Authorization ≠ identity: the caveats + assignee decide *what*; the token proves *who*. A delegator
  never reaches another principal's namespace.
- No long-lived signing key for a claimed agent — KMS/session signer only (ties to spec-235 §10).

## Validate
```bash
pnpm --filter @agenticprimitives/a2a typecheck
pnpm --filter @agenticprimitives/a2a test
```
