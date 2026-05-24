# ADR-0007 — Agent identity stack is three packages, not seven

**Status:** accepted (2026-05-23)
**Owner:** [technical-architect-auditor](../../agents/technical-architect-auditor.md)
+ [security-auditor](../../agents/security-auditor.md).
**Related:** [ADR-0006](./0006-agent-naming-as-resolution-layer.md)
(agent-naming as resolution layer); [spec 215](../../../specs/215-agent-naming.md),
[spec 216](../../../specs/216-agent-relationships.md),
[spec 217](../../../specs/217-agent-identity.md).

## Context

After ADR-0006 locked the integration shape (agent-naming as a
downstream resolution layer consumed via `NameContext` injection),
two open questions remained for the trust-fabric scope:

1. **How many packages?** The smart-agent reference codebase ships
   ~9 contracts in this space (`AgentRelationship`,
   `RelationshipTypeRegistry`, `AgentAssertion`,
   `AgentRelationshipResolver`, `AgentAccountResolver`,
   `AgentSkillRegistry`, `SkillDefinitionRegistry`,
   `CredentialRegistry`, `MandateRegistry`). A naive port would
   create 7+ packages and force consumers to pick from a buffet.
2. **What about HCS / GoDaddy / ERC-8004 alignment?** Three external
   designs cover overlapping ground: GoDaddy ANS (DNS-rooted), HCS-10/
   11/14 (Hedera-native), ERC-8004 (EVM agent registry). Each has
   ideas worth adopting and ideas worth refusing.

We ran three deep research passes (smart-agent contract survey + HCS
standards 1-20 + GoDaddy ANS + Hashgraph Online registry pattern).
This ADR locks the resulting consolidation.

## Decision

Three downstream packages compose the agent identity stack. Each has
a clear, single audience.

### `@agenticprimitives/agent-naming` — shipped (Phase 1)

Owns: the `.agent` TLD, namehash/labelhash, registry + resolver +
universal-resolver client, name records schema. See
[spec 215](../../../specs/215-agent-naming.md). Architecture per
ADR-0006 (resolution layer; injection via `NameContext`).

### `@agenticprimitives/agent-identity` — new

Owns:
- **HCS-11-aligned typed profile schema** with discriminator
  `type: 'person' | 'org' | 'service' | 'treasury' | 'mcpServer' | 'multisig'`.
  Type-specific sub-objects (`aiAgent.{type, capabilities, model, creator}`,
  `mcpServer.{services, tools, verification, protocolVersion, ...}`,
  `multisig.{members, threshold}`). Profile blob lives off-chain
  (IPFS / EAS); on-chain record is a `metadata-uri` + `metadata-hash`.
- **HCS-14 CAIP-10 `nativeId` helper** — pure encoder/decoder for
  `eip155:<chainId>:<address>` (and friends). NOT a UAID generator;
  see ADR-0008.
- **mcpServer verification methods** — DNS TXT challenge, signed-URL
  attestation, HTTP challenge endpoint, Verifiable Presentation
  acceptance. The "is this MCP endpoint really controlled by this
  agent" answer.
- **Agent-card schema** — single canonical JSON shape consumers
  fetch at `metadata-uri` instead of chasing a dozen records (the
  one good idea from GoDaddy ANS).

Adapted from: smart-agent's `AgentAccountResolver.sol` (274 LOC)
+ HCS-11 schema + HCS-14 nativeId shape + ERC-8004 alignment.

### `@agenticprimitives/agent-relationships` — new

Owns:
- **`AgentRelationship` contract** — edge store keyed by
  `(subject, object, relationshipType)`. ~392 LOC.
- **`RelationshipTypeRegistry` contract** — relationship type
  metadata (hierarchical / transitive / symmetric flags). ~138 LOC.
- **Relationship taxonomy constants** — `NAMESPACE_CONTAINS`,
  `ORGANIZATION_GOVERNANCE`, `HAS_MEMBER`, `VALIDATION_TRUST`,
  `PARTNERSHIP`, and the role hashes that pair with each type.
- **`AgentRelationshipsClient`** — read + write methods, audit hook.

**Deferred to v2 (with a future spec amendment):**
- `AgentAssertion` (signed claim layer over edges, 150 LOC) — only
  needed when a consumer wants edge-confirmation gating.
- `AgentRelationshipResolver` (policy layer, 111 LOC) — only needed
  when a consumer wants assertion-gated edge resolution.

Adapted from: smart-agent's relationship contracts (clean primitives;
`AgentRelationship` has zero smart-agent imports — verified by
contract-survey agent 2026-05-23).

## Refused (with rationale)

### Refused: 7-package decomposition

A faithful per-contract port would create 7+ packages. Audited
against "what's the consumer story?": consumers always import
profile + UAID + verification together (they describe the same
off-chain blob), so splitting them creates 3 packages every
consumer pulls. Consolidation into `agent-identity` is the right
shape.

### Refused: `agent-credentials` in this wave

Smart-agent's `CredentialRegistry` (171 LOC, zero deps) is a clean
standalone primitive but solves the AnonCreds verifiable-credentials
problem. We don't have a use case for AnonCreds in the next 90 days.
**Defer until we do.** When it lands, it ships as
`@agenticprimitives/agent-credentials` with a similar shape.

### Refused: `agent-skills` in this wave

Smart-agent's `AgentSkillRegistry` (424 LOC) depends on
`SkillDefinitionRegistry` (271 LOC); together ~700 LOC of contracts
plus a substantial taxonomy. Skills logically depend on credentials
(for endorsement) and relationships (for `edgeId` linkage), so they
belong AFTER both are stable. **Defer to v2.**

### Refused: HCS-10 four-role topology (Inbox / Outbox / Connection topics)

HCS-10 splits agent communication into Registry + per-agent Inbound
+ per-agent Outbound + ephemeral Connection topics. Elegant for
audit isolation, but the EVM equivalent (per-agent event streams +
session-keyed pairwise channels) is substantial infrastructure with
no current demand from demos. **Port when we have a real A2A
demo flow that needs it.** Until then, demo-a2a's single relay
endpoint is sufficient.

### Refused: HCS-19 privacy_compliance schema in this wave

Useful when GDPR/CCPA work begins. Defer until we have explicit
compliance posture to encode.

### Refused: GoDaddy's DNS-domain-as-namespace model

`agent.example.com`-style names tether identity recovery to ICANN
politics and Web2 registrar account recovery. Our value prop
(passkey-direct custody, custody-governed records) collapses if a
user loses `sam.agent` because GoDaddy locked their account. The
`.agent` TLD stays globally addressed via our own registry; we
adopt GoDaddy's ideas about **agent-card JSON structure**,
**transparency-via-audit-events**, and **structured capability
records**, but not their trust root.

### Refused: GoDaddy's X.509 / SCITT PKI hybrid

Reintroduces CA trust anchors we explicitly removed by going
passkey-direct. Our auth root is the Smart Agent's ERC-1271 routed
through CustodyPolicy quorum. Use audit events emitted to the
existing `@agenticprimitives/audit` sink for transparency; don't
bolt on a parallel CA.

### Refused: HCS-15 petal accounts

EVM accounts ARE the key — you can't share one key across multiple
addresses. Closest analog is counterfactual smart-account siblings
under one controller, which our factory already supports via CREATE2.
Skip the "petal" vocabulary entirely.

### Refused: HCS-16 Flora (native ThresholdKey + 3-topic accounts)

We have our own threshold/recovery primitives (CustodyPolicy, spec
207 + spec 209). A Smart Agent IS the multisig. No parallel "Flora
account" abstraction.

## Consequences

**Positive:**
- Three packages instead of seven. One consumer story per package.
- No back-edges in the workspace graph; `pnpm check:all` invariants
  hold.
- HCS-14 + ERC-8004 cross-resolver interop achieved at low cost via
  CAIP-10 `nativeId` record predicate (see ADR-0008) — without
  taking on full UAID derivation.
- HCS-11 profile schema gives every agent a typed, off-chain-blob
  shape that consumers can render uniformly (Person vs Org vs MCP
  server cards in the demo).
- `agent-relationships` is reusable beyond naming — trust-fabric
  attestations, role assignments, partnerships, the relationship
  graph the smart-agent project also uses for downstream features.
- The contract-port surface stays manageable: ~530 LOC of relationships
  + ~274 LOC of profile resolver + agent-naming registry already
  in flight. Approximately one Wave's contract review.

**Negative:**
- Consumers who want credentials or skills must wait for v2.
  Acceptable; the smart-agent reference code is available if a
  consumer wants to fork those contracts early.
- HCS-10 topology absent means our agent comms model stays
  single-channel until a demo demands more. UX-fine; auditors will
  note this is by design.

## Validation

Architecture is verified-correct when:
- `pnpm check:all` passes (capability manifests, boundaries, vocab firewall).
- No `@agenticprimitives/agent-{identity,relationships,naming}` import
  appears in `delegation`, `mcp-runtime`, `tool-policy`, `key-custody`,
  `audit`, `custody`, `agent-account`. (Injection via `NameContext`
  from `types`, never direct import — per ADR-0006.)
- Specs 215, 216, 217 cross-reference cleanly and each declares its
  package's boundary.
- `apps/contracts` ports `AgentRelationship` + `RelationshipTypeRegistry`
  + `AgentNameAttributeResolver`-equivalent profile resolver in their
  respective Forge test suites, each independently green.
