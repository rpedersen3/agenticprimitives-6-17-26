# @agenticprimitives/agent-naming — package audit

**Status:** Phase 1 (SDK skeleton + spec + pure helpers).
**Last refreshed:** 2026-05-23.
**Owner:** [security-auditor](../../docs/agents/security-auditor.md) +
[technical-architect-auditor](../../docs/agents/technical-architect-auditor.md).
**System audit cross-ref:** see
[`docs/architecture/product-readiness-audit.md`](../../docs/architecture/product-readiness-audit.md)
and the [evidence checklist](../../docs/audits/evidence-checklist.md).

This audit is Phase-1 scope only. Findings against contract behavior,
on-chain authority paths, and demo integration land in Phase 3+.

## Charter (what's audit-relevant in this package)

- Pure helpers (`normalizeAgentName`, `labelhash`, `namehash`): MUST
  be deterministic + match the reference ENS algorithm + reject
  malformed input.
- Record schema (`AgentNameRecords` + `records` subpath): MUST
  refuse unknown keys on encode (fail-loud write) AND drop unknown
  keys on decode (fail-closed read).
- `AgentNamingClient` (Phase 1 skeleton): MUST throw clearly when
  invoked before contract wiring, so a Phase-1 consumer can't
  silently get a no-op call.
- Vocabulary firewall against `delegation`, `custody`, `mcp-runtime`,
  `tool-policy`, `key-custody`, `audit`, and MCP transport.

## Findings (Phase 1)

| ID | Severity | Finding | Evidence | Status |
| --- | --- | --- | --- | --- |
| **AN-1** | P2 | Lowercase normalization uses `String.prototype.toLowerCase`, which has Turkish-locale-specific edge cases for `İ → i` mapping. Phase 1 labels are ASCII-only so the practical risk is zero, but the locale-sensitivity is worth either documenting OR replacing with a locale-explicit map. | `src/normalize.ts:21` | open — Phase 1 acceptable (ASCII-only labels in `LABEL_RE`). Revisit when Phase 2 expands to Punycode/IDN. |
| **AN-2** | P2 | The package depends on `@agenticprimitives/agent-account` for ERC-1271 verification, but the Phase 1 client doesn't yet exercise it (writes throw). The dependency is declared early to lock the boundary; verify in Phase 2 that the import remains narrow (`AgentAccountClient` only, no transitive widening). | `package.json` peerDependencies; `capability.manifest.json:imports` | open — track in Phase 2 review. |
| **AN-3** | P3 | Multi-root TLD support exists in the contract design (per smart-agent port) but the package surface restricts to `.agent`. A future TLD addition (e.g. `.org-agent`) requires both the contract `initializeRoot` AND a surface change here. Make sure the surface change is intentional + spec'd, not snuck in. | `src/constants.ts:8` | open — design-time control; no current risk. |

## Phase-1 security invariants (verified by tests)

- ✅ `normalize` rejects empty / leading-hyphen / trailing-hyphen /
  non-ASCII / oversize labels. Throws `InvalidNameError`. Covered in
  `test/normalize.test.ts`.
- ✅ `normalize` is idempotent: `normalize(normalize(x)) === normalize(x)`.
- ✅ `namehash('')` = `ZERO_NODE` (`0x00…00`) per the ENS sentinel
  convention.
- ✅ `namehash` matches the ENS reference algorithm under an
  in-band independent reimplementation (`test/namehash.test.ts`
  golden-vector table).
- ✅ `namehash` rejects malformed input by delegating to `normalize`.
- ✅ `decodeRecords` silently drops unknown predicate keys
  (fail-closed read).
- ✅ `encodeRecordValue` rejects unknown predicate keys (fail-loud
  write).
- ✅ `decodeRecords` drops invalid `agent-kind` values that don't
  match the closed enum.
- ✅ `AgentNamingClient` throws `NS Phase 2 — wire to …` from every
  read method (so silent no-op calls are impossible in Phase 1).
- ✅ `AgentNamingClient` throws `NS Phase 4 — wire to …` from every
  write method.

## Audit events this package emits (Phase 2+)

| Action | When | Severity in audit context |
| --- | --- | --- |
| `agent-naming.resolve.{accept,reject}` | demo-mcp uses name in audit context | telemetry |
| `agent-naming.register` | on subname registration | forensic-critical |
| `agent-naming.records.update` | on resolver-record writes | forensic-critical |
| `agent-naming.primary-name.update` | on reverse-record writes | forensic-critical |
| `agent-naming.subregistry.update` | on subregistry-delegation changes | forensic-critical |

These are spec-declared in `specs/215-agent-naming.md` § 9. The
client doesn't yet take an `auditSink`; Phase 2 will add the optional
`opts.auditSink` and emit through it.

## Out-of-scope (won't audit here)

- Contract source — lives in `apps/contracts/src/naming/` (Phase 3).
- On-chain authority paths (subregistry delegation, owner rotation
  via custody) — Phase 3 contract Forge tests + Phase 4 client
  integration tests.
- Demo wiring — Phase 5; per-demo audit lives in the demo's
  integration evidence rows, not in this package.

## Change log

| Date | Wave | What changed |
| --- | --- | --- |
| 2026-05-23 | NS Phase 1 | Initial audit. AN-1/2/3 open; security invariants verified by unit tests. |
