# @agenticprimitives/agent-relationships — package audit

**Status:** Phase 1 (SDK skeleton + pure helpers + taxonomy).
**Last refreshed:** 2026-05-23.
**Owner:** [security-auditor](../../docs/agents/security-auditor.md) +
[technical-architect-auditor](../../docs/agents/technical-architect-auditor.md).
**System audit cross-ref:** see
[`docs/architecture/product-readiness-audit.md`](../../docs/architecture/product-readiness-audit.md)
and the [evidence checklist](../../docs/audits/evidence-checklist.md).

This audit is Phase-1 scope only. Findings against contract behavior
(two-side confirmation, permissionless revocation) land in Phase 3+;
demo-integration findings in Phase 4+.

## Charter (what's audit-relevant in this package)

- Edge-ID derivation (`computeEdgeId`): MUST be deterministic AND match
  the on-chain `keccak256(subject || object || type)` port (Phase 3).
  MUST refuse self-edges (subject === object).
- Relationship-type + role constants (`RELATIONSHIP_TYPE`, `ROLE`):
  MUST be `keccak256(name)` — same convention as Solidity
  `keccak256(bytes(name))` — so off-chain and on-chain IDs always match.
- Taxonomy map (`TYPE_SEMANTICS`): MUST be frozen + have an entry for
  every well-known type so resolvers can rely on it.
- `AgentRelationshipsClient` (Phase 1 skeleton): MUST throw clearly
  when invoked before contract wiring.
- Vocabulary firewall against `agent-naming`, `agent-profile`,
  `delegation`, `custody`, `mcp-runtime`, `tool-policy`, `key-custody`,
  `audit`, and MCP transport. `NAMESPACE_CONTAINS` is intentionally
  absent per ADR-0006.

## Findings (Phase 1)

| ID | Severity | Finding | Evidence | Status |
| --- | --- | --- | --- | --- |
| **AR-1** | P2 | Relationship-type IDs are hashed at module load. If the well-known names ever change spelling, the resulting `bytes32` IDs flip — equivalent to deploying a new contract. Phase 3 MUST treat the constants as deployment-frozen. | `src/constants.ts:30`, `test/taxonomy.test.ts` (golden vectors) | open — design-time control. |
| **AR-2** | P2 | `computeEdgeId` packs addresses lowercased for both off-chain and on-chain compute. The on-chain port MUST use the same packing (`abi.encodePacked(subject, object, typeId)` where addresses are 20-byte values — case-insensitive on chain by construction). Verify in Phase 3 with a cross-port golden vector. | `src/edge-id.ts:25` | open — track in Phase 3 review. |
| **AR-3** | P3 | Phase 1 ships NO authority enforcement (the client throws on writes). The boundary that the relationships package itself stays custody-agnostic — quorum / scheduling happens in the actor's CustodyPolicy module — MUST be re-verified in Phase 4 (no `@agenticprimitives/account-custody` import sneaking in). | `capability.manifest.json:forbiddenImports` | open — track in Phase 4 review. |
| **AR-4** | P3 | `AgentAssertion` (signed-claim layer) and `AgentRelationshipResolver` (policy layer) are deferred to v2 per ADR-0007. Verify any "v2 sneak-in" PR with a spec amendment first. | ADR-0007 § "Deferred to v2" | open — design-time control. |

## Phase-1 security invariants (verified by tests)

- ✅ `computeEdgeId` is deterministic for the same triple.
- ✅ `computeEdgeId` produces different IDs for `(A→B)` vs `(B→A)`
  (direction matters for non-symmetric types).
- ✅ `computeEdgeId` produces different IDs for different relationship
  types on the same `(subject, object)` pair.
- ✅ `computeEdgeId` refuses self-edges.
- ✅ `computeEdgeId` refuses missing inputs.
- ✅ `RELATIONSHIP_TYPE.*` values equal `keccak256(name)` (golden vectors).
- ✅ `ROLE.*` values equal `keccak256(name)` (golden vectors).
- ✅ `TYPE_SEMANTICS` has an entry for every relationship type
  constant.
- ✅ `TYPE_SEMANTICS` is frozen (no runtime mutation).
- ✅ `TYPE_SEMANTICS` marks `PARTNERSHIP` symmetric and
  `HAS_GOVERNANCE_OVER` hierarchical.
- ✅ `NAMESPACE_CONTAINS` is intentionally absent (ADR-0006).
- ✅ `AgentRelationshipsClient` throws `R Phase 2 — wire to …` from
  every read method.
- ✅ `AgentRelationshipsClient` throws `R Phase 4 — wire to …` from
  every write method.

## Audit events this package emits (Phase 4+)

| Action | When | Severity in audit context |
| --- | --- | --- |
| `agent-relationships.edge.propose` | on `proposeEdge` | forensic-critical |
| `agent-relationships.edge.confirm` | on `confirmEdge` | forensic-critical |
| `agent-relationships.edge.revoke` | on `revokeEdge` | forensic-critical |
| `agent-relationships.role.set` | on `setRoles` | forensic-critical |
| `agent-relationships.type.register` | on type-registry write (Phase 3 contract) | forensic-critical |

Spec-declared in `specs/216-agent-relationships.md` § 8.

## Out-of-scope (won't audit here)

- Contract source — `apps/contracts/src/relationships/AgentRelationship.sol`
  + `RelationshipTypeRegistry.sol` land in Phase 3.
- On-chain authority paths (ERC-1271 actor verification, two-side
  confirmation enforcement) — Phase 3 Forge tests.
- `AgentAssertion` signed-claim layer — deferred to v2.
- `AgentRelationshipResolver` policy layer — deferred to v2.

## Change log

| Date | Wave | What changed |
| --- | --- | --- |
| 2026-05-23 | RL Phase 1 | Initial audit. AR-1/2/3/4 open; security invariants verified by unit tests. |
