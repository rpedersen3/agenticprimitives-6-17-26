# ADR-0025 — Related-agent links are private vault credentials, not on-chain relationships

**Status:** Accepted (2026-06-02).
**Drivers:** privacy posture (the public trust graph must not reveal who controls which org by
default); ADR-0019 (relying-site authority is a scoped delegation, not custody); ADR-0021 (generic
packages, app-level vocabulary); ADR-0010 (SA address is the canonical id).
**Concrete spec:** [spec 246 — Related-agents vault](../../../specs/246-related-agents-vault.md).

---

## Context

When a connected person created an org through Connect, two paths leaked the **person↔org
relationship**:

1. The org-create ceremony wrote a public `personSA --HAS_GOVERNANCE_OVER--> orgSA` edge on the
   AgentRelationship contract.
2. The relying app stored the `person→org` map locally.

Both publish "this person controls that org" — once on-chain for anyone, once in the relying app's own
store. That contradicts the privacy posture: a person's organizations are their private affair; the
public graph should only ever carry **org↔org** relationships, and only on explicit consent.

## Decision

**A person↔org link (and, by extension, any relying-app-requested related-agent link) is a private,
holder-resident vault credential — never an on-chain relationship and never relying-app-local
person→org state.**

1. **No on-chain person→org edge.** Org creation does not write any AgentRelationship edge between the
   person and the org. The org is its own SA, custodied by the person's ROOT credential (ADR-0010); the
   control relationship is implicit in custody, not asserted as a public edge.
2. **The link is a private situation credential** in the person's vault — self-issued by the person
   home/ROOT (issuer = holder = personSA), `visibility = private`, carrying `relatedAgent`, `purpose`,
   and `requestedBy` (the relying app). It is the person's own record of "I have this org, created for
   this app's flow."
3. **Relying apps do not persist person→org.** They receive only `{ orgAgent, orgName, scoped
   delegation, proof }` and later **query Connect** ("list my related orgs for this app") rather than
   reading a local map. The person's vault, held at their Connect home, is the source of truth.
4. **The public graph stays org↔org and only on consent.** The only public surface for relationships is
   the bilateral on-chain assertion path (spec 242 AttestationRegistry), which requires explicit
   adopter/facilitator publication. person↔org is never published by default.
5. **Broker access is a scoped delegation, not an edge.** When a broker org needs to discover
   participating orgs, Connect mints an `org→broker-org` delegation and serves a
   "list orgs delegated to me" query — scoped, revocable, and carrying no person identity.

## Consequences

- The org-create ceremony drops the proposeEdge/confirmEdge userOps; it mints + stores a situation
  credential and (optionally) a broker delegation instead.
- A new generic `related-agents` package owns the credential shape + scoped-delegation caveats + the
  list-query types (composing `verifiable-credentials` + `delegation`). It sits **beside**
  `agent-relationships` (on-chain edges only), never inside it.
- Connect gains a small vault + two scoped query endpoints; the relying app loses its person→org store.
- Pre-existing demo person→org edges on-chain are abandoned (not migrated); none are created going
  forward.

## Alternatives rejected

- **Keep the on-chain edge (status quo).** Publishes person→org to anyone reading the graph — the exact
  privacy leak this ADR closes.
- **Model the link in `agent-relationships` as an off-chain edge.** That package is on-chain trust-graph
  only; a vault credential is a different concern (ADR-0021 boundary discipline).
- **Relying-app-held person→org store.** Distributes the leak to every relying app and makes the person
  unable to revoke visibility centrally. The vault-at-home + query model keeps the person in control.

## `agent-relationships` is structurally PUBLIC — keep it that way (do NOT pretend privacy)

`agent-relationships` (the on-chain edge package) is **structurally public and experimental**: an edge
written to the AgentRelationship contract is visible to anyone reading the chain. Do **not** try to make
it "private" — hiding a public edge is a category error. Privacy for person↔org and any sensitive org
relationship is the job of the PRIVATE related-agent credentials / vault claims this ADR establishes
(`related-agents` + the Connect vault), never a "hidden" on-chain edge.

**Product rule — consent-gated publication.** A PUBLIC relationship assertion (an `AgentRelationship`
edge, or a published org↔org joint assertion — spec 242) is written **only after explicit bilateral
user/org consent**. Default visibility is private (vault). The public graph is **org↔org and only on
consent**; **person↔org is never public by default**.

So the two siblings, by design:
- `agent-relationships` — **public**, experimental, **consent-gated** org↔org edges.
- `related-agents` — **private**, holder-resident credentials (the default for anything sensitive).

This closes the recurring "AgentRelationship privacy" finding: it is not a gap to fix; it is the correct,
deliberate split — public edge package + private vault package.
