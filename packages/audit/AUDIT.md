# `@agenticprimitives/audit` — Security & Architecture Audit

**Status:** alpha
**Last refreshed:** 2026-05-20 (pass 5g — createPiiGuardrailSink shipped, AUD-1 closed)
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
| **AUD-1** | P2 | No automated PII / secret-leak detector for emitted events. | **CLOSED 2026-05-20 (pass 5g)** | `createPiiGuardrailSink(inner, opts?)` shipped with three modes (`redact` / `drop` / `warn`), pattern detectors (long hex above configurable threshold, JWT shape, PEM blocks, secret-key substrings), built-in allowlists for known-safe positions (signerAddress, digest, keyId, nonceHash, sessionHash, jti; subject types sign-digest, tx-hash, jti, address, event-id), and an `onDetect` callback for alerting. demo-mcp wires the guardrail around its D1 sink in `redact` mode; console intentionally bypasses (ops debugging benefits from raw, logs roll off). 12 unit tests cover clean pass-through + redaction + allowlists + drop + warn + composition. **Defense-in-depth — emitter discipline (hash/omit raw secrets) is still the primary control.** |
| **AUD-2** | P3 | Console sink does not pre-truncate over-1KB events. | Open | Cloudflare logs clip at 1KB; emitters should keep `context` flat (documented). A built-in `createConsoleAuditSink({maxBytes})` option would belt-and-braces. |
| **AUD-3** | P3 | No spec at `specs/206-audit.md` yet. | **CLOSED 2026-05-20** | Spec drafted as part of pass 5b — see [`specs/206-audit.md`](../../specs/206-audit.md). |
| **system C3** | P0 | Append-only audit trail. | **MOSTLY CLOSED 2026-05-20**: schema + sinks + mcp-runtime emission (pass 3a) + delegation.verifyDelegationToken (pass 3a) + D1 sink in demo-mcp (pass 3b) + delegation.mintDelegationToken + key-custody.signA2AAction (pass 5b). Remaining slice: envelope encrypt/decrypt emit (LocalAesProvider, GcpKmsProvider) and identity-auth emission — both are non-blocking follow-ups tracked in this AUDIT.md. |

## 6. Test posture

- **Unit:** 1 file, 28 tests as of 2026-05-20:
  `audit.test.ts` — generateEventId uniqueness, nowIso shape,
  buildEvent defaults + pass-through, memory sink ordering + FIFO
  eviction + reset, console sink JSON shape + custom prefix,
  composeSinks fan-out + partial-failure resilience + empty list,
  AuditEvent schema smoke (type-level), and 12 createPiiGuardrailSink
  tests (clean pass-through, long-hex redaction, allowKeys +
  allowSubjectTypes, JWT-shape + secret-substring + PEM detection,
  mode=drop, mode=warn, composeSinks layering, immutability of the
  caller-supplied event, address + keccak-digest under-threshold pass).
- **Consumer tests:** the mcp-runtime tests indirectly exercise the
  sink interface by passing `createMemoryAuditSink` and asserting
  events accumulate — see `mcp-runtime/test/unit/`.
- **Live smoke:** the live demo emits to console; `wrangler tail` on
  demo-mcp surfaces every accept/reject in real time.
- **Gaps:** no property test for `composeSinks` failure ordering;
  no test for the 1KB-line concern on the console sink (AUD-2).

## 7. Hardening backlog

- [x] **(AUD-1)** ~~Implement `createPiiGuardrailSink`~~ — landed 2026-05-20 (pass 5g). Wired into demo-mcp's D1 sink in `redact` mode.
- [ ] **(AUD-2)** Add `maxBytes` option to `createConsoleAuditSink` so we never overflow Cloudflare log lines silently.
- [x] **(AUD-3)** ~~Write `specs/206-audit.md`~~ — done 2026-05-20.
- [x] **(C3 emit)** ~~Emit from `delegation.verifyDelegationToken`~~ — done in pass 3a.
- [x] **(C3 emit)** ~~Emit from `delegation.mintDelegationToken`~~ — done in pass 5b.
- [x] **(C3 emit)** ~~Emit from `key-custody.{LocalSecp256k1Signer,GcpKmsSigner}.signA2AAction`~~ — done in pass 5b (wired via `BuildOpts.auditSink` + threaded through `buildSignerBackend`).
- [ ] **(C3 emit)** Emit from `LocalAesProvider.{encrypt,decrypt}` + `GcpKmsProvider.{encrypt,decrypt}` (envelope-encryption side; the `auditContext` is already accepted on the interface). Tracked separately — non-blocking for C3 closure.
- [ ] **(C3 emit)** Emit from `identity-auth.{mintSession,verifySession}` — caller-emits pattern (identity-auth itself is forbidden from importing audit per dep doctrine; the consuming app emits at the call site with `auditSink.write(buildEvent({...}))`).
- [x] **(C3 sink)** ~~Ship a `createD1AuditSink(db)` adapter~~ — landed in `apps/demo-mcp/src/db.ts` in pass 3b. Cross-app destination unification (demo-a2a → D1 too) is a future-spec item.

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

This package emits no events itself. It defines the schema + sinks. Emitting packages document their event actions in their own `AUDIT.md`. As of 2026-05-20:

- `@agenticprimitives/mcp-runtime` — `mcp-runtime.with-delegation.{accept,reject}`, `mcp-runtime.service-mac.{accept,reject}` (accept side added 2026-05-20 pass 5f).
- `@agenticprimitives/delegation` — `delegation.verify.{accept,reject}`, `delegation.mint` (NEW, pass 5b).
- `@agenticprimitives/key-custody` — `key-custody.sign` (NEW, pass 5b). Envelope-encryption emit (`key-custody.envelope.{encrypt,decrypt}`) is a remaining slice; the auditContext is already accepted on the interface.
- (Follow-up: `@agenticprimitives/connect-auth` — caller-emit pattern.)
