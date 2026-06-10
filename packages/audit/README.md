# @agenticprimitives/audit

The append-only audit-event primitive for the agentic primitives stack — because in the agent economy, *"who authorized what, under which limits, provable to whom?"* is a question your logs have to answer, not your incident retro.

Most teams bolt logging onto agent infrastructure after the fact: a console transport here, a SIEM shipper there, each component naming actors its own way. The result is telemetry, not evidence. This package inverts that: one canonical `AuditEvent` schema that every package in the substrate emits — delegation mints, custody changes, key operations, tool calls — so the trail speaks the same identity language as the system it observes. The actor in an audit event is the same canonical Smart Agent address that signed the delegation; the evidence chain and the authority chain are one chain.

It closes system-audit finding **C3** (forensic trail) from `docs/architecture/product-readiness-audit.md`, and it sits at the base of the dependency graph alongside `types` — everything imports it, it imports (almost) nothing.

Part of [agenticprimitives](../../README.md) — the trust substrate for the agent economy: one canonical Smart Agent identity with custody, delegation, naming, credentials, and audit evidence designed as one system.

See [`spec.md`](./spec.md) → [`specs/206-audit.md`](../../specs/206-audit.md).

## Quick start

```ts
import {
  buildEvent,
  createConsoleAuditSink,
  composeSinks,
  type AuditSink,
} from '@agenticprimitives/audit';

const sink: AuditSink = composeSinks(
  createConsoleAuditSink({ prefix: '[AUDIT]' }),
  // ...add a persistent sink from your app layer (D1, Postgres, etc.)
);

await sink.write(
  buildEvent({
    action: 'delegation.verify.accept',
    outcome: 'success',
    actor:   { type: 'agent', id: 'demo-a2a' },
    subject: { type: 'jti', id: claims.jti },
    audience: claims.aud,
    correlationId,
  }),
);
```

Beyond the basics: a canonical action registry (`AUDIT_ACTION_REGISTRY`), a `createPiiGuardrailSink` wrapper that scrubs secrets defense-in-depth, lightweight `MetricsSink` counters, and **two composition contracts picked per event class** — `composeFailSoftSinks` absorbs transient failures for telemetry-grade events, while `composeFailHardSinks` throws on first failure so security-critical flows (delegation mint/revoke, custody changes, key operations) refuse to commit if the evidence didn't persist.

## How it's different

- **vs. OpenZeppelin Defender / Tenderly:** those monitor *contracts* — transactions and on-chain state. This trail captures the off-chain authority decisions that precede them (delegation verified, scope checked, quorum reached, tool invoked), bound to the same canonical identity and delegation chain the contracts enforce. You get the *why* behind the transaction, not just the transaction.
- **vs. custom logging:** ad-hoc logs have no shared schema, no append-only contract, and no fail-hard option — an attacker (or a bug) that suppresses the log still gets the action committed. Here the sink interface has `write` and nothing else, and security-critical emitters can make persistence a precondition.
- **The substrate effect:** because every package emits the same schema, one query correlates a sign-in, the delegation it minted, the MCP tool call it authorized, and the spend it produced — across packages, by `correlationId` and canonical address. Stitched stacks cannot produce that join.

## Boundaries

- Ships **in-band sinks only** (console + memory + compositions + PII guardrail). Concrete persistent sinks (D1, Postgres, Cloud Logging, SIEM) live in consumer apps behind the single `AuditSink` interface.
- Sits at the **base of the dep graph** alongside `@agenticprimitives/types`. Forbidden from importing connect-auth / agent-account / delegation / key-custody / tool-policy / mcp-runtime — those import us. Events carry IDs and strings, never domain objects.

## Invariants

- **No secret material in events.** Emitters hash sessionIds, omit raw keys / tokens. `createPiiGuardrailSink` is defense-in-depth, not the primary control.
- **Append-only by interface.** `AuditSink` has `write` only — no `delete` / `update`. Persistent sinks must enforce immutability at the schema level.
- **Fail-soft for telemetry, fail-hard for security.** Routine emit failures never throw to the caller; security-critical events use `composeFailHardSinks` so the trail persists or the flow refuses to commit.

## Status

Alpha track — testnet-only. Schema versioned (`schemaVersion: 1`); bumps are major. Do not deploy to production until the gates listed in the root [`README.md` Status section](../../README.md#status) are cleared. Every security finding is tracked live in [`docs/audits/findings.yaml`](../../docs/audits/findings.yaml).

## Build

```bash
pnpm --filter @agenticprimitives/audit typecheck
pnpm --filter @agenticprimitives/audit test
pnpm --filter @agenticprimitives/audit build
```
