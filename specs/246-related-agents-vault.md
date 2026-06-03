# Spec 246 — Related-agents vault (private person↔org links)

**Status:** draft, 2026-06-02.
**Owner:** Connect (demo-sso-next) + `packages/related-agents`; first consumer demo-jp.
**Architect-of-record for:** `packages/related-agents`, the Connect org-create privacy refactor, and
the `/connect/related-orgs` + `/connect/delegated-orgs` query surface.
**Companion ADR:** [ADR-0025 — Related-agent links are private](../docs/architecture/decisions/0025-related-agent-links-are-private.md).
**Architecture-of-record:** [ADR-0019](../docs/architecture/decisions/0019-relying-site-authority-is-a-scoped-delegation.md)
(relying-site authority = scoped delegation), [ADR-0021](../docs/architecture/decisions/0021-generic-packages-vs-white-label-apps.md)
(generic packages vs white-label apps), [ADR-0010](../docs/architecture/decisions/0010-smart-agent-canonical-identifier.md)
(SA address is the canonical id), [privacy-and-self-sovereign-identity.md](../docs/architecture/privacy-and-self-sovereign-identity.md)
(vault residency, visibility tiers).

## 1. Problem

When a connected person creates an org through Connect, the person↔org relationship leaks into
**public/local** state instead of staying private:

1. The org-create ceremony writes a public `personSA --HAS_GOVERNANCE_OVER--> orgSA` edge on the
   AgentRelationship contract (`apps/demo-sso-next/src/connect-client.ts createChildAgentForSite`).
2. The relying app (demo-jp) persists the `person→org` map locally
   (`apps/demo-jp/src/lib/member-org.ts MemberOrg.ownerPerson`).

Both expose "this person controls that org" — the public graph and the relying app's own store. The
desired posture: **the public graph is org↔org only when consented; person↔org is private vault state.**

## 2. Target model

When a relying app asks Connect to create (or link) a **related agent** for the connected person:

1. **Connect creates the org SA** — its own ERC-4337 address, custodied by the person's ROOT credential
   (ADR-0010 + spec 220), claims a `.impact` name. **No on-chain person→org edge.**
2. **Connect writes a private situation credential into the person's vault** — self-issued by the
   person home/ROOT (issuer = holder = personSA):
   - `holder` = personSA, `relatedAgent` = orgSA, `purpose` (e.g. `jp-adopter-org`),
     `requestedBy` = the relying app's `client_id`, `issuer` = personSA, `visibility = private`.
   - DOLCE+DnS Situation (`verifiable-credentials.buildSituation`), `Eip712Signature2026` proof.
3. **The relying app receives only what it needs** — `{ orgAgent, orgName, scoped org→site delegation,
   proof (credential hash) }`. Never the person→org map.
4. **Later the relying app asks Connect** "list org credentials related to me" rather than reading its
   own store. Connect returns the person's related-agent links scoped to that `client_id`. Org metadata
   (name, public profile) is resolved from the naming service / public org profile.
5. **Connect also mints an `org→broker-org` delegation** so a designated broker org SA can later
   **list the orgs delegated to it** (`/connect/delegated-orgs?delegate=`). This is how the JP broker
   org enumerates the adopter/facilitator orgs that granted it scoped access — no person→org exposure.

## 3. Confidentiality

| Artifact | Visibility |
| --- | --- |
| person → org link | **private** vault credential only (never public, never relying-app-local) |
| adopterOrg ↔ facilitatorOrg situation | **private** by default |
| org public profile / name | public (naming service) |
| org ↔ org joint agreement assertion | public **only** on explicit bilateral publication (spec 242, unchanged) |

The public graph is org↔org and only on consent; person↔org never by default.

## 4. The `related-agents` package (generic — ADR-0021)

Owns the **shape**, not the storage or the vocabulary. Vertical-agnostic (`purpose` is a free string;
no faith/JP terms), transport-agnostic (no MCP/hostnames). Depends on `@agenticprimitives/{types,
verifiable-credentials, delegation}` only.

- `buildRelatedAgentCredential(args)` → `UnsignedCredential<Situation<{ payload }>>`
  (description `apra:RelatedAgentCredential`; roles `{ holder, relatedAgent, issuer }`; participants
  `{ purpose, requestedBy, visibility }`; body `{ agentName, agentKind? }`).
- `relatedAgentReadCaveats({ enforcers, validUntil })` — the scoped-delegation caveat set a grantee
  (relying site or broker org) gets to read related-agent metadata (timestamp + value=0 + allowed
  targets); reuses the `delegation` caveat primitives, no new enforcer.
- Types: `RelatedAgentLink` (`orgAgent, orgName, purpose, requestedBy, delegation, proofHash`),
  `ListRelatedAgentsResponse`, `ListDelegatedAgentsResponse`.

Sits beside (NOT inside) `agent-relationships`, which owns **on-chain** edges only — this is the
off-chain, holder-resident, private sibling.

## 5. Connect surface (demo-sso-next)

- Org-create ceremony: remove the proposeEdge/confirmEdge edge; after deploy, mint + ROOT-sign the
  situation credential, store it + both delegations (`org→site`, `org→broker`) in the Connect-home KV
  vault keyed by `personSA` (+ a `delegate→delegator` index). `grantOrg` (broker org SA) is supplied by
  the relying app and **validated against its whitelabel relying-app config** (anti-spoof).
- `GET /connect/related-orgs?client_id=` — **person-session-authorized**; returns the person's
  related-agent links for that `client_id`.
- `GET /connect/delegated-orgs?delegate=` — authorized by **proof of control of `delegate`**; returns
  the orgs that delegated to it.

## 6. Reference: smart-agent patterns to port

From `/home/barb/smart-agent` (branch `003-intent-marketplace-proposal`):

- **PORT:** `packages/sdk/src/credential-types.ts` `OrgMembershipCredential` — an org-relationship
  credential **held in the person's personal vault** (not in the org), issued about a person↔org link.
  We adopt the "relationship as a holder-resident credential" idea.
- **DELIBERATELY DIVERGE:** smart-agent's `packages/sdk/src/relationship-taxonomy.ts`
  `ORGANIZATION_GOVERNANCE` models person↔org as an **on-chain edge**. We do NOT — person↔org is a
  **private vault credential**, never a public edge (ADR-0025). Why: the public trust graph must not
  reveal which person controls which org by default; only consented org↔org assertions are public.

## 7. Out of scope

Third-party-issued related-agent credentials (issuer ≠ holder); cross-device vault sync; on-chain
publication of the person→org link (forbidden by ADR-0025); migrating existing on-chain edges (none
should be created going forward — pre-existing demo edges are abandoned).
