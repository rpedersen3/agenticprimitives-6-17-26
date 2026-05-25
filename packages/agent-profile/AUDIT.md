# @agenticprimitives/agent-profile — package audit

**Status:** Phase 1 (SDK skeleton + pure helpers + types).
**Last refreshed:** 2026-05-23.
**Owner:** [security-auditor](../../docs/agents/security-auditor.md) +
[technical-architect-auditor](../../docs/agents/technical-architect-auditor.md).
**System audit cross-ref:** see
[`docs/architecture/product-readiness-audit.md`](../../docs/architecture/product-readiness-audit.md)
and the [evidence checklist](../../docs/audits/evidence-checklist.md).

This audit is Phase-1 scope only. Findings against profile-fetch /
endpoint-verification behavior land in Phase 2+; on-chain integration
findings in Phase 3+.

## Charter (what's audit-relevant in this package)

- CAIP-10 helpers (`buildCaip10Address`, `parseCaip10`, `isValidCaip10`):
  MUST be strict on encode (allowlist enforced), permissive on decode
  (grammar-only). Per ADR-0008.
- Canonical-JSON serialization (`canonicalProfileJson`,
  `profileContentHash`): MUST be deterministic — two semantically-equal
  profiles MUST hash identically. Sort keys, fixed numeric format, no
  whitespace, refuse non-finite numbers.
- Profile validation (`validateProfile`): MUST refuse profiles missing
  required fields per `ProfileType`. Fail-loud on write.
- `AgentIdentityClient` (Phase 1 skeleton): MUST throw clearly when
  invoked before contract wiring, so a Phase-1 consumer can't silently
  get a no-op call.
- Vocabulary firewall against `agent-naming`, `agent-relationships`,
  `delegation`, `custody`, `mcp-runtime`, `tool-policy`, `key-custody`,
  `audit`, and MCP transport.

## Findings (Phase 1)

| ID | Severity | Finding | Evidence | Status |
| --- | --- | --- | --- | --- |
| **AI-1** | P2 | CAIP-10 namespace allowlist is hardcoded (`eip155`, `hedera`, `solana`). Adding a new namespace requires a PR — intentional per ADR-0008 ("strict on write, forward-compat on read"). Document that expansion is a one-line + golden-vector test PR. | `src/constants.ts:7`, `src/caip10.ts:31` | open — design-time control, no current risk. |
| **AI-2** | P2 | `canonicalProfileJson` injects `schemaVersion: 1` into every hash input. Bumping the constant invalidates every previously-published `metadata-hash`. Phase 2 deploy MUST document the version-bump migration path. | `src/profile.ts:25`, `src/constants.ts:16` | open — track in Phase 2 review. |
| **AI-3** | P3 | The peer dep on `@agenticprimitives/agent-account` is declared early to lock the boundary; Phase 1 client doesn't yet exercise it (writes throw). Verify in Phase 2 that the import remains narrow (`AgentAccountClient` only). | `package.json` peerDependencies; `capability.manifest.json:imports` | open — track in Phase 2 review. |

## Phase-1 security invariants (verified by tests)

- ✅ CAIP-10 encoder rejects namespaces NOT in `CAIP10_NAMESPACE_ALLOWLIST`.
- ✅ CAIP-10 encoder lowercases the address half for `eip155` (canonical
  comparison can't be smuggled past).
- ✅ CAIP-10 decoder accepts grammar-valid strings even for
  non-allowlisted namespaces (forward-compat).
- ✅ CAIP-10 decoder rejects grammar-malformed inputs.
- ✅ `canonicalProfileJson` produces identical output for two
  semantically-equal profiles (key-order independent).
- ✅ `canonicalProfileJson` omits `undefined` fields.
- ✅ `canonicalProfileJson` refuses non-finite numbers.
- ✅ `validateProfile` refuses unknown profile types.
- ✅ `validateProfile` refuses `mcpServer` without endpoint OR without
  ≥1 verification method.
- ✅ `validateProfile` refuses `multisig` with threshold outside
  `[1, members.length]`.
- ✅ `AgentIdentityClient` throws `I Phase 2 — wire to …` from every
  read method (so silent no-op calls are impossible in Phase 1).
- ✅ `AgentIdentityClient` throws `I Phase 4 — wire …` from every
  write method.

## Audit events this package emits (Phase 2+)

| Action | When | Severity in audit context |
| --- | --- | --- |
| `agent-identity.profile.fetch.{accept,reject}` | profile pulled via metadata-uri | telemetry |
| `agent-identity.profile.update` | on profile publication (metadata-hash record update) | forensic-critical |
| `agent-identity.endpoint.verify.{success,failure}` | when a `VerificationMethod` runs | forensic-critical |

Spec-declared in `specs/217-agent-identity.md` § 7. The client doesn't
yet take an `auditSink`; Phase 2 will add the optional `opts.auditSink`
and emit through it.

## Out-of-scope (won't audit here)

- Contract source — the identity stack doesn't ship a dedicated contract
  in Phase 1; profile anchoring rides on `agent-naming` records.
- Endpoint-verification HTTP / DNS / VP flows — Phase 2 client work.
- UAID generation — refused per ADR-0008 (consumers derive locally).
- Skill / credential registries — deferred to v2 per ADR-0007.

## Change log

| Date | Wave | What changed |
| --- | --- | --- |
| 2026-05-23 | ID Phase 1 | Initial audit. AI-1/2/3 open; security invariants verified by unit tests. |
