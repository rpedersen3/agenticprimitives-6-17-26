# `@agenticprimitives/audit` — Security & Architecture Audit

**Status:** alpha
**Last refreshed:** 2026-05-20
**Owners:** audit package CODEOWNERS
**System audit cross-reference:** [docs/architecture/product-readiness-audit.md](../../docs/architecture/product-readiness-audit.md)

## 1. Charter

Append-only audit/forensics primitives. Owns: `AuditEvent` schema,
`AuditSink` interface, three in-band sinks (`createConsoleAuditSink`,
`createMemoryAuditSink`, `composeSinks`), plus helpers (`generateEventId`,
`nowIso`, `buildEvent`). Closes system audit finding **C3**.

Per its `CLAUDE.md`: imports `types` only. Sits at the bottom of the
dep graph alongside `types`; every other `@agenticprimitives/*` package
can import freely.

What this package does NOT own:
- Concrete persistence backends (D1 / Cloud Logging / Splunk / Datadog).
- Domain semantics — `action`/`subject`/`context` are free-shaped.
- Audit-event analysis, alerting, or retention policy.

## 2. Security invariants (DO NOT BREAK)

1. **Append-only by interface.** The `AuditSink.write` method has no
   edit/delete counterpart. Persistent backend implementations MUST
   enforce immutability at the storage layer (immutable D1 table,
   log-stream Cloud Logging, etc.). Reviewers should reject PRs that
   add an `update` or `delete` method to the interface.
2. **Fail-soft emission.** Sinks absorb transient failures internally;
   the caller's `await write(event)` MUST NEVER reject the caller's
   request flow. `composeSinks` enforces this for the multi-sink case.
   Tests: `test/unit/audit.test.ts` — "continues fan-out even when one
   sink rejects".
3. **No secret material in events.** Emitters MUST hash or omit raw
   secrets (session IDs, private keys, full delegation tokens, raw
   nonces). The audit package itself cannot enforce this (it accepts
   any string); each emitting package documents its redaction approach
   in its `AUDIT.md`. Reviewers MUST audit every new emission point
   for this invariant.
4. **Deterministic shape, free-form action.** The schema is fixed;
   the `action` is a free string. Consumers MUST keep an actions
   doc-list in their package `AUDIT.md` so the action vocabulary
   stays auditable end-to-end.
5. **ISO-8601 UTC timestamps.** All events carry `timestamp` —
   downstream sinks may rewrite, but emitters never omit.
6. **Zero runtime dependency on domain packages.** Reviewers MUST
   reject any PR that adds a domain import (delegation, identity-auth,
   key-custody, tool-policy, mcp-runtime, agent-account).

## 3. Public API surface (audit scope)

| Symbol | Kind | Trust boundary |
| --- | --- | --- |
| `AuditEvent` | type | Canonical event shape every package emits. |
| `AuditSink` | interface | Minimal write-only contract. |
| `MemoryAuditSink` | interface (extends AuditSink) | In-memory sink with `events()` + `reset()` for tests. |
| `createConsoleAuditSink` | factory | One-line JSON to `console.log`. Default prefix `[AUDIT]`. |
| `createMemoryAuditSink` | factory | Bounded ring buffer (default capacity 1024). |
| `composeSinks` | factory | Fans out to multiple sinks; absorbs per-sink failures. |
| `generateEventId` | function | UUID-v4 via Web Crypto with weak fallback. |
| `nowIso` | function | ISO-8601 UTC string. |
| `buildEvent` | function | Convenience: fills `id` + `timestamp`; spreads the rest. |

## 4. Threat model

| Threat | Likelihood | Impact | Mitigation | Status |
| --- | --- | --- | --- | --- |
| Domain coupling leaks into the audit package | Medium | High (cycle / package-boundary doctrine break) | Forbidden imports + forbidden terms guards | Covered (capability manifest) |
| Secret material in an emitted event | Medium when scaled | Critical (forensics database becomes the secret store) | Documented invariant; reviewer responsibility per package | **Open** — no automated check |
| Audit emission failure breaks user request | Medium | High (request fails even though business logic succeeded) | Fail-soft semantics in `composeSinks` + per-call try/catch in emitters | Covered |
| `AuditSink` storage becomes mutable | Low | Critical (audit trail tampering) | Interface has no mutation methods; backend reviewer responsibility | Design-level |
| Memory sink leaks events across tests | Low | Low (test pollution) | `reset()` available; tests must call it | Covered |
| Console sink line overruns Cloudflare's 1KB log limit | Medium | Low (truncation) | Documented; emitters should keep `context` flat | **Open** — no automated truncation |

## 5. Findings (open)

| ID | Severity | Finding | Status | Notes |
| --- | --- | --- | --- | --- |
| **AUD-1** | P2 | No automated PII / secret-leak detector for emitted events. | Open | Could ship a runtime sink that scans events for hex strings of length 64+ and `0x[a-f0-9]{40}` patterns, logs warnings. Not load-bearing, but useful guardrail. |
| **AUD-2** | P3 | Console sink does not pre-truncate over-1KB events. | Open | Cloudflare logs clip at 1KB; emitters should keep `context` flat (documented). A built-in `createConsoleAuditSink({maxBytes})` option would belt-and-braces. |
| **AUD-3** | P3 | No spec at `specs/206-audit.md` yet. | Open | Capability manifest references it; create as a follow-up. |
| **system C3** | P0 | Append-only audit trail. | **PARTIALLY CLOSED 2026-05-20**: schema + sinks + mcp-runtime emission. Follow-up passes will wire emission in `delegation.verifyDelegationToken`, `key-custody.{sign,decrypt}`, `identity-auth.{mintSession,verifySession}`, and ship a durable D1 sink. |

## 6. Test posture

- **Unit:** 1 file, 16 tests as of 2026-05-20:
  `audit.test.ts` — generateEventId uniqueness, nowIso shape,
  buildEvent defaults + pass-through, memory sink ordering + FIFO
  eviction + reset, console sink JSON shape + custom prefix,
  composeSinks fan-out + partial-failure resilience + empty list,
  AuditEvent schema smoke (type-level).
- **Consumer tests:** the mcp-runtime tests indirectly exercise the
  sink interface by passing `createMemoryAuditSink` and asserting
  events accumulate — see `mcp-runtime/test/unit/`.
- **Live smoke:** the live demo emits to console; `wrangler tail` on
  demo-mcp surfaces every accept/reject in real time.
- **Gaps:** no property test for `composeSinks` failure ordering;
  no test for the 1KB-line concern on the console sink (AUD-2).

## 7. Hardening backlog

- [ ] **(AUD-1)** Implement a PII-leak guardrail sink that flags long hex strings + addresses + JWT-shaped tokens in events.
- [ ] **(AUD-2)** Add `maxBytes` option to `createConsoleAuditSink` so we never overflow Cloudflare log lines silently.
- [ ] **(AUD-3)** Write `specs/206-audit.md` with the schema contract + emit-point conventions.
- [ ] **(C3 follow-up)** Emit from `delegation.verifyDelegationToken` (accept + reject) and `delegation.mintDelegationToken`.
- [ ] **(C3 follow-up)** Emit from `key-custody.GcpKmsSigner.signA2AAction` + `GcpKmsProvider.{encrypt,decrypt}` (the `auditContext` is already accepted; just needs a sink wire).
- [ ] **(C3 follow-up)** Emit from `identity-auth.{mintSession,verifySession}` failures.
- [ ] **(C3 follow-up)** Ship a `createD1AuditSink(db)` adapter — either in `mcp-runtime` (next to the JTI store adapters) or in a dedicated `audit-sinks` package if more backends accumulate.

## 8. External audit readiness

An external auditor evaluating this package needs:

- `pnpm build` + `pnpm test` (16 tests)
- `specs/206-audit.md` (TODO — AUD-3)
- This audit doc + system audit
- Source: `src/index.ts` (single file, ~250 LOC including extensive JSDoc)
- The downstream emission story: which `<package>.AUDIT.md` files name actions today (mcp-runtime currently)

## 9. Accepted limitations / scope exclusions

- No concrete backend sinks (D1 / Cloud Logging / Splunk). Those live with consumers — see the C3 follow-up backlog.
- No alerting / aggregation / retention. That's the consumer's observability platform.
- No correlation-ID propagation framework (e.g. AsyncLocalStorage). Callers pass `correlationId` explicitly. We may add a context helper if a real consumer asks.
- No spec.md yet (AUD-3 tracks).
- Forbidden imports: every `@agenticprimitives/*` package except `types`.

## 10. Audit events emitted (none — this package only defines the shape)

This package emits no events itself. It defines the schema + sinks. Emitting packages document their event actions in their own `AUDIT.md`. As of 2026-05-20, emitting packages are:

- `@agenticprimitives/mcp-runtime` — emits `mcp-runtime.with-delegation.{accept,reject}` and `mcp-runtime.service-mac.reject`.
- (Follow-up: `@agenticprimitives/delegation`, `@agenticprimitives/key-custody`, `@agenticprimitives/identity-auth`.)
