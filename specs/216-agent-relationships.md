# Spec 216 — Agent Relationships

**Status:** v0 (architecture locked; Phase 1 implementation pending).
**Owner:** `@agenticprimitives/agent-relationships` package (to be
scaffolded).
**Architecture commitment:** [ADR-0006](../docs/architecture/decisions/0006-agent-naming-as-resolution-layer.md)
+ [ADR-0007](../docs/architecture/decisions/0007-agent-identity-stack-three-packages.md).
**Adapted from:** smart-agent
`packages/contracts/src/AgentRelationship.sol` (392 LOC, zero
smart-agent imports) + `RelationshipTypeRegistry.sol` (138 LOC).

---

## 1. Purpose

Agent relationships are the **trust-fabric edges** between Smart
Agents. A relationship is a triple
`(subject, object, relationshipType)` carrying a role set and an
edge status (PROPOSED / CONFIRMED / ACTIVE).

Why this matters for our stack:
- **Organization membership**: Alice and Bob have a
  `HAS_MEMBER` edge to Acme Org. Acme can enumerate its members
  on-chain.
- **Governance**: Treasury has an `ORGANIZATION_GOVERNANCE` edge to
  Acme. The relationship type itself signals that admin actions
  for Treasury route through Acme's quorum.
- **Validation / partnership / referral**: any trust assertion
  between two agents that should live on-chain as a queryable edge
  rather than off-chain.

Naming hierarchy (`alice.acme.agent` → `acme.agent` →
`agent`) is **NOT** built on relationships in our model. ADR-0006
explicitly chose parent-pointer in the registry node struct over
relationship-edge backing. Relationships are an independent
primitive that the demo apps + future trust-fabric features compose
against.

## 2. Vocabulary firewall

**Owns:**
- `Edge` (a relationship triple + roles + status + metadata).
- `RelationshipType` (bytes32 hash; well-known constants).
- `Role` (bytes32 hash; pairs with relationship types).
- `EdgeStatus` (`PROPOSED | CONFIRMED | ACTIVE | REVOKED`).
- `AgentRelationshipsClient` (read + write client).
- `RelationshipTypeRegistry` (metadata: hierarchical / transitive /
  symmetric flags per type).

**Disambiguation:**
- **"edge"** here = trust-fabric relationship triple. In
  `delegation` "edge" doesn't exist; in `agent-naming` "edge"
  doesn't exist. Relationships-domain only.
- **"role"** here = a label attached to one side of a relationship
  edge (e.g. `ROLE_BOARD_MEMBER`, `ROLE_OPERATOR`). In `custody`
  "role" doesn't exist; in `tool-policy` "role" doesn't exist.
- **"assertion"** here is DEFERRED to v2 (`AgentAssertion` adds a
  signed-claim layer over edges; not in v0).

**Does not use:** `Delegation`, `Caveat`, `Custodian`, `Trustee`,
`RiskTier`, `KMS`, `JtiStore`, MCP / A2A transport. See
`capability.manifest.json:forbiddenTerms` (to be added when package
is scaffolded).

## 3. Package boundary

**Dependency direction:**

```
types ← connect-auth ← agent-account ← agent-relationships
                                        agent-naming   ─ (no edge to/from agent-relationships)
                                        agent-profile ─ (no edge to/from agent-relationships)
                                        delegation / mcp-runtime / tool-policy / key-custody / audit / custody ─ (no edge)
```

Per ADR-0007: agent-relationships is a standalone primitive
optionally consumed by other packages via address-only interfaces.
No back-edges. No coupling to naming or identity.

**Allowed imports:**
- `@agenticprimitives/types`
- `@agenticprimitives/connect-auth` (`Signer` type only — for client
  write methods)
- `@agenticprimitives/agent-account` (`AgentAccountClient` — for
  ERC-1271 verification of edge-write authorization)
- `viem`

**Forbidden imports:**
- `apps/*`
- `@agenticprimitives/delegation`, `mcp-runtime`, `tool-policy`,
  `key-custody`, `audit`, `custody`, `agent-naming`, `agent-profile`

## 4. Edge model (Phase 1 — MVP)

```
struct Edge {
  bytes32 edgeId;              // keccak256(subject || object || relationshipType)
  address subject;             // the agent making the claim / on the LEFT
  address object;              // the agent on the RIGHT
  bytes32 relationshipType;    // bytes32 of well-known constant or bespoke
  EdgeStatus status;           // PROPOSED → CONFIRMED → ACTIVE → REVOKED
  address createdBy;           // either subject, object, or an authorized third party
  uint64 createdAt;
  uint64 updatedAt;
  string metadataURI;          // optional off-chain context
}

enum EdgeStatus {
  PROPOSED,    // subject claimed; object hasn't confirmed
  CONFIRMED,   // both parties acknowledged
  ACTIVE,      // confirmed AND any required activation conditions met
  REVOKED      // either party revoked
}
```

Plus `mapping(bytes32 => bytes32[]) _roles` — per-edge role set.

**Authorization model (matches ADR-0006 pattern):**
- `propose(subject, object, type, roles, metadataURI)`: caller MUST
  be `subject` or `subject`'s authorized signer (via ERC-1271).
- `confirm(edgeId)`: caller MUST be `object` or `object`'s authorized
  signer (via ERC-1271).
- `revoke(edgeId)`: caller MUST be `subject` OR `object`'s
  authorized signer.
- For Smart Agents in mode>0, authorization routes through their
  CustodyPolicy quorum via ERC-1271 — same path as agent-naming
  ownership updates.

## 5. Relationship type taxonomy

Phase 1 ships these well-known types (matching smart-agent's
constants for one-way interop):

| Constant | Purpose | Symmetric? | Hierarchical? | Transitive? |
| --- | --- | --- | --- | --- |
| `HAS_MEMBER` | `Org → Person` membership | no | no | no |
| `HAS_GOVERNANCE_OVER` | `Org → SubAgent` admin authority | no | yes | yes |
| `VALIDATION_TRUST` | `Validator → Agent` trust attestation | no | no | no |
| `PARTNERSHIP` | bilateral business relationship | yes | no | no |
| `OPERATES_ON_BEHALF_OF` | `Service → Principal` delegated authority | no | no | no |
| `RECOMMENDS` | non-binding endorsement | no | no | no |

Each carries an entry in `RelationshipTypeRegistry` with semantic
flags. Consumers can register additional types (governance-gated).

**Note**: `NAMESPACE_CONTAINS` from smart-agent is NOT included
here — naming hierarchy lives in `agent-naming` (parent-pointer),
per ADR-0006.

## 6. Phase plan

| Phase | Scope | Status |
| --- | --- | --- |
| **Architecture** | This spec + ADR-0007 + ADR-0008 lock-in. | done 2026-05-23 |
| **Phase 1** | Package scaffold, types, pure helpers (relationship type constants, edge ID derivation), client API skeleton (writes throw `R Phase 3`). | pending |
| **Phase 2** | Contract ABIs + read methods on `AgentRelationshipsClient` (`getEdge`, `edgesBySubject`, `edgesByObject`, `edgesByType`, `holdsRole`). | pending |
| **Phase 3** | Port `AgentRelationship.sol` + `RelationshipTypeRegistry.sol` to `packages/contracts/src/relationships/`. Forge tests for propose / confirm / revoke / role gating / ERC-1271 authorization. Deploy + persist addresses. | pending |
| **Phase 4** | Wire write methods (`propose`, `confirm`, `revoke`, role-set updates). Each uses ERC-1271 on the actor's Smart Agent. | pending |
| **v2 (deferred)** | `AgentAssertion.sol` (signed-claim layer) + `AgentRelationshipResolver.sol` (assertion-gated edge resolution). Spec amendment when a consumer needs this. | future |

## 7. Integration via NameContext (no back-edges)

Other packages don't import `agent-relationships`. Instead, consumers
that want to display "Alice IS a member of Acme" alongside an audit
row do this:

1. Worker (demo-a2a) resolves the actor's name via `agent-naming`.
2. Worker queries `agent-relationships` for the actor's edges (e.g.
   `edgesBySubject(actor) | filter(type == HAS_MEMBER)`).
3. Worker builds a `NameContext` (from `types`) — extended later if
   needed with a `roles: string[]` field — and threads it into
   `audit.buildEvent` / `tool-policy.evaluatePolicy` / etc.

Tool-policy specifically gains policy DSL like:

```ts
// In a consumer's policy definition (not in tool-policy package itself):
denyUnless({
  reason: 'requires Acme membership',
  check: ({ callerName, callerEdges }) =>
    callerEdges?.some(e =>
      e.relationshipType === HAS_MEMBER &&
      e.object === ACME_ORG_ADDRESS &&
      e.status === EdgeStatus.ACTIVE
    ),
});
```

The check function reads context; `tool-policy` itself stays
naming-agnostic.

## 8. Audit events

This package emits (via consumer-supplied `AuditSink`):

- `agent-relationships.edge.propose` — on edge creation.
- `agent-relationships.edge.confirm` — on confirmation by object.
- `agent-relationships.edge.revoke` — on revocation by either side.
- `agent-relationships.role.set` — on role-set mutation.
- `agent-relationships.type.register` — governance event from
  `RelationshipTypeRegistry`.

## 9. Security invariants

- **Edge ID is deterministic**: `keccak256(subject || object ||
  relationshipType)`. Same triple → same edge ID. Prevents
  duplicate edges; enables idempotent propose.
- **Two-side confirmation for non-symmetric types**: an unconfirmed
  edge (PROPOSED) cannot influence policy decisions. Only CONFIRMED
  or ACTIVE edges count.
- **Revocation is permissionless from either side**: any party to
  an edge can revoke unilaterally. Symmetric with social-recovery
  ergonomics elsewhere in the platform.
- **No back-edges**: `agent-relationships` does not import naming,
  identity, delegation, custody, mcp-runtime, tool-policy,
  key-custody, or audit. Verified by `pnpm check:all`.
- **Role IDs are bytes32 hashes**, not raw strings — prevents
  cross-namespace role collisions.

## 10. Out of scope (Phase 1)

- `AgentAssertion` (signed-claim layer over edges) — defer to v2.
- `AgentRelationshipResolver` (policy / mode resolution) — defer to v2.
- Skill registry / credential registry — separate future packages.
- Cross-chain edge resolution.
- Expiry / TTL on edges (Phase 1 edges are perpetual until revoked).

## 11. Acceptance criteria (per phase)

**Phase 1 (scaffold + pure helpers):**
- Package builds + typechecks.
- Edge ID derivation matches a golden vector.
- Relationship type constants exported.
- Client skeleton throws `R Phase 3` on read/write.
- No back-edges (verified by `pnpm check:all`).

**Phase 3 (contracts):**
- Forge tests pass for propose / confirm / revoke / role gating /
  ERC-1271 authorization including custody-quorum-gated writes.
- Edges actually persist across redeploys (CREATE2 + same addresses).

**Phase 4 (writes wired):**
- demo-web-pro Act 4 (TwoPersonControl) optionally writes a
  `HAS_MEMBER(Org → Alice)` edge after Alice joins the Org. Audit
  row visible.

## 12. Reference

- ADR-0006, ADR-0007.
- Source contracts: smart-agent
  `packages/contracts/src/AgentRelationship.sol`,
  `RelationshipTypeRegistry.sol`.
- Vocabulary firewall: spec 213.
- HCS-14 (UAID) does NOT use relationship edges in its design;
  relationships are an independent primitive we adopt from
  smart-agent + reference codebases (Lens-style social graph,
  Hyperledger Indy relationships, etc.).
