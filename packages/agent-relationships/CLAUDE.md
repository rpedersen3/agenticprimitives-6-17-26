# @agenticprimitives/agent-relationships — Claude guide

## What this package owns
- `Edge` — the trust-fabric edge primitive: `(subject, object,
  relationshipType)` triple with role set, status, metadata.
- `RelationshipType` (bytes32-hashed) — well-known constants
  (`HAS_MEMBER`, `HAS_GOVERNANCE_OVER`, `VALIDATION_TRUST`,
  `PARTNERSHIP`, `OPERATES_ON_BEHALF_OF`, `RECOMMENDS`) plus the
  type semantics map (hierarchical / transitive / symmetric flags).
- `Role` (bytes32-hashed) — labels attached to one side of an edge.
- `EdgeStatus` enum (`PROPOSED → CONFIRMED → ACTIVE → REVOKED`).
- `computeEdgeId(subject, object, type)` — pure derivation:
  `keccak256(subject || object || type)`.
- `AgentRelationshipsClient` skeleton (reads throw `R Phase 2`;
  writes throw `R Phase 4`).
- Subpath `/taxonomy` — relationship-type + role constants + the
  semantics map.

## What this package does NOT own
- Naming hierarchy (`NAMESPACE_CONTAINS` edges) → ADR-0006 +
  spec 215. Naming is parent-pointer-based, NOT
  relationships-edge-based, in our model. The relationship-type
  `NAMESPACE_CONTAINS` from smart-agent is intentionally NOT
  included.
- Profile / `AgentCard` → [`agent-identity`](../agent-profile).
- Naming registry / resolver → [`agent-naming`](../agent-naming).
- Delegation / mint / verify → [`delegation`](../delegation).
- Custody / quorum / recovery → [`custody`](../account-custody).
- Signed-claim layer (`AgentAssertion`) — deferred to v2 per ADR-0007.
- Policy/resolver layer (`AgentRelationshipResolver`) — deferred to v2.
- Skill registry / credential registry — deferred to future
  packages per ADR-0007.

## Vocabulary
**Owns:** `Edge`, `EdgeStatus`, `RelationshipType`, `Role`,
`AgentRelationshipsClient`, the relationship-type taxonomy
constants.
**Disambiguation:**
- **"edge"** here = trust-fabric relationship triple. In
  `delegation` / `agent-naming` / `agent-identity` "edge" doesn't
  exist.
- **"role"** here = a label attached to one side of a relationship
  edge (`ROLE_BOARD_MEMBER`, `ROLE_OPERATOR`, etc.). In `custody`
  + `tool-policy` "role" doesn't exist.
- **"relationship type"** here = bytes32 hash of a relationship
  name (`HAS_MEMBER`, …). NOT an `AgentKind` (Person/Org/Service)
  — that's in `types`.
- **"assertion"** is DEFERRED. The `AgentAssertion` signed-claim
  layer ships in v2.
**Does not use:** `Delegation`, `Caveat`, `Custodian`, `Trustee`,
`RiskTier`, `KMS`, `JtiStore`, `namehash`, `AgentCard`,
`NAMESPACE_CONTAINS` (naming-domain, not relationships-domain).

## Read these first (in order)
1. `capability.manifest.json` — boundary.
2. `src/index.ts` — public API.
3. `../../specs/216-agent-relationships.md` — the spec.
4. `../../docs/architecture/decisions/0007-agent-identity-stack-three-packages.md`
5. `src/edge-id.ts` + `src/taxonomy.ts` — the pure substrate.

## Stable public exports
**Types:** `Edge`, `EdgeStatus`, `RelationshipType`, `Role`,
`AgentRelationshipsClientOpts`, `ProposeEdgeInput`,
`ConfirmEdgeInput`, `RevokeEdgeInput`, `SetRolesInput`.
**Helpers (pure):** `computeEdgeId`, `hashRelationshipType`,
`hashRole`, `RELATIONSHIP_TYPE`, `ROLE`, `TYPE_SEMANTICS`.
**Client:** `AgentRelationshipsClient`.
**Errors:** `InvalidEdgeError`, `UnauthorizedActorError`.
**Subpaths:**
- `/taxonomy` — relationship-type + role constants + semantics map.

## Allowed imports
`@agenticprimitives/types`, `@agenticprimitives/connect-auth`
(`Signer` type only), `@agenticprimitives/agent-account`
(`AgentAccountClient` for ERC-1271 auth in Phase 4), `viem`,
`@noble/hashes` (transitive via viem).

## Forbidden imports
- `apps/*`
- `@agenticprimitives/delegation`, `mcp-runtime`, `tool-policy`,
  `key-custody`, `audit`, `custody`, `agent-naming`,
  `agent-identity`
- `@modelcontextprotocol/sdk`

## Drift triggers — STOP and route
- "Add `NAMESPACE_CONTAINS` as a relationship type" — **HARD STOP.**
  ADR-0006 + spec 215 own naming hierarchy via parent-pointer.
  Adding it here would create the parallel-authority gap that
  ADR-0006 explicitly closed.
- "Add a signed-claim layer (assertion)" — **STOP.** Deferred to v2
  per ADR-0007 § "Deferred to v2". Spec amendment required first.
- "Add a name resolver" — **STOP.** Belongs in
  [`agent-naming`](../agent-naming).
- "Add a profile schema" — **STOP.** Belongs in
  [`agent-identity`](../agent-profile).
- "Add CustodyPolicy enforcement of relationship rules" — **STOP.**
  Authorization to write an edge goes through the actor's Smart
  Agent ERC-1271 → its CustodyPolicy quorum. The relationships
  package itself MUST stay custody-agnostic.

## Before you write code
- [ ] Is the change in the edge / type / role / client surface?
- [ ] Did I avoid importing from `agent-naming`, `agent-identity`,
      `delegation`, `custody`, `mcp-runtime`, `tool-policy`,
      `key-custody`, `audit`?
- [ ] If I'm adding a relationship type, did I add it to
      `RELATIONSHIP_TYPE` + `TYPE_SEMANTICS` + a golden vector test?
- [ ] If I'm adding a role, did I add it to `ROLE` + a hash test?
- [ ] Did I update `specs/216-agent-relationships.md` if the
      public API or edge model changed?

## Security invariants (DO NOT BREAK)
- **Edge ID is deterministic.** `keccak256(subject || object ||
  relationshipType)`. Same triple → same edge ID. Prevents
  duplicate edges; enables idempotent propose.
- **Two-side confirmation for non-symmetric types** (Phase 3+
  contract enforcement). PROPOSED edges MUST NOT influence policy
  decisions until CONFIRMED or ACTIVE.
- **Revocation is permissionless from either side** (Phase 3+).
  Either party can revoke unilaterally.
- **No back-edges.** Verified by `pnpm check:all`.
- **Role IDs are bytes32 hashes**, not raw strings — prevents
  cross-namespace role collisions.
- **`NAMESPACE_CONTAINS` is intentionally absent** — naming
  hierarchy lives in `agent-naming` per ADR-0006.

## Validate the package
```bash
pnpm --filter @agenticprimitives/agent-relationships typecheck
pnpm --filter @agenticprimitives/agent-relationships test
pnpm check:forbidden-terms
```

## Common task routing
- New relationship type → `src/taxonomy.ts`
  (`RELATIONSHIP_TYPE` + `TYPE_SEMANTICS` entry) + golden hash
  test in `test/taxonomy.test.ts`.
- New role → `src/taxonomy.ts` (`ROLE` constant) + golden hash test.
- New client method → `src/client.ts` (Phase 1 stub with
  `throw new Error('R Phase 2')` for reads or `'R Phase 4'` for
  writes; wire in subsequent phases).

## Capabilities this package participates in
- **Trust fabric** — primary purpose. Edges + roles form the
  on-chain trust graph other layers compose against
  (organization membership, governance assertions, validation
  trust, etc.).
- **Audit / forensics trail** — Phase 4+ emits (via consumer
  `AuditSink`): `agent-relationships.edge.{propose,confirm,revoke}`,
  `agent-relationships.role.set`,
  `agent-relationships.type.register`.
- Index: [`docs/architecture/cross-cutting-capabilities.md`](../../docs/architecture/cross-cutting-capabilities.md).

## Generated files (ignore)
`dist/`, `node_modules/`, `coverage/`, `*.tsbuildinfo`.
