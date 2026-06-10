# ADR-0038 — Many-registries hypothesis: ship registry-building primitives, don't bet on a winning registry

**Status:** Accepted (2026-06-10).
**Related:** [ADR-0037](./0037-primitives-pure-repo-external-integration-and-ux-layers.md) (Ring 0 primitives / external layers — this ADR defines what Ring 0 ships for the registry/discovery category), [ADR-0010](./0010-smart-agent-canonical-identifier.md) (registry entries are facets of the SA anchor), [feature-analysis doc 12](../../feature-analysis/12-agent-registry-discovery-intents.md) + [doc 91](../../feature-analysis/91-next-push-discovery-to-outcomes.md) (the analyses this ADR re-frames).

---

## Context

The feature analysis (docs 12, 90, 91) implicitly assumed the agent-registry
category resolves the way naming did — one or two winners (ERC-8004 on-chain,
GoDaddy ANS in the enterprise, HCS on Hedera) that everyone conforms to. Our
verdicts followed that assumption: "conform + register", "bridge", "be listed
everywhere".

**We reject that assumption.** The operating hypothesis is now:

> **There will be hundreds of registry implementations** — many with their own
> contracts — and most of the durable ones will be **vertical**: healthcare
> provider-agent registries, travel booking-agent registries, commerce/
> merchant-agent registries, professional-services registries, jurisdictional
> registries. Each will have its own membership rules, claim schemas,
> validation requirements, and economics. No horizontal registry wins them all,
> for the same reason no horizontal database schema ever won every industry.

If that's true, "which registry do we conform to?" is the wrong strategic
question. The right one is: **what does every one of those hundreds of
registries need that they shouldn't have to build?** Answer: exactly what this
substrate already is — a canonical identity anchor, custody, signed claims,
attestation-backed reputation, delegation-bounded authority, and audit
evidence. A vertical registry is ~20% registry-specific (membership policy,
vertical schema, governance) and ~80% trust plumbing every other registry also
needs.

## Decision

**The substrate's registry strategy is to be the thing registries are built
FROM, not a tenant of the registries that exist.** Ring 0 ships a
**registry-building primitive set** — contracts, SDKs, and standards — that
lets anyone stand up a vertical agent registry whose entries are facets of
custody-protected Smart Agents. Concepts are deliberately drawn from ERC-8004
(identity/reputation/validation separation, `agentURI` indirection) and HCS
(profile standards, UAID-style cross-protocol identity, transparency logs,
fee-gated economics) — **as design inputs, not conformance targets.**

### The registry kit (Ring 0 scope)

| Piece | What it is |
| --- | --- |
| **Contracts** | Generic, vertical-agnostic registry base patterns: SA-anchored entry registration (entry owner IS a Smart Agent — custody/recovery inherited for free); pluggable membership/validation policy hooks (issuer-attested admission, stake, quorum); typed claim slots backed by `attestations`; complete indexable events; expiry/renewal/revocation lifecycle (the AN-2 lesson, designed in from the start) |
| **SDK** | A discovery + registry client/server kit: register/resolve/query interfaces that work against *any* kit-built registry; signed agent-card production/verification (the doc 91 §2.1 primitive — the acceptance test generalizes from "A2A/8004/ANS" to "**any registry**"); claim/endorsement verification (domain-bound digests — the NEW-SKILL-1 lesson); skill-term matching against `agent-skills`/`ontology` vocabularies |
| **Standards** | Published, versioned specs for the card schema, entry↔SA binding proof, claim schema slots, and registry-projection rules — so independent implementations interoperate without importing our code |

### What this does NOT change

- **ADR-0037 venue rules stand.** The kit is generic primitives (Ring 0).
  Every *specific* registry — vertical, jurisdictional, or a bridge into
  ERC-8004/ANS/HCS — is Ring 1/2, external, composing the kit. We still don't
  ship an 8004 client here.
- **Interop verdicts stand, demoted from strategy to tactics.** Being listed
  in ERC-8004 / ANS / HCS surfaces (via external layers) is still worth doing —
  as *n* of *hundreds*, not as the bet.
- **ADR-0010 stands and gets stronger.** With many registries, "every entry is
  a facet of one canonical SA" stops being a doctrine preference and becomes
  the only sane cross-registry identity model: one agent, one address, *n*
  registry facets.

## Strategic consequences

1. **The category bet inverts.** Competitors fight to be the registry; we
   profit from registry proliferation regardless of which ones win. More
   registries = more kit consumers = more SA-anchored agents.
2. **Roadmap re-weighting (doc 90/91):** the registry kit enters as first-class
   P1 work (FG-REG-10 contracts+standards, FG-REG-11 SDK); bridge items
   (FG-REG-1/3/6/8) remain external and become *reference consumers* of the
   kit rather than the point.
3. **Vertical registries are the natural first Ring 1/2 products** for
   white-label deployments (ADR-0021's app layer) — a vertical's registry is
   app-layer config + kit, not new trust code.
4. **Standards posture:** we publish *our own* small standards (card schema,
   binding proof) the way HCS publishes theirs — because in a many-registries
   world, the projection/interop spec is the durable artifact, not any single
   registry contract.
5. **Risk accepted:** the hypothesis may be wrong — a single registry could
   win network-effects-style. Mitigation is cheap: kit-built registries can
   project into a winner via Ring 1 bridges (the card/binding primitives are
   registry-agnostic by construction), so the work is not stranded either way.

## Drift triggers — STOP and route

- "Pick the winning registry and conform deeply" → **STOP.** Tactical listing
  via Ring 1 is fine; strategic conformance is the rejected assumption.
- "Add healthcare/travel/commerce registry features to the kit" → **STOP.**
  Vertical = Ring 1/2 + app config (ADR-0021); the kit stays vertical-agnostic.
- "Skip the standards doc, just ship the code" → **STOP.** In this hypothesis
  the spec IS the moat; independent implementations must be able to interop
  without our packages.
