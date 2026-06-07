# ADR-0033 — Content-agnostic verifiable-content firewall; no licensed content, no content text on-chain

**Status:** Accepted (2026-06-07).
**Related:** [spec 266](../../../specs/266-verifiable-content-substrate.md) (the
substrate this rule protects), [spec 267](../../../specs/267-scripture-demo-vertical.md)
(its first vertical), [ADR-0010](./0010-smart-agent-canonical-identifier.md) (the
canonical-identifier rule this carves an exception into for *content*),
[ADR-0021](./0021-generic-packages-vs-white-label-apps.md) (generic packages vs
white-label apps — this is its content-substrate corollary),
[ADR-0012](./0012-no-eth-getlogs-in-product-read-paths.md) +
[ADR-0013](./0013-no-silent-fallbacks.md) (read-path discipline the substrate
inherits).

---

## Context

We are adding a **verifiable content substrate** (spec 266): name → resolve →
commit → entitlement-gate → cite, for content that lives off-platform and is
controlled by third-party rights holders. Its first domain is scripture verses
(spec 267).

Two risks would sink it if not fixed as architecture:

1. **Legal.** If the platform's code, schemas, fixtures, tests, examples, or docs
   ever reference or embed *copyrighted* translations (NIV/ESV/…), or put any
   rendering text into a commitment preimage we store or a chain, we create
   unauthorized derivatives/indexes and a permanent on-chain record that cannot
   be deleted. The platform must stay purely mechanical and content-agnostic.

2. **Architectural.** The stack's canonical-identifier rule (ADR-0010, "every
   name is a facet of a Smart Agent address") does not fit *content*. A verse
   reference is not an Agent; treating it as one would push us toward per-verse
   on-chain registration — absurd at corpus scale and a vertical leak into the
   naming protocol.

## Decision

**The verifiable-content substrate is content-agnostic and content-text-free.**

- **R1 — No licensed content, anywhere.** No package, app, test, fixture,
  example, or doc references, embeds, normalizes, hashes, or commits any
  copyrighted work or edition token. Trust flows from the issuer's signature +
  access policy (R5), never from the platform knowing the text.
- **R3 — No content text on-chain or in a platform-held commitment preimage.**
  The commitment layer and any future contract store only hashes / Merkle roots /
  descriptors / signatures / retrieval pointers. `ContentDescriptor` carries a
  `retrievalPointer`, never inline text; the rendering text stays with the rights
  holder / a public-domain source and is fetched off-platform.
- **R4 — Content-agnostic core.** The `apcnt:` ontology namespace and the
  `@agenticprimitives/content-primitives` package carry zero vertical/faith
  vocabulary. `contentType` and the reference *scheme* (book table, grammar) are
  opaque, app-injected adapters.
- **Content loci are scheme-anchored, not SA-anchored** (the ADR-0010 carve-out).
  A `CanonicalLocus` is a deterministic id computed from a normalized reference;
  it is never registered and has no owner. Only *issuers/corpora* (rights
  holders) and *parties* (readers, resolver agents) remain Smart Agents under
  ADR-0010 — `agent-naming` governs them, not the content.

(R2 — "one public-domain translation, pluggable" — and R5 — "trust = issuer
signature + access policy" — are stated in spec 266; R2 is an app-vertical rule
enforced in spec 267, R5 is the substrate's design principle.)

## Amendment (2026-06-07) — vertical-extension layer + deterministic canonical locus

- **`domains/` tier (NOT a `packages/` carve-out).** ADR-0021 ("verticals live in
  apps") is amended to add a middle tier: a vertical that is **reused across apps**
  (e.g. `scripture-content-extension`) may be a **reusable, named package** — but
  it lives under a top-level **`domains/`** directory, NOT under `packages/`.
  `packages/*` stays 100% reusable substrate with **no carve-outs**: the
  `no-domain-in-packages` scan covers `packages/` only and needs no per-package
  exemption. The generic core (`packages/content-primitives`, the `apcnt:`
  ontology) carries **zero** vertical vocabulary — even in examples. A `domains/`
  package may carry its vertical's vocabulary (scripture canon, versification,
  alias grammars). People-group / faith / health verticals follow the same rule:
  `packages/` = substrate, `domains/` = reused vertical, `apps/` = deployment.
- **Canonical locus id is deterministic, not allocated.** A canonical id is
  `keccak256("ap:canonical-locus-id:v1\0" || JCS(envelope))` over a
  schema-validated, controlled-token, scheme-independent envelope — NOT a random
  allocator id and NOT a hash of a surface string. This keeps addressing
  registry-free + reproducible while making identity scheme-independent and
  versification-governed (spec 266 v2). Four identity layers stay
  domain-separated (locus / descriptor / artifact-commitment / citation).

## Enforcement

- **New** `pnpm check:no-licensed-content` (`scripts/check-no-licensed-content.ts`):
  scans `packages/*/src/**`, `apps/*/src/**`, specs, and docs for a deny-list of
  well-known copyrighted edition tokens; fails the build on any hit. Wired into
  `pnpm check:all`.
- The existing `pnpm check:no-domain-in-packages` already blocks faith vocabulary
  (`scripture`, `gospel`, …) in `packages/*/src` — that keeps R4 honest for the
  `verifiable-content` package and the `apcnt:` IRI surface.
- R3 in apps: a descriptor-shape assertion (SHACL `ContentDescriptorShape` +
  an app test) ensures descriptors carry `retrievalPointer` and never a text
  literal.

## Consequences

- The substrate is reusable for any rights-managed content domain (lyrics, legal
  codes, standards, dictionaries), not just scripture — the boundary is earned
  generically and proven by the scripture vertical.
- The demo is legally defensible: it ships only public-domain text (spec 267) and
  demonstrates the licensed/private path with mock corpora whose descriptors carry
  pointers + commitments, never copyrighted text.
- Populating authoritative namespaces for *copyrighted* translations becomes a
  rights-holder action (they publish signed manifests/descriptors under their own
  terms) — a feature of the ownership-respecting design, not a gap in ours.
- Adding a copyrighted edition token, content text in a commitment we store, or a
  faith term to a package is a hard error.
