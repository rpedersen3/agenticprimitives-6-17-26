# @agenticprimitives/a2a

**Agent-to-agent calls gated by the same delegations as everything else.** Agent discovery and identity are being settled right now — ERC-8004 went to mainnet, agent naming services launched, agent cards are becoming the lingua franca of discovery. What none of that settles is authority: when agent A sends agent B a task, what proves A was allowed to ask, for exactly that skill, within exactly those limits? This package answers with the agenticprimitives delegation primitive — the same EIP-712, caveat-constrained, on-chain-revocable grant that authorizes a web session, an MCP tool, and an on-chain spend. One delegation model, everywhere; A2A is not the exception.

Part of [agenticprimitives](../../README.md) — the trust substrate for the agent economy: one canonical Smart Agent identity with custody, delegation, naming, credentials, and audit evidence designed as one system.

Concretely: an async, delegation-authorized **Agent-to-Agent task transport**. Any claimed agent sends any other an asynchronous, delegation-scoped task and collects the result by poll, push, or stream. Built on the `@agenticprimitives/fulfillment` Task substrate; specified in [spec 269](../../specs/269-async-delegation-authorized-a2a.md).

## What ships

All five implementation waves have landed:

- **Task runtime core** — `newTaskRecord`, `applyTransition` (fail-closed via `canTaskTransition`), `dispatchTask`, the `TaskStore` port + an in-memory reference implementation, and the `SkillHandler` contract. Unknown skill → `rejected`, never silently dropped.
- **Delegation-auth gate** — `authorizeA2aMessage`: delegate === requester, timestamp window, target + skill scoping via caveats, on-chain `isRevoked` + ERC-1271 injected fail-closed, signed message, single-use message-id. Plus `buildA2aGrantCaveats` and `hashA2aMessage`.
- **Agent surface** — `createA2aAgent` (message/send → authorize + persist; tasks/get + tasks/cancel with party auth; alarm-driven `processDue`; agent card) + JSON-RPC 2.0 handlers (`dispatchA2aRpc` / `handleA2aRpcBody`) + the `A2aWireAdapter` client over an injected transport.
- **Vault body residency + signed push** — message and artifact bodies live in the assignee's vault; only hashes/refs appear in task state. Terminal results are delivered as signed push envelopes (`deliverPush` / `verifyPushEnvelope`) with bounded retry, or streamed via SSE framing, or polled via `tasks/get`.
- **Two-agent acceptance harness** — the happy path, delegation-gate denials at the agent surface, a cross-vault entitlement deposit, and the auth-required round-trip via `resubmit`, all exercised in `test/harness.test.ts`.

```ts
import { newTaskRecord, dispatchTask, buildSkillRegistry, createInMemoryTaskStore } from '@agenticprimitives/a2a';
```

## Boundary

The core is **transport-agnostic** — no Cloudflare coupling in `src/`. The Durable Object-backed `TaskStore` adapter (`createDurableObjectTaskStore`) ships as the `./cloudflare` subpath. See [ADR-0034](../../docs/architecture/decisions/0034-a2a-transport-is-its-own-package-with-cloudflare-adapter.md). `mcp-runtime` is a consumer of this package, not the owner — no back-edges.

## How it's different

The competing pattern is **A2A protocol SDKs and agent-framework messaging** — transports that move tasks but treat authorization as someone else's problem (a bearer token, a shared secret, an allow-list). Three things this package does that they structurally cannot:

- **No task without a verifiable grant.** A task record is only created when the delegation gate verifies the grant; `task.permissionGrantRef` pins the delegation hash, and an on-chain revocation fails the task in flight, closed.
- **Authorization is not identity.** The caveats and assignee decide *what* may happen; the signed token proves *who* asked. A delegator never reaches another principal's namespace, and no claimed agent holds a long-lived signing key — KMS/session signers only.
- **Bodies stay in the vault.** Task state carries hashes and refs; payloads live in the assignee's vault with its own access control. The transport never becomes the data store.

Because the gate is the same delegation primitive used across the substrate, "this agent may invoke that agent's `summarize` skill until Friday, revocable instantly" is one grant — verifiable on chain, auditable end to end.

## Validation

```bash
pnpm --filter @agenticprimitives/a2a typecheck
pnpm --filter @agenticprimitives/a2a test
```

## Status

Testnet/pilot-ready. Production launch is gated on the public checklist in the root [`README.md`](../../README.md#status--honest-version) — including third-party contract audit and governance key rotation. Track every security finding live in [`docs/audits/findings.yaml`](../../docs/audits/findings.yaml). The runtime runs end to end in the demo apps against Base Sepolia (ERC-1271 + `isRevoked` checks bound to chain).

## License

UNLICENSED (internal monorepo, not published).
