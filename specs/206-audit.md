# Spec 206 — `@agenticprimitives/audit`

**Capability:** Append-only audit-event schema + sink interface for the agentic primitives stack. Transport-agnostic primitive; closes the system-level audit finding **C3** (forensic trail) from `docs/architecture/product-readiness-audit.md`.
**Status:** v0 draft · 2026-05-20
**Reference:** `smart-agent` branch `003-intent-marketplace-proposal` — `packages/audit-events/*`, `apps/person-mcp/src/audit/*`, the D1-backed `audit_events` table and the per-app `AuditEventBuilder` helpers. We mirror the *shape* (typed event + pluggable sink + composeSinks fan-out) and adapt it to our slimmer 7-package boundary.

---

## 1. Goal

Every security-load-bearing decision in the platform — delegation mint, delegation verify (accept + reject), key-custody sign, envelope encrypt/decrypt, MAC verify (accept + reject), policy decisions — emits one row to a tamper-evident, append-only trail. Operators and auditors get a forensics path that survives without grep'ing logs. Application code stays decoupled from sink destinations (console / D1 / Cloud Logging / SIEM): one interface, swap behind it.

The motivating finding (C3 in the product-readiness audit) was that the platform had **decisions but no audit trail** — fine in dev, disqualifying in production. This package fixes that by being the **schema + interface** layer; per-app wiring picks the destination.

---

## 2. What this package owns

- The `AuditEvent` TypeScript type (the wire schema).
- The `AuditSink` interface (`write(event): Promise<void>`).
- `buildEvent(partial)` — the canonical constructor that fills timestamp, eventId, schemaVersion.
- `generateEventId()` — UUIDv4 wrapper that survives Workers/Node/browser without a runtime check at each call site.
- Built-in in-band sinks:
  - `createConsoleAuditSink({ prefix? })` — line-JSON to stderr (default) / stdout. Safe everywhere.
  - `createMemoryAuditSink({ capacity? })` — fixed-size ring buffer for tests + ephemeral inspection.
- `composeSinks(...sinks)` — fan-out wrapper that catches per-sink failures so a downstream outage never blackholes the trail.
- *(deferred to v0.1)* `createPiiGuardrailSink(inner)` — defensive wrapper that drops/redacts events whose `context` carries high-entropy strings, hex blobs longer than known-safe widths, or values matching common secret shapes. Tracked as task #80.

## 3. What this package does NOT own

- **Concrete persistent sinks.** D1, Postgres, Cloud Logging, Elastic, Datadog — those live in consumer apps (e.g. `apps/demo-mcp/src/db.ts` exposes `createD1AuditSink`). The package only ships the in-band sinks (console + memory + compose) that have no external dependency.
- **Replay / tamper-evidence cryptography.** Hash-chained audit logs are a v0.2 follow-up; today the package is append-only by *interface contract* (no edit / delete method exists), not by cryptographic linkage.
- **Routing decisions.** Which events go to which sink is the consuming app's job; we provide `composeSinks` for the common case but pass no opinions.
- **Indexing / query layer.** Reading the trail is the destination's job (D1 / Postgres / etc.).

## 4. Public surface

```ts
// The event.
export interface AuditEvent {
  schemaVersion: 1;
  eventId: string;             // uuid v4
  timestamp: string;           // ISO 8601 UTC
  action: string;              // see § 5
  outcome: 'success' | 'failure' | 'denied';
  correlationId?: string;      // request-scoped; propagated via X-Correlation-Id
  actor:   { type: 'user' | 'agent' | 'system'; id: string };
  subject: { type: string; id: string };
  audience?: string;
  context?: Record<string, unknown>;
  reason?: string;             // for outcome=denied/failure
}

// The sink.
export interface AuditSink {
  write(event: AuditEvent): Promise<void>;
}

// Constructors.
export function buildEvent(
  input: Omit<AuditEvent, 'schemaVersion' | 'eventId' | 'timestamp'> &
         { eventId?: string; timestamp?: string }
): AuditEvent;

export function generateEventId(): string;

export function createConsoleAuditSink(opts?: {
  prefix?: string;
  destination?: 'stdout' | 'stderr';
}): AuditSink;

export function createMemoryAuditSink(opts?: { capacity?: number }): AuditSink & {
  events(): ReadonlyArray<AuditEvent>;
  clear(): void;
};

export function composeSinks(...sinks: AuditSink[]): AuditSink;
```

## 5. Action vocabulary

Emitters MUST pick `action` from the controlled set below. New actions get added here in the same PR that adds the emit site — the registry is the single source of truth for downstream dashboards.

| Action | Emitter | Outcome semantics |
| --- | --- | --- |
Naming convention: `<pkg>.<primitive>[.<outcome>]`. The outcome suffix is omitted when only one outcome is meaningful (e.g. `delegation.mint` has no rejection path — mint throws).

| `delegation.mint` | `@agenticprimitives/delegation` | `success` (no failure path — mint throws) |
| `delegation.verify.accept` | `@agenticprimitives/delegation`, `@agenticprimitives/mcp-runtime` | `success` |
| `delegation.verify.reject` | same | `denied` + `reason` |
| `key-custody.sign` | `@agenticprimitives/key-custody` (`LocalSecp256k1Signer`, `GcpKmsSigner`) | `success` (failures propagate before sign returns) |
| `key-custody.envelope.encrypt` | `LocalAesProvider`, `GcpKmsProvider` (v0.1) | `success` / `failure` |
| `key-custody.envelope.decrypt` | same | `success` / `failure` (AAD tamper → failure + reason) |
| `mcp-runtime.service-mac.accept` | `@agenticprimitives/mcp-runtime` (`verifyServiceMac`) | `success` |
| `mcp-runtime.service-mac.reject` | same | `denied` + `reason` (nonce-reuse, skew, mac-mismatch, malformed input) |
| `mcp-runtime.with-delegation.accept` | `@agenticprimitives/mcp-runtime` (`withDelegation` wrapper) | `success` |
| `mcp-runtime.with-delegation.reject` | same | `denied` + `reason` |
| `policy.decide` | `@agenticprimitives/mcp-runtime` (`evaluatePolicy` bridge) | `success` / `denied` |

## 6. Security invariants (DO NOT BREAK)

- **No secret material in events.** Raw session IDs, private keys, paymaster signer JSONs, raw delegation tokens, raw MAC keys MUST NEVER appear in `context`. Emitters hash where identity correlation is needed (`sessionHash` is keccak256(sessionId).slice(0, 18)) and omit otherwise. The `createPiiGuardrailSink` wrapper is defense-in-depth, not a substitute for emitter discipline.
- **Append-only by interface.** `AuditSink` has no `delete` / `update` counterpart. Persistent sinks (D1, Postgres, etc.) MUST enforce this at the schema level (no UPDATE / DELETE grants).
- **Fail-soft for the trail, fail-closed for the decision.** Emit failures MUST NOT throw to the caller — the decision itself is the security boundary, not the audit row. Conversely, a missing decision (delegation verify, MAC check) MUST still fail closed even if the audit emit succeeded.
- **Correlation IDs are caller-supplied.** The package never generates correlation IDs on emit; consumers thread `X-Correlation-Id` request-to-emit so a single user action stitches across a2a + mcp.
- **Schema version is a hard contract.** Bumping `schemaVersion` is a major package bump; downstream readers parse on it.

## 7. Dependency direction

`audit` sits at the base of the dep graph alongside `types`:

```
types ←┐
       ├─ identity-auth ← agent-account ← delegation ← mcp-runtime
audit ←┤                                       ↑              ↑
       └────────────── key-custody ────────────┘              │
                                                       tool-policy ─┘
```

`audit` imports `@agenticprimitives/types` only. Everything else imports `audit`. This is by design — `audit` is the ground truth schema, so it cannot depend on the things it observes.

Forbidden imports (per `capability.manifest.json`): `identity-auth`, `agent-account`, `delegation`, `key-custody`, `tool-policy`, `mcp-runtime`, `apps/*`.

## 8. Reference: smart-agent patterns to port

Per the repo doctrine ("Always check smart-agent first"), the v0 design is adapted from:

- `smart-agent/packages/audit-events/src/types.ts` — same `AuditEvent` shape (we kept the actor/subject distinction, schemaVersion, outcome enum).
- `smart-agent/packages/audit-events/src/sinks/console.ts` + `memory.ts` — same line-JSON console contract; same ring-buffer memory sink.
- `smart-agent/apps/person-mcp/migrations/0002_audit_events.sql` — D1 schema with the same indices (`timestamp`, `correlation_id`, `(action, outcome)`). We mirror this in `apps/demo-mcp/migrations/0002_audit_events.sql`.
- `smart-agent/apps/person-mcp/src/audit/d1-sink.ts` — `createD1AuditSink` adapter; we ported the fail-soft logging shape and the bound prepared-statement pattern (no string concatenation for SQL).

Deliberate divergence from smart-agent:
- We do NOT ship a Workers-Analytics-Engine sink in v0. Demo-mcp uses D1, demo-a2a uses console-only (no DB binding today). Unifying the destinations is tracked in the system audit doc as a follow-up.
- We do not embed application-specific actions in the vocabulary (smart-agent has `intent.*` actions tied to its marketplace flow). Our action set covers only the primitives-layer surface; consumer apps add their own under a namespaced prefix.

## 9. Validate the package

```bash
pnpm --filter @agenticprimitives/audit typecheck
pnpm --filter @agenticprimitives/audit test
pnpm check:forbidden-terms
pnpm check:capability-manifests
```

## 10. Open questions / v0.1+

- Tamper-evidence: should every event carry `hashOfPrevious` so a sink can verify the chain at read time? Tracked in the product-readiness audit.
- Whether `policy.decide` events deserve separate `decision` + `reason-code` fields rather than packing into `context`. Spec 204 (`tool-policy`) is the canonical place to make that call.
- A retention policy: today the schema is forever; downstream sinks decide on TTL.
