# ADR-0015 — identity-directory is an evidence-backed read model, separate from agent-naming

**Status:** Accepted (2026-05-25).
**Related:** [spec 223](../../../specs/223-identity-directory.md), [spec 215](../../../specs/215-agent-naming.md), [spec 225](../../../specs/225-ontology.md), [ADR-0012](./0012-no-eth-getlogs-in-product-read-paths.md), [ADR-0013](./0013-no-silent-fallbacks.md), [ADR-0016](./0016-canonical-agent-id-is-the-sso-subject.md), [ADR-0018](./0018-agenticprimitives-wide-formal-ontology.md).

---

## Context

SSO and convergence ("which agents does this credential / name / OIDC subject
resolve to?") need a **queryable knowledge graph** over canonical agents: their
names, credential facets, OIDC subjects, SIWE addresses, org memberships, and
the *evidence* for each association. `@agenticprimitives/agent-naming` already
exists, but it owns exactly one thing: forward + reverse **name** resolution
against the on-chain naming registry. Overloading it with credential graphs,
OIDC subject maps, and provenance would blow its boundary and its context
budget, and would entangle a single-registry resolver with a multi-source
projection.

## Decision

> **`@agenticprimitives/identity-directory` is a read-only projection (read
> model) over canonical agents and their facets, assembled from typed evidence
> sources via ports/adapters. It is NOT an authority and NOT a second naming
> service.**

- The directory **answers queries**; it never mints identity. Authority lives
  on-chain (the SA, the naming registry, the custody policy). The directory is
  a cache/index with provenance.
- Every association the directory returns carries **evidence**: which source
  asserted it (on-chain read, indexer, naming registry, OIDC claim), at what
  block/time, and an assurance level. No anonymous facts.
- Evidence sources are **ports** (`OnChainReadPort`, `NamingPort`,
  `IndexerPort`, `OidcPort`, …) declared by the directory core. The **adapters**
  that implement those ports live in a separate package,
  `@agenticprimitives/identity-directory-adapters`, so the core stays free of
  source-specific deps (viem, naming, indexer SDKs, OIDC libs) and adapters are
  swappable without touching the read model.
- The directory's node/edge **vocabulary conforms to the monorepo-wide
  ontology** (`@agenticprimitives/ontology`, [spec 225](../../../specs/225-ontology.md) /
  [ADR-0018](./0018-agenticprimitives-wide-formal-ontology.md)). The directory
  does NOT define its own ontology; it projects instances that validate against
  the shared RDFS/OWL/SHACL vocabulary (Agent, Credential, Name, OidcSubject,
  Org, edge predicates).
- Core depends only on `@agenticprimitives/types`, `@agenticprimitives/audit`,
  and `@agenticprimitives/ontology` (vocabulary IRIs/shapes). It does NOT depend
  on `agent-naming`; naming is reached through `NamingPort`, whose adapter (in
  `identity-directory-adapters`) wraps `agent-naming` — keeping the boundary
  one-way and the dependency injected.

### Forbidden

- `eth_getLogs` / inline log walking in directory read paths
  ([ADR-0012](./0012-no-eth-getlogs-in-product-read-paths.md)). The
  smart-agent analog (`credential-registry`) resolves via `getLogs`; we port
  the credential→agent *concept*, not the log walk — projections come from an
  indexer port or on-chain stored fields.
- Treating directory output as authority (e.g. granting custody because the
  directory says a credential maps to an agent). Authority = on-chain reads.
- Silent fallback when a port is unavailable ([ADR-0013](./0013-no-silent-fallbacks.md)):
  a degraded source surfaces as lowered assurance + a typed error, never a
  fabricated answer.

## Consequences

**Positive:** naming stays a tight single-registry resolver; the graph gets a
home with explicit provenance and assurance, which is exactly what step-up and
convergence decisions need; sources are swappable without touching callers.

**Negative:** two packages touch "identity" and the boundary between
"name resolution" (naming) and "graph projection" (directory) must be policed
by the vocabulary firewall + consumer map. The directory's correctness depends
on its adapters; assurance levels must be honest about staleness.

## Cross-references

- [spec 223 — identity-directory](../../../specs/223-identity-directory.md)
- [spec 215 — agent-naming](../../../specs/215-agent-naming.md) (the boundary peer)
- [spec 225 — ontology](../../../specs/225-ontology.md) + [ADR-0018](./0018-agenticprimitives-wide-formal-ontology.md) (shared vocabulary the directory conforms to)
- `@agenticprimitives/identity-directory-adapters` (ports' implementations)
- CAIP-10 subject keys: [ADR-0016](./0016-canonical-agent-id-is-the-sso-subject.md)
