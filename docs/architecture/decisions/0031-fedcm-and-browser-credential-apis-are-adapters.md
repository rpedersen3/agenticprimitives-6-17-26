# ADR-0031 — FedCM (and browser credential APIs) are integration adapters, not the substrate

**Status:** accepted (2026-06-05) · **Spec:** [264](../../../specs/264-fedcm-idp-adapter.md) · **Extends:** [spec 260](../../../specs/260-identity-architecture-doctrine.md) Part VII (the layered model), [ADR-0029](0029-relying-app-vs-idp-responsibility-split.md) (relying app asks for access; the home resolves the person) · **Relates:** [ADR-0010](0010-smart-agent-canonical-identifier.md), [ADR-0011](0011-credential-recovery-and-re-association.md)

## Context

A strategic assessment of FedCM (the W3C/Chrome **Fed**erated **C**redential **M**anagement API)
concluded it is **directionally correct for us, as a browser-facing federation adapter — not as the core
substrate.** FedCM is built around IdPs and RPs: a relying site calls `navigator.credentials.get({
identity: … })` and the **browser** mediates account selection + sign-in with an IdP, with no
third-party cookies and no redirect/iframe plumbing. That maps cleanly onto our model — Person/Org Agent
= IdP-facing identity authority; relying site = RP; browser = consent/account-chooser mediator; the
agenticprimitives authority graph = the substrate underneath. It would let "Sign in with my Person Agent"
/ "Sign in with my Organization Agent" sit beside "Sign in with Google / Apple," so **relying sites never
have to learn wallets, delegation caveats, smart accounts, DID methods, or agent registries** to
integrate.

**Adoption signals (why FedCM-first is a reasonable bet):**
- Google **kept FedCM** (and CHIPS) while *retiring* much of Privacy Sandbox (Topics, Protected Audience,
  Attribution Reporting, Shared Storage, Related Website Sets) — Oct 2025.
- Shipped in **Chrome 108**; **Chrome 136** added *multiple IdPs in one call* (load-bearing for our
  multi-IdP story); **Chrome 143** added structured JSON responses + endpoint validation (some breaking,
  required by 145) — i.e. *active* development.
- **W3C** Recommendation track, but still a **First Public Working Draft**; FedID WG calls scheduled
  through 2026.
- Chrome ≈ **70%** browser share (May 2026) → real gravity even before cross-browser maturity.

**The caution (why not FedCM-only):** MDN marks FedCM **"Limited availability / Experimental,"** not
Baseline (absent in some major browsers); Google's own RP docs tell developers to **feature-detect** and
**fall back**. Safari/Firefox interest exists but is not production-ready. Probability that FedCM becomes
the *core authorization/delegation substrate*: low (~15–25%) — it is **authentication/federation
plumbing, not an authority model**.

## Decision

**Browser credential APIs (FedCM, WebAuthn/passkeys, the Digital Credentials API, OAuth/OIDC, SIWE) are a
swappable *browser-integration adapter layer* over the agenticprimitives authority substrate. The
substrate — Person/Org/Service Agent, capability, delegation, caveat, mandate, revocation, audit — is the
single source of authority truth and is NEVER encoded into a browser API's scope/claim set.**

Concretely:

1. **FedCM-first, not FedCM-only.** Where the browser supports it, relying sites integrate via a FedCM
   IdP interface we expose. Everywhere else, the existing path (the spec-259 "Continue with the home"
   popup/redirect + OIDC code) is the fallback. The choice is **feature-detected** (`IdentityCredential`
   presence), never assumed.
2. **The FedCM assertion is a THIN identity + intent bootstrap**, not the authority model. It carries
   `iss / aud / sub (= the Smart Account, ADR-0010) / agent_did / origin / nonce / intent /
   delegation_request_hash` and nothing more. **The deep capability/delegation object is issued by the
   substrate** *after* FedCM bootstraps identity — never expressed as FedCM `scope` strings.
3. **The split is fixed:** *FedCM answers "who is this user/agent to this relying site?"* The substrate
   answers *"what authority does this agent have, who granted it, under what caveats, can it sub-delegate,
   can it act for an org, can it transact, how is it revoked, how is it audited?"* (the spec-260 §VII.5–7
   authority-chain model). FedCM is **not** used for: agent-to-agent mandates, transaction-signing
   authority, multi-hop delegation, caveated permissions, org governance, proof-of-revocation, audit
   trails, or cross-chain authority.
4. **Package boundary (ADR-0021 + spec 100):** the *reusable, transport-generic* FedCM primitives
   (config/manifest builders, assertion build + verify, RP `get()` wrapper, feature-detect + fallback
   selector) live in **packages** (`fedcm-idp` / `fedcm-rp` / `browser-identity` — names provisional);
   the **IdP endpoint hosting + the account list + per-deployment config** live in the **app**
   (demo-sso). No white-label/vertical content in the packages.
5. **Watch the Digital Credentials API as the companion**, not a competitor: FedCM = federated *sign-in*
   ("Sign in with my Person Agent"); Digital Credentials API = browser-mediated *presentation/issuance of
   verifiable credentials* ("present this proof/claim"). The substrate wants both surfaces over the same
   authority graph (spec 260 §IV.2). We build FedCM now and keep the adapter seam ready for DC-API.

## Consequences

- **Strategic posture (the load-bearing sentence):** *agenticprimitives is not betting the substrate on
  FedCM — it is making the substrate accessible through FedCM when the browser supports it.* Embrace the
  signal; avoid platform lock-in; degrade gracefully.
- We gain a **web-native relying-site on-ramp** (mainstream onboarding, multi-IdP account chooser) that
  composes with — and never replaces — the authority graph.
- The adapter layer is **modular and replaceable**: if FedCM stalls cross-browser, the substrate and the
  fallback path are untouched; if DC-API matures, it slots into the same seam.
- **Risk owned:** FedCM's experimental status means the IdP adapter MUST ship behind feature-detection
  with the spec-259 path as the guaranteed fallback, and MUST track the Chrome 143→145 breaking-change
  surface. Recorded in spec 264.
- This is a **boundary decision**, so it is an ADR; the **endpoint set, assertion schema, package shapes,
  and phased rollout** are specified in **spec 264**.
