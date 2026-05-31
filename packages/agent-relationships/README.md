# @agenticprimitives/agent-relationships

> ⚠️ **Experimental — do NOT use for confidential edges.**
>
> This package writes the trust-fabric edge graph **publicly on-chain**.
> Every edge — its endpoints, type, role set, and status — is visible to
> anyone reading the chain, forever. There is no on-chain confidentiality
> for the **fact that an edge exists**.
>
> That means this package is **structurally incompatible** with use-cases
> that bring a confidentiality requirement: financial counterparty graphs,
> medical referral networks, B2B partnership relationships under NDA,
> family/household membership, or any "who is connected to whom" graph
> where the connection itself is the secret. The `metadata-hash` field
> anchors off-chain JSON but cannot hide the existence of the edge or
> the identity of its endpoints.
>
> Concrete public exposure per edge: `subject` address, `object` address,
> `relationshipType` (e.g. `HAS_MEMBER`, `HAS_GOVERNANCE_OVER`), role set
> on each side, `EdgeStatus` lifecycle (proposed/confirmed/active/revoked),
> and the actor address that submitted each state transition.
>
> A future v2 private-edge variant (commitment-based, with
> selective-disclosure proofs) will live alongside this package. Until it
> ships, **adopters requiring confidentiality should not use this
> package** and should hold their relationship graph in an off-chain
> store with explicit access control.
>
> Tracked as the **Privacy Fork** (audit `PKG-agent-relationships-001` /
> `EXT-019`). `capability.manifest.json` sets `"stability": "experimental"`.

Trust-fabric edge primitive for Smart Agents. An `Edge` is a
`(subject, object, relationshipType)` triple with a role set on each
side, a status lifecycle (`PROPOSED → CONFIRMED → ACTIVE → REVOKED`),
and optional off-chain metadata anchored by a deterministic
content-hash.

Where [`agent-naming`](../agent-naming) resolves *names → addresses*
and [`agent-profile`](../agent-profile) owns the *profile layer*,
this package owns the **relationship layer**: the on-chain graph of
who-knows-whom that other layers compose against (org membership,
governance assertions, validation trust, etc.).

> **Layer:** Discover — the trust **graph** (not canonical identity — that is `agent-account`).
> **Canonical key:** Smart Agent addresses. An edge connects anchors; an edge is **not** a delegation.

## Status

**Phase 1** — pure SDK + spec + API skeleton. Read methods on the
client throw `R Phase 2`; write methods throw `R Phase 4`. Contracts
(`AgentRelationship.sol` + `RelationshipTypeRegistry.sol`) land in
Phase 3. `AgentAssertion` (signed-claim layer) and
`AgentRelationshipResolver` (policy layer) are **deferred to v2** per
ADR-0007.

See [`specs/216-agent-relationships.md`](../../specs/216-agent-relationships.md)
for the full design + the phase plan, and:

- [ADR-0006](../../docs/architecture/decisions/0006-agent-naming-as-resolution-layer.md)
  — why naming hierarchy is parent-pointer-based, NOT a
  `NAMESPACE_CONTAINS` edge.
- [ADR-0007](../../docs/architecture/decisions/0007-agent-identity-stack-three-packages.md)
  — why the identity stack is three packages, not one.

## Install

This package is workspace-internal in the agenticprimitives monorepo
and not yet published.

## Usage

### Edge-ID derivation (pure)

```ts
import {
  computeEdgeId,
  RELATIONSHIP_TYPE,
} from '@agenticprimitives/agent-relationships';

const id = computeEdgeId(
  '0x1111…1111',                              // subject
  '0x2222…2222',                              // object
  RELATIONSHIP_TYPE.HAS_MEMBER,               // type (bytes32 hash)
);
//   0x… — keccak256 of packed (subject || object || typeId)
```

Same triple → same edge ID. Direction matters for non-symmetric types
(`HAS_MEMBER(A→B)` ≠ `HAS_MEMBER(B→A)`).

### Relationship type + role taxonomy

```ts
import {
  RELATIONSHIP_TYPE,
  ROLE,
  TYPE_SEMANTICS,
} from '@agenticprimitives/agent-relationships/taxonomy';

RELATIONSHIP_TYPE.HAS_MEMBER;        // bytes32 — keccak256("HAS_MEMBER")
RELATIONSHIP_TYPE.PARTNERSHIP;       // bytes32 — symmetric
RELATIONSHIP_TYPE.HAS_GOVERNANCE_OVER; // bytes32 — hierarchical

ROLE.BOARD_MEMBER;                   // bytes32 — keccak256("BOARD_MEMBER")
ROLE.TREASURER;                      // bytes32

TYPE_SEMANTICS[RELATIONSHIP_TYPE.PARTNERSHIP].symmetric;     // true
TYPE_SEMANTICS[RELATIONSHIP_TYPE.HAS_GOVERNANCE_OVER].hierarchical; // true
```

`NAMESPACE_CONTAINS` is **intentionally absent** — naming hierarchy
lives in [`agent-naming`](../agent-naming) via parent-pointer per
ADR-0006.

### Relationships client (Phase 2+)

```ts
import {
  AgentRelationshipsClient,
  RELATIONSHIP_TYPE,
  ROLE,
} from '@agenticprimitives/agent-relationships';

const rel = new AgentRelationshipsClient({
  rpcUrl: 'https://base-sepolia.g.alchemy.com/v2/…',
  chainId: 84532,
});

// Read (Phase 2+)
const edges = await rel.listEdgesFor('0x…', { relationshipType: RELATIONSHIP_TYPE.HAS_MEMBER });

// Write (Phase 4+)
await rel.proposeEdge({
  subject: '0xAlice…',
  object:  '0xAcme…',
  relationshipType: RELATIONSHIP_TYPE.HAS_MEMBER,
  subjectRoles: [ROLE.BOARD_MEMBER],
});
await rel.confirmEdge({ edgeId: '0x…', selfRoles: [] });
```

Each write is authorized via the actor's Smart Agent ERC-1271 →
its CustodyPolicy module. The relationships package itself stays
custody-agnostic (no `@agenticprimitives/account-custody` import).

## Subpath exports

- `@agenticprimitives/agent-relationships/taxonomy` —
  relationship-type + role constants + semantics map.

## Security invariants

- Edge ID is **deterministic** —
  `keccak256(subject || object || relationshipType)`. Off-chain and
  on-chain derivations always match.
- `computeEdgeId` refuses self-edges (subject === object).
- Relationship-type + role IDs are `keccak256(name)` (matches
  Solidity `keccak256(bytes(name))`).
- Two-side confirmation for non-symmetric types (Phase 3+ contract
  enforcement).
- Permissionless revocation from either side (Phase 3+).
- Custody-agnostic — authority always routes through the actor's
  Smart Agent ERC-1271.
- `NAMESPACE_CONTAINS` is intentionally absent (ADR-0006).

See `AUDIT.md` for the package audit + open findings.

## License

UNLICENSED (internal monorepo, not published).
