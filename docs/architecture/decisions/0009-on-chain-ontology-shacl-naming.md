# ADR-0009 — On-chain ontology + SHACL shapes for naming records (reversal)

**Status:** Accepted (2026-05-23).
**Supersedes:** the "no ontology registry" carve-out in
[spec 215 § Phase 3](../../../specs/215-agent-naming.md) and the
implicit "off-chain validation is sufficient" stance baked into
[ADR-0007](./0007-agent-identity-stack-three-packages.md).
**Drivers:** trust-fabric integrity, knowledge-graph mirroring,
governed-vocabulary semantics across naming + relationships +
identity.

---

## Context

NS Phase 3 originally shipped (today, 2026-05-23, commit pending)
`AgentNameAttributeResolver` as a pure `(node, key string → string)`
key/value store. Predicate validation lived OFF chain in the
`@agenticprimitives/agent-naming/records` SDK module: the encoder
refused unknown keys, the decoder dropped them. This was the
deliberate Phase 3 simplification: "no ontology registry,
fail-closed on read, fail-loud on write — at the developer's compile
time, not at chain edge."

Two things prompted a reversal review:

1. **smart-agent ships a SHACL-inspired ontology stack.** Three
   contracts (`OntologyTermRegistry`, `AttributeStorage`,
   `ShapeRegistry`) govern predicates as a typed vocabulary and
   validate subject metadata against class shapes. The pattern is
   reused across every metadata-bearing contract there
   (`AgentAccountResolver`, `AgentNameAttributeResolver`,
   `ProposalRegistry`, `FundRegistry`, …).
2. **Trust-fabric coherence.** Relationships (spec 216) and identity
   profiles (spec 217) will ALSO ship metadata-bearing contracts in
   their Phase 3. If naming uses one pattern and relationships uses
   another, the trust fabric splinters at the data layer.

## Decision

Bring the ontology + SHACL pattern on chain for `agent-naming`'s
records resolver, AND expose the shared contracts under
`apps/contracts/src/ontology/` so relationships + identity reuse
them in their Phase 3 (no parallel implementations).

Specifically:

1. **`apps/contracts/src/ontology/OntologyTermRegistry.sol`** —
   governance-gated registry of permitted predicate ids. Each term
   carries `(id, curie, uri, label, datatype, active)`. Predicates
   MUST be registered + active before any AttributeStorage subclass
   accepts a write.
2. **`apps/contracts/src/ontology/AttributeStorage.sol`** —
   abstract base contract. Eight typed value families (string,
   address, bool, uint256, bytes32, string[], address[], bytes32[]).
   Internal setters check predicate-active in the ontology. Tracks
   predicate insertion order + per-subject version for knowledge-graph
   diff sync.
3. **`apps/contracts/src/ontology/ShapeRegistry.sol`** — SHACL-style
   class-shape registry. Each shape is `(classId, properties[])`
   where each property is `(predicate, expectedDatatype, cardinality,
   enumSetId, expectedClass)`. `validateSubject(classId, subject,
   store)` walks the property set, asserts presence + datatype +
   enum-membership.
4. **`apps/contracts/src/naming/AgentNameAttributeResolver.sol`** —
   inherits `AttributeStorage`. Subject is the namehash node
   (already `bytes32`, no conversion). Authorization stays
   `msg.sender == REGISTRY.owner(node)` (the Smart Agent's
   CustodyPolicy gates upstream — unchanged from the pure version).
5. **Predicate library** —
   `apps/contracts/src/naming/AgentNamePredicates.sol` exposes the
   canonical predicate ids (`ATL_DISPLAY_NAME`, `ATL_ADDR`,
   `ATL_A2A_ENDPOINT`, …) so contract callers + the TS SDK agree on
   the exact bytes32 values.
6. **Shape definition** — `AgentName` (classId =
   `keccak256("atl:AgentName")`) is defined in Deploy.s.sol with all
   properties OPTIONAL initially; a future migration may tighten
   cardinality. `agentKind` carries an enum set bound to the closed
   {`person`, `org`, `service`} domain. (Updated 2026-05-25: dropped `treasury`
   — a treasury is a service subtype at the profile layer, not an agent kind;
   specs 217/225 §6. Existing testnet records re-seeded as `service` on redeploy.)

## Consequences

**Stronger:**

- **Trust fabric integrity.** A malicious bypass-the-SDK write CAN
  NOT store an unknown predicate — `_requirePredicate` reverts at
  the chain edge.
- **Governed vocabulary.** Predicate set is a public on-chain object
  with provenance (CURIE, URI, label, datatype). Indexers + ENS-style
  consumers can validate against the on-chain registry directly.
- **Cross-package coherence.** Relationships + identity contracts in
  Phase 3 use the SAME ontology + shape registry — one vocabulary
  across the platform.
- **Knowledge-graph mirroring.** `AttributeSet` /
  `AttributeAppended` / `AttributeUnset` events + per-subject version
  watermarks give off-chain syncs a tractable diff feed for RDF
  triple emission.
- **Schema validation on read.** `ShapeRegistry.isValid(classId,
  subject, store)` lets a consumer check "is this AgentName
  well-formed per the current shape?" without re-implementing.

**Costs:**

- **+~650 LOC** of shared Solidity (the three ontology contracts).
- **+~50 LOC** of naming-specific predicate library.
- **Per-write gas +1 SLOAD** for the predicate-active check. Trivial
  versus the cost of the typed setter itself.
- **Predicate registration is a governance action.** Deployer
  bootstraps; future expansion needs the governor's tx. Acceptable
  for trust-fabric vocabulary (it MUST be governed) — would be wrong
  for end-user data (which our model never puts in this layer).
- **Breaking SDK change.** `agent-naming/records` encoder /
  decoder shifts from string keys to `bytes32` predicate ids +
  typed setters. Phase 1 SDK has no external consumers, so the
  break is contained.
- **Another full Base Sepolia redeploy.** Acceptable given the
  user's standing "redeploys are cheap, drift is expensive"
  position.

## Reversal triggers

We would unwind this only if:

- The ontology governance becomes a bottleneck for new predicates
  in practice (an empirical observation, not anticipated).
- A future evolution of the SDK proves the off-chain-only validation
  is enough AND we never need cross-package shape coherence
  (unlikely given the trust-fabric vision).

## What this is NOT

- **NOT a permissioned name registry.** Naming + ownership rules are
  unchanged — anyone with parent-owner / subregistry-delegate auth
  can register a name. The ontology governs only WHICH PREDICATE KEYS
  may appear on resolver records, not who may own a name.
- **NOT a centralized authority for names.** The governor address
  controls only the predicate vocabulary + shape definitions; it has
  zero authority over individual names, ownership, or records' values.
- **NOT a profile / claim registry.** AgentCard JSON still lives off
  chain (per ADR-0007); on-chain we anchor only its content-hash via
  the `atl:metadataHash` predicate.

## Cross-references

- Spec 215 § Phase 3 — updated to reflect the ontology pattern.
- Spec 216 (relationships) + spec 217 (identity) — their Phase 3
  contracts will REUSE the ontology + shape registries deployed
  here; relationships defines a `Relationship` shape, identity
  defines a `Profile` shape.
- smart-agent: `packages/contracts/src/{OntologyTermRegistry,
  AttributeStorage, ShapeRegistry, AgentNameAttributeResolver,
  AgentAccountResolver}.sol` — direct port reference.
