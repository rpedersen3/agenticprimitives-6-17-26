# @agenticprimitives/audit — Claude guide

## What this package owns
- `AuditEvent` schema — the canonical shape every other package emits.
- `AuditSink` interface — minimal write-only contract for concrete backends.
- In-band sinks: `createConsoleAuditSink`, `createMemoryAuditSink`, `composeSinks`.
- Helpers: `generateEventId`, `nowIso`, `buildEvent`.

## What this package does NOT own
- Concrete persistence backends (D1 / Cloud Logging / Splunk / Datadog). Those live with the consumer.
- Domain semantics — `action`/`subject`/`context` are free-shaped; this package only stamps the structure.
- Audit-event analysis, alerting, or retention policy.

## Vocabulary
**Owns:** `AuditEvent`, `AuditSink`, `composeSinks`, `correlationId`, `outcome ∈ {success, denied, error}`.
**Disambiguation:** This package is the **observability/forensics** primitive — the system-level audit doc (`docs/architecture/product-readiness-audit.md`) is a separate concept (process/document, not runtime).
**Does not use:** any domain term (`Delegation`, `Caveat`, `Enforcer`, `RiskTier`, `withDelegation`, etc.). See `capability.manifest.json:forbiddenTerms`.

## Read these first (in order)
1. `capability.manifest.json` — boundary
2. `src/index.ts` — the entire public API
3. `../../specs/206-audit.md` — the contract (when present)

## Stable public exports
**Schema:** `AuditEvent`
**Interfaces:** `AuditSink`, `MemoryAuditSink`
**Sinks:** `createConsoleAuditSink`, `createMemoryAuditSink`, `composeSinks` (= `composeFailSoftSinks`), `composeFailHardSinks`
**Helpers:** `generateEventId`, `nowIso`, `buildEvent`

## Allowed imports
`@agenticprimitives/types`. **Nothing else.** This package sits at the base of the dep graph alongside `types` — every other package can import from it without creating cycles.

## Forbidden imports
- `apps/*`
- Every other `@agenticprimitives/*` package except `types`. If we needed a domain type, we'd be conflating concerns.

## Drift triggers — STOP and route
- "Add a D1 / Cloud Logging / HTTP audit sink" — **PARTIAL STOP.** Generic remote sink (e.g. structured HTTP POST) is OK here. Backend-specific sinks (D1, KV, Cloudflare Logpush, Sentry) live with the consumer (the app or the package emitting the event). Rule of thumb: if the sink imports a concrete backend SDK, it doesn't belong here.
- "Define an `action` registry / enum" — **STOP.** Each emitting package documents its own action vocabulary in that package's `AUDIT.md` § "Audit events emitted". Centralising the registry here creates a coupling cycle.
- "Add alerting / thresholds / aggregations" — **STOP.** That's analysis, not emission. Wire those at the sink layer.
- "Import a domain type (`Delegation`, `Caveat`, etc.)" — **HARD STOP.** Audit events carry IDs + strings, not domain objects.

## Before you write code
- [ ] Is the change a schema field, a sink, or a helper?
- [ ] If adding a sink: does it have any concrete-backend dep? If yes, it belongs in the consumer, not here.
- [ ] Does the change preserve **fail-soft** semantics? An audit-emission failure must not propagate as a request failure.
- [ ] Did I keep the file flat (no deep `context` shapes)? Structured-log backends index flat keys best.

## Security invariants (DO NOT BREAK)
- **Append-only by interface.** The `AuditSink.write` method has no edit/delete counterpart. Persistent backend implementations MUST enforce this at the storage layer (immutable D1 table, log-stream-only Cloud Logging, etc.).
- **Two failure contracts, picked per event class.** `composeSinks` / `composeFailSoftSinks` absorb transient failures internally — best for telemetry-grade events. **H7-B.7 (PKG-AUDIT-001 closure):** security-critical events (`delegation.mint`, `delegation.revoke`, `custody.{schedule,apply,cancel}`, `key-custody.{sign,rotate}`, `account-custody.credential-*`) MUST use `composeFailHardSinks` — first sink failure throws so the caller's flow refuses to commit if the audit didn't persist.
- **No secret material in events.** Emitters MUST hash or omit raw secrets (session IDs, private keys, full delegation tokens). Each emitter package documents its redaction approach in its `AUDIT.md`.
- **Deterministic IDs are not required, but timestamps are.** Every event has an ISO-8601 UTC timestamp.

## Validate the package
```bash
pnpm --filter @agenticprimitives/audit typecheck
pnpm --filter @agenticprimitives/audit test
pnpm check:forbidden-terms
```

## Common task routing
- Adding an in-band sink that needs no concrete backend → `src/index.ts`. Examples worth adding later: bounded-rate-limited console sink, fan-out queue, severity filter.
- Adding a JSON-Schema or Zod schema for `AuditEvent` → optional `src/schema.ts`; export only if a runtime validator becomes useful.
- Adding `correlationId` propagation helpers (e.g. AsyncLocalStorage on Node, Workers) → consider it only if a real consumer asks for it; otherwise it's premature abstraction.

## Capabilities this package participates in
- **Audit / forensics trail** — see [spec 206](../../specs/206-audit.md) + [demo guide](../../apps/demo-mcp/docs/audit/guide.md). **This package is the canonical home** for the capability: it owns the `AuditEvent` schema, the `AuditSink` interface, the in-band sinks (`createConsoleAuditSink`, `createMemoryAuditSink`, `composeSinks`), the helpers (`buildEvent`, `generateEventId`, `nowIso`), and the defensive `createPiiGuardrailSink`. Concrete persistent sinks (D1, Cloud Logging, etc.) live in consumer apps, not here.
- **Multi-sig + threshold policy** — see [spec 207](../../specs/207-smart-account-threshold-policy.md) + [demo guide](../../apps/demo-web-pro/docs/multi-sig/guide.md). This package's role: receive emissions from `agent-account.admin.{propose,execute,cancel}` + `delegation.quorum.{accept,reject}` once those wire in (6c.3+). Action vocabulary stays per spec 206's table.
- Index of cross-cutting capabilities: [`docs/architecture/cross-cutting-capabilities.md`](../../docs/architecture/cross-cutting-capabilities.md).

## Generated files (ignore)
`dist/`, `node_modules/`, `coverage/`, `*.tsbuildinfo`.
