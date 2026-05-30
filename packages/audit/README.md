# @agenticprimitives/audit

Append-only audit-event schema + sink interface for the agentic primitives stack. Transport-agnostic primitive — consumers wire concrete persistent sinks (D1, Postgres, Cloud Logging, SIEM) behind a single interface.

Closes system-audit finding **C3** (forensic trail) from `docs/architecture/product-readiness-audit.md`.

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

## Boundaries

- Ships **in-band sinks only** (console + memory + composeSinks). Concrete persistent sinks (D1, Postgres, Cloud Logging) live in consumer apps.
- Sits at the **base of the dep graph** alongside `@agenticprimitives/types`. Forbidden from importing connect-auth / agent-account / delegation / key-custody / tool-policy / mcp-runtime — those import us.

## Invariants

- **No secret material in events.** Emitters hash sessionIds, omit raw keys / tokens. `createPiiGuardrailSink` (v0.1) is defense-in-depth.
- **Append-only by interface.** `AuditSink` has `write` only — no `delete` / `update`. Persistent sinks must enforce at the schema level.
- **Fail-soft for the trail.** Emit failures never throw to the caller. The decision (verify, sign) is the security boundary.

## Status

Pre-alpha. Schema versioned (`schemaVersion: 1`); bumps are major.
