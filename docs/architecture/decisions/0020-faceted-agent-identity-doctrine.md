# ADR-0020 — Faceted Agent Identity Doctrine

**Status:** Accepted (2026-05-27).
**Related:** [ADR-0010](./0010-smart-agent-canonical-identifier.md) (Smart Agent
address is canonical), [ADR-0015](./0015-identity-directory-is-an-evidence-backed-read-model.md)
(directory evidence), [ADR-0016](./0016-canonical-agent-id-is-the-sso-subject.md)
(CAIP-10 subject), [ADR-0019](./0019-relying-site-authority-is-a-scoped-delegation.md)
(relying sites are delegates), [spec 223](../../../specs/223-identity-directory.md),
[spec 225](../../../specs/225-ontology.md).

---

## Context

As the agent graph grows, a Smart Agent accumulates many contextual surfaces:
names, credentials, profiles, trust evidence, commerce roles, skills, geography,
domain memberships, and future vertical claims. It is tempting to let one of
those surfaces become "the identity" or to treat a rich facet as authority.

That would undo ADR-0010. A canonical Smart Agent is not the sum of its login
methods, names, profiles, trust records, commerce roles, domain memberships, or
vertical claims.

The canonical Smart Agent is the anchor.

## Decision

> **Every contextual identity surface is a facet of the canonical Smart Agent.
> Facets can be resolved, discovered, displayed, or used as evidence. Facets do
> not own the canonical agent and do not authorize by themselves. Authority still
> comes from custody or delegation.**

Do not use **"identity"** as a generic package name for new capabilities. In this
architecture, "identity" means the canonical Smart Agent anchor:

```text
CanonicalAgentId = CAIP-10 Smart Agent address
```

Everything else is a facet of that anchor.

Facet categories include:

- name facet
- credential facet
- profile facet
- trust facet
- commerce facet
- skill facet
- geo facet
- relationship facet
- domain facets such as fitness and faith
- organization-membership facet

Facets may be public, private, verified, asserted, revoked, domain-specific, or
externally sourced.

## Package Naming Consequences

Package names MUST reflect the facet or capability they own, not generic
"identity."

- Rename `identity-directory` to **`agent-resolution`**.
- Rename `identity-directory-adapters` to **`agent-resolution-adapters`**.
- Do **not** create `agent-directory`.
- Create **`agent-discovery`** for search and matching.
- Create **`agent-skills`** and **`agent-geo`** for skill and geo facets.
- Start intent under **`agent-discovery/intent`**, not as `agent-intent`, unless
  intent proves to have an independent release boundary and consumer base.
- Treat ERC-8004 as a **trust / external-registry facet**, not canonical identity.
- Treat commerce, fitness, faith, and other vertical domains as **domain facet
  extensions**, not core identity packages.

This is a doctrine-level rename plan. Code may continue to carry old package names
during migration, but new design docs and new package proposals should use the
names above.

## Capability Boundaries

- **`agent-resolution`** answers: "which canonical agent does this
  facet/principal resolve to?"
- **`agent-discovery`** answers: "which agents match this user need?"
- **`agent-profile`** answers: "what does this agent claim publicly?"
- **`agent-relationships`** answers: "how is this agent connected to other
  agents?"
- **`agent-skills`** answers: "what capabilities does this agent claim?"
- **`agent-geo`** answers: "where does this agent operate?"
- **`delegation`** answers: "what may the selected app/agent do?"

Discovery and resolution never authorize by themselves.

## Consequences

- **No facet is identity.** `rpedersen.agent`, a passkey digest, a profile URL, a
  skill claim, a geo claim, an org membership, or a trust score points at the
  canonical Smart Agent; none replaces it.
- **No facet is authority.** A facet can contribute evidence or context, but a
  write/action path must still prove custody or hold a valid delegation.
- **Discovery can broaden safely.** New vertical packages (`agent-skills`,
  `agent-geo`, commerce/faith/fitness/domain packages) can add facets without
  changing the identity anchor.
- **Resolution and discovery stay evidentiary.** `agent-resolution` and
  `agent-discovery` projections can aggregate facets with provenance and
  assurance, but they do not mint identity or grant authority.
- **UX can stay simple.** Product surfaces may say "Connected Apps,"
  "Skills," "Service area," or "Memberships," while implementation treats each as
  evidence attached to a durable Smart Agent.

## Explicitly Not Taken

- **Facet-owned identity.** Rejected: it makes names, credentials, profiles, or
  domain memberships compete with the canonical Smart Agent.
- **Facet-granted authority.** Rejected: a verified skill, role, membership, or
  trust record may inform policy, but cannot authorize by itself.
- **Vertical identity silos.** Rejected: faith, fitness, commerce, geo, and skill
  domains may define facets, not new canonical identity roots.

## Implementation Rule

When adding a new identity-adjacent concept, first ask:

```text
Is this the canonical Smart Agent anchor,
or is it a facet that points at the anchor?
```

The answer should almost always be "facet." If a feature needs authority, route it
through custody or delegation, not the facet itself.
