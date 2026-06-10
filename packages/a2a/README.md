# @agenticprimitives/a2a

Async, delegation-authorized **Agent-to-Agent (A2A) task transport** — a reusable platform primitive.
Any claimed agent sends any other an asynchronous, delegation-scoped task and collects the result by
poll, push, or stream. Built on the `@agenticprimitives/fulfillment` Task substrate.

## Status

**W1 — runtime core.** The transport-agnostic Task lifecycle (`newTaskRecord`, `applyTransition`,
`dispatchTask`), the `TaskStore` port (+ an in-memory reference impl), and the `SkillHandler` contract.
The delegation-auth gate, scoped-grant caveat builders, JSON-RPC handlers, the `A2aWireAdapter` client,
and the Cloudflare `TaskStoreDO` adapter (`./cloudflare`) land in subsequent waves — see
[spec 269](../../specs/269-async-delegation-authorized-a2a.md) §"Wave plan".

## Boundary

The core is transport-agnostic (no Cloudflare coupling); the Durable Object ships as the `./cloudflare`
subpath. See [ADR-0034](../../docs/architecture/decisions/0034-a2a-transport-is-its-own-package-with-cloudflare-adapter.md).

```ts
import { newTaskRecord, dispatchTask, buildSkillRegistry, createInMemoryTaskStore } from '@agenticprimitives/a2a';
```
