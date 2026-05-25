# Spec 223 — Identity Directory (evidence-backed read model)

**Status:** v0 / planned (2026-05-25).
**Owner:** `@agenticprimitives/identity-directory` (new) +
`@agenticprimitives/identity-directory-adapters` (new).
**Architecture commitment:**
[ADR-0015 — identity-directory is an evidence-backed read model](../docs/architecture/decisions/0015-identity-directory-is-an-evidence-backed-read-model.md).
**Related ADRs:** 0010 (canonical SA), 0012 (no `eth_getLogs`), 0013 (no
fallback), 0016 (CanonicalAgentId CAIP-10), 0018 (ontology).
**Related specs:** [215 (naming)](./215-agent-naming.md),
[217 (profile)](./217-agent-profile.md), [225 (ontology)](./225-ontology.md),
[226 (HCS alignment — AP-2)](./226-hcs-alignment-and-standards.md),
[224 (connect)](./224-agentic-connect.md) (primary consumer).

---

## 1. Purpose

Provide a **queryable knowledge graph over canonical agents and their facets**,
so SSO, convergence, and trust decisions can answer "which agent(s) does this
name / credential / OIDC subject / SIWE address resolve to, and on what
evidence?". The directory is the read side of the identity stack; `agent-naming`
(spec 215) and the on-chain contracts are the authorities it projects.

## 2. What it is — and is NOT

**Is:** a read-only projection (read model) over canonical agents, keyed by
`CanonicalAgentId` (CAIP-10, ADR-0016), assembled from typed evidence sources
through ports. Every association carries provenance + an assurance level.

**Is NOT:**
- **NOT an authority.** It never mints identity, grants custody, or authorizes
  anything. Authority is on-chain (the SA, the naming registry, the custody
  policy). The directory is a cache/index with provenance.
- **NOT a second naming service.** `agent-naming` owns forward/reverse name
  resolution against one registry. The directory consumes naming through a port;
  it does not re-implement it ([ADR-0015](../docs/architecture/decisions/0015-identity-directory-is-an-evidence-backed-read-model.md)).
- **NOT an ontology.** Its node/edge vocabulary conforms to
  `@agenticprimitives/ontology` (spec 225); it does not define its own.

## 3. Package shape & boundaries

Two packages, ports/adapters split:

- **`@agenticprimitives/identity-directory`** (core) — depends only on
  `@agenticprimitives/types`, `@agenticprimitives/audit`,
  `@agenticprimitives/ontology`. Declares the **ports**, the domain model, the
  query API, the assurance/evidence types. Zero source-specific deps (no `viem`,
  no naming import, no indexer SDK, no OIDC lib).
- **`@agenticprimitives/identity-directory-adapters`** — implements the ports.
  Depends on the core + the source SDKs (`viem`, `@agenticprimitives/agent-naming`,
  an indexer client, an OIDC client). This is the ONLY place source-specific code
  lives, so the read model stays swappable and the boundary one-way.

No back-edges: the core is downstream of `types`/`audit`/`ontology` only;
adapters are downstream of core. `agent-naming` is reached through `NamingPort` —
the directory core never imports it.

## 4. Domain model

- **Key:** `CanonicalAgentId` (CAIP-10 string, ADR-0016). Spans `eip155:*` and
  `hedera:*` — a Hedera agent is a valid key the directory can hold and link as
  evidence even though we don't custody it (spec 226 §4).
- **Nodes/edges:** instances of the shared ontology (spec 225) — `Agent`,
  `NameFacet`, `CredentialFacet`, `OidcSubject`, `Org`, edges `isFacetOf`,
  `controls`, `memberOf`, `hasEvidence`.
- **`Evidence`** (every association carries one): `{ source: EvidenceSource;
  observedAt: ISO8601; blockNumber?: bigint; assurance: Assurance; ref: string }`.
- **`Assurance`** (ordered): `'unverified' < 'asserted' < 'onchain-read' <
  'onchain-confirmed'`. Threads into SSO step-up (ADR-0017). A stale/degraded
  source LOWERS assurance — it never fabricates an answer ([ADR-0013](../docs/architecture/decisions/0013-no-silent-fallbacks.md)).
  **`onchain-read` MUST carry `blockNumber` and a max-staleness the consumer
  enforces** (security audit P1-3): a credential revoked on-chain (spec 221) must
  not persist as a valid edge via a stale cache/indexer read. Session-issuance
  has an explicit assurance floor and re-reads the current custodian set
  (spec 224 §5); custody-class/step-up requires `onchain-confirmed`.
- **Profile/content reads are hash-verified** (security audit P2-2): a consumer
  surfacing hash-pinned profile content MUST verify `keccak(fetchedBytes) ==
  metadataHash` before assigning `onchain-confirmed`; a mismatch or unavailable
  URI lowers assurance and never serves unpinned/cached bytes (ADR-0013).

## 5. Ports (declared by core; implemented by adapters)

```ts
interface OnChainReadPort {            // readContract only — NEVER getLogs
  resolveAgent(id: CanonicalAgentId): Promise<AgentRecord | null>;
  credentialsOf(id: CanonicalAgentId): Promise<CredentialFacet[]>;
}
interface NamingPort {                 // wraps agent-naming
  forward(name: string): Promise<CanonicalAgentId | null>;
  reverse(id: CanonicalAgentId): Promise<string | null>;
  // NOTE (audit P1-2): shipped agent-naming is `resolveName(name) → Address|null`
  // and `reverseResolve(Address) → string|null` — chain-UNqualified. The adapter
  // lifts Address → CanonicalAgentId by binding a configured chainId / namespace
  // ref; the core never sees the raw Address. A wrong chainId binding silently
  // yields a wrong subject — the binding is an explicit adapter invariant.
}
interface IndexerPort {                // the home for "indexed registry" reads
  agentsByCredential(principal: CredentialPrincipal): Promise<EvidenceLink[]>;
  agentsByOidcSubject(iss: string, sub: string): Promise<EvidenceLink[]>;
}
interface OidcPort { /* verify an OIDC claim → CredentialPrincipal */ }
```

Each port returns `null`/empty as a terminal answer. There is no "try port A,
fall back to port B" — that violates ADR-0013. Composition is explicit and
declared per query, not an escalation ladder. In particular a `null` from
`NamingPort.forward` is a 0-agent Resolution; the directory never escalates to
`OnChainReadPort`/`IndexerPort` to "find" the name another way (this is the exact
footgun that produced the killed `agent-naming` getLogs walker — ADR-0013).

**Authoritative-port designation (security audit P2-4).** For every
security-relevant query (anything that can authenticate a session), the spec
names ONE **authoritative** port — the on-chain account read path — and treats
others (e.g. `IndexerPort`) as **non-authoritative evidence only**. An empty
authoritative result is terminal; an indexer link may *enrich* the view but can
NEVER by itself authorize a session. This pins the legitimate-composition vs
illegal-fallback line that §5's "compose per query" would otherwise leave to a
one-line implementer decision.

## 6. Query API & convergence

```ts
resolveByName(name): Promise<Resolution>
resolveByCredential(principal): Promise<Resolution>   // 0, 1, or many agents
resolveByOidcSubject(iss, sub): Promise<Resolution>
agent(id): Promise<AgentView | null>                  // facets + evidence
```

`Resolution = { agents: AgentWithEvidence[] }`. **Convergence cardinality is
first-class** (consumed by spec 224):
- **0 agents** → "no agent yet"; the consumer routes to bootstrap (spec 220).
- **1 agent** → the common case; carries its evidence + assurance.
- **many agents** → the consumer disambiguates (e.g. an OIDC subject that is a
  control facet of several agents); the directory returns all with evidence and
  does not pick.

## 7. Doctrine compliance (load-bearing)

- **No `eth_getLogs`** ([ADR-0012](../docs/architecture/decisions/0012-no-eth-getlogs-in-product-read-paths.md)).
  The smart-agent analog (`credential-registry`) resolves via `getLogs`; we port
  the credential→agent *concept*, not the walk. "Indexed registry" reads
  (HCS-2 *indexed* semantics) map to `IndexerPort`; "latest-wins" maps to a
  `readContract` via `OnChainReadPort` (spec 226 §ConflictResolution).
- **No silent fallback** ([ADR-0013](../docs/architecture/decisions/0013-no-silent-fallbacks.md)).
  One mechanism per query; empty is an answer.
- **Not authority.** A custody/auth decision is NEVER derived from directory
  output; it re-reads on-chain. The directory accelerates discovery, not trust.

## 8. Reference: smart-agent patterns to port

From `/home/barb/smart-agent` (branch `003-intent-marketplace-proposal`):
- `packages/credential-registry/src/on-chain-resolver.ts` — credential→agent
  resolution model. **Port the concept; reject the `getLogs` walk** (ADR-0012):
  our resolution is `IndexerPort` + `OnChainReadPort`, not log replay.
- `apps/web/src/lib/agent-resolver.ts` — `getAgentStringProperty` /
  `setAgentStringProperty` / `addAgentController` shapes → our `OnChainReadPort`
  read shapes (read-only; writes belong to naming/custody, not the directory).
- `apps/org-mcp/src/auth/resolve-person-agent.ts` — "resolve a principal to its
  agent" flow → `resolveByCredential` + convergence handling.

**Deliberate divergence:** smart-agent resolves by scanning logs and treats the
resolver as the lookup authority; we are a read model with explicit ports,
provenance, and assurance, and we forbid log scans in read paths.

## 9. HCS alignment (→ AP-2, spec 226)

Adopts HCS-2's *registry concept* (a queryable set of entries with provenance);
**rejects** its *read mechanism* (indexed = replay all topic messages) per
ADR-0012. HCS-27 (ANS transparency log) is the closest HCS analog to the
evidence/provenance model — track it for the evidence schema. Full crosswalk +
divergence rows in spec 226.

## 10. Phased plan

1. **Core types + ports** (`identity-directory`): domain model, `Evidence`,
   `Assurance`, port interfaces, query API surface, ontology conformance check.
2. **Adapters** (`identity-directory-adapters`): `NamingPort` (wraps
   `agent-naming`), `OnChainReadPort` (`viem` `readContract`), `IndexerPort`
   (indexer client), `OidcPort`.
3. **Convergence + assurance** wired into spec 224 entry flows.
4. **Evidence persistence / cache** (cache holds the canonical answer; cache-first
   reads are allowed, mechanism-switching is not — ADR-0013).
