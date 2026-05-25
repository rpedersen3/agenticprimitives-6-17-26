# Agentic Connect + Identity Directory + Ontology — Construction Plan

**Status:** draft for architecture + security review (2026-05-25).
**Scope:** the SSO wave — 4 new packages, 1 new app, 3 updated packages, a formal
ontology, and an HCS-standards alignment layer.
**Authoritative specs:** [223 directory](../../specs/223-identity-directory.md) ·
[224 connect](../../specs/224-agentic-connect.md) ·
[225 ontology](../../specs/225-ontology.md) ·
[226 HCS alignment](../../specs/226-hcs-alignment-and-standards.md).
**Authoritative ADRs:** [0014](decisions/0014-connect-is-an-sso-broker.md) ·
[0015](decisions/0015-identity-directory-is-an-evidence-backed-read-model.md) ·
[0016](decisions/0016-canonical-agent-id-is-the-sso-subject.md) ·
[0017](decisions/0017-oidc-social-is-a-login-facet-not-custody.md) ·
[0018](decisions/0018-agenticprimitives-wide-formal-ontology.md) — building on
existing [0008](decisions/0008-caip10-nativeid-record-predicate.md) (CAIP-10) +
[0009](decisions/0009-on-chain-ontology-shacl-naming.md) (on-chain ontology).

This document is the single circulatable overview. The specs/ADRs are the source
of truth; this narrates how they fit and where the open questions are.

---

## 1. Goal

Let a person prove a credential **once** at a central Connect origin and get a
session bound to their canonical Smart Agent that works across every relying
site — without any relying site running credential ceremonies, and without a
social IdP ever becoming a takeover vector for the canonical identity.

## 2. The shape (one diagram in words)

```
 relying site ──redirect──▶  Connect origin (apps/demo-sso)
                                │  @agenticprimitives/connect  (state machine + token issuer)
                                │     ├─ credential ceremonies → @agenticprimitives/connect-auth
                                │     └─ "which agent?"        → @agenticprimitives/identity-directory (core)
                                │                                    └─ ports ── @…/identity-directory-adapters
                                │                                                 ├─ NamingPort  → agent-naming
                                │                                                 ├─ OnChainPort → viem readContract
                                │                                                 ├─ IndexerPort → SPARQL/GraphDB (A-box)
                                │                                                 └─ OidcPort    → Google/GitHub
                                ▼
 relying site ◀──AgentSession (asymmetric, JWKS-verifiable)──┘
```

Everything keys on **`CanonicalAgentId`** (CAIP-10) and conforms to the
**ontology** (T-box/C-box/A-box). The on-chain ontology contracts (ADR-0009) are
the per-chain enforcement of the same vocabulary.

## 3. Packages

**New (4):**
| Package | Role | Depends on |
|---|---|---|
| `@agenticprimitives/ontology` | formal vocabulary (T-box/C-box/A-box + context.jsonld + HCS mappings) | (none internal) |
| `@agenticprimitives/identity-directory` | evidence-backed read model (core: ports + query API) | types, audit, ontology |
| `@agenticprimitives/identity-directory-adapters` | port implementations (naming/on-chain/indexer/OIDC) | identity-directory, agent-naming, viem |
| `@agenticprimitives/connect` | SSO broker state machine + token issuer | types, connect-auth, identity-directory |

**Updated (3):**
- `types` — **promote the CAIP-10 TYPE into `types`** (`Caip10Address` brand +
  `Caip10Parts`) as `CanonicalAgentId`; the runtime builder/parser/allowlist STAY
  in `agent-profile` (types is runtime-free), re-typed + re-exported — one brand,
  one builder (audit P0-1/P0-2). Add `CredentialPrincipal`, `AgentSession` (no
  `owner`), `Assurance`, `CredentialKind`, `CredentialRole`; keep
  `CanonicalAgentIdentity = Address` as the within-chain EVM handle. **✅ done.**
- `connect-auth` — replace the Google **stub** with real OIDC (PKCE/state/nonce +
  `email_verified`); WebAuthn challenge + UV + origin hardening for the broker
  origin; specify the `JwtClaims`→`AgentSession` translation.
- `agent-profile` — HCS-11 alignment pass (spec 226 §7); re-export
  `CanonicalAgentId` from `types`.

**New app:** `apps/demo-sso` — the hosted Connect origin + ≥2 relying sites
proving one-enroll SSO + a step-up demo.

## 4. Load-bearing decisions (and why)

1. **Broker, not embedded** (ADR-0014). Passkeys are RP-origin-scoped — per-site
   ceremonies = per-site RP = no SSO. One central origin, one RP, redirect-based.
2. **Subject = `CanonicalAgentId` (CAIP-10), no `owner`** (ADR-0016). Cross-chain
   by construction (`eip155:*` + `hedera:*`); builds on the existing CAIP-10
   `nativeId` (ADR-0008). A credential *controls* an agent under custody policy;
   it never *owns* it — so `AgentSession` has no `owner` field.
3. **Directory is a read model, not authority** (ADR-0015). It answers "which
   agent?" with provenance + assurance; it never grants custody. Authority is
   re-read on-chain. Ports/adapters keep the core dependency-clean.
4. **OIDC/social = login facet, not custody** (ADR-0017). Lower assurance;
   custody-class actions require **step-up** to a custody-grade credential,
   evaluated on-chain.
5. **Cross-origin token is asymmetric** (spec 224 §4). HS256 would force sharing
   the signing secret with every relying site (any site could forge). EdDSA/ES256
   + JWKS keeps the broker the sole minter — the OIDC IdP model.
6. **Ontology is monorepo-wide, off-chain, formal** (ADR-0018), organized
   T-box/C-box/A-box like the reference work, paired in lockstep with the
   existing on-chain ontology (ADR-0009).

## 5. Entry flows + convergence

Four entries (name / OIDC / SIWE / passkey) all resolve through the directory to
a `CanonicalAgentId`. Convergence cardinality drives the next state:
**0 → bootstrap** (spec 220), **1 → issue session**, **many → disambiguate** (never
auto-pick). See spec 224 §5.

## 6. Security model (for the security audit)

- Fail-closed: a degraded port lowers assurance + errors; never fabricates
  (ADR-0013). No `getLogs` in read paths (ADR-0012).
- WebAuthn: server-generated single-use challenges, strict origin/RP-id check,
  low-`s`, signCount handling.
- OIDC: PKCE + state + nonce, iss/aud validation, session bound to
  `CanonicalAgentId` not raw `sub`.
- Token: asymmetric, `aud`-bound, short `exp`, JWKS `kid` rotation,
  state/nonce replay protection.
- Custody firewall preserved into the session layer: no `owner`, no
  custody-from-session; recovery stays in `account-custody` (spec 221).

## 7. HCS alignment (the standards layer)

The project is already HCS-14/CAIP-10 aligned (ADR-0008) and has an on-chain
SHACL ontology (ADR-0009). Spec 226 formalizes this as the **AP-⟨n⟩ series** (thin
alignment layer mirroring HCS numbers; free numbers ≥50 for our own). Highest
value: **AP-11** (HCS-11 profile, ~70% aligned → an alignment pass on spec 217),
**AP-14** (CanonicalAgentId, the keystone), **AP-2** (directory, where the
no-getLogs divergence is formalized). Two doctrine conflicts surfaced + resolved:
HCS-2 indexed-replay (→ IndexerPort) and HCS-11 memo-as-identity (→ hash-pinned,
custody-gated facet — stronger). The `hcs-standards-advisor` agent is the standing
consult.

## 8. Phasing

- **Phase 0 (this wave): specs + ADRs + ontology skeleton + roster + audits.**
  ✅ landed (ADRs 0014–0018; specs 223–226; spec 100 §4; this doc; HCS advisor +
  crosswalk; architect + security audits with findings folded back in — see
  [`docs/audits/sso-wave-audit-findings.md`](../audits/sso-wave-audit-findings.md)).
- **Phase 1:** `types` shapes ✅ + `ontology` (`context.jsonld` + `tbox/core`+`identity`
  + `CanonicalAgentIdShape` + controlled vocabularies + IRI constants) ✅ +
  `connect-auth` real Google OIDC (PKCE/state/nonce + RS256/JWKS via Web Crypto +
  `email_verified`; spec 200) ✅. **Phase 1 complete.**
- **Phase 2:** `identity-directory` core (ports + Evidence/Assurance + query API:
  indexer-proposes / on-chain-confirms; spec 223) ✅ + `identity-directory-adapters`
  (NamingPort wraps agent-naming + eip155 lift; OnChainReadPort viem `exists` +
  app-wired `confirmsCredential`; in-memory IndexerPort) ✅. **Phase 2 complete.**
- **Phase 3:** `connect` broker — asymmetric AgentSession token + JWKS (alg-pinned,
  no-owner; CN-4), convergence + issuance (assurance floor + non-EVM gate +
  disambiguation binding; CN-2/5/6/8), code-exchange redirect security (CN-1/9),
  step-up classification. ✅ **Phase 3 complete** (package side of the wave done).
- **Phase 4:** `apps/demo-sso` (2 relying sites, one-enroll SSO, GitHub OIDC,
  step-up demo); HCS-11 alignment pass on spec 217.

## 9. Open questions — resolved by the audits

1. **`identity-directory-adapters` importing `agent-naming`** — **approved** as the
   right home (audit P1-1); core forbids importing naming/adapters; a new
   `check:dependency-graph` is needed (the firewall is per-manifest today). spec 100 §4.
2. **Ontology namespace + triple store** — **pinned** `https://agenticprimitives.dev/ns/`;
   triple store = any SPARQL-1.1 store, GraphDB the reference, kept behind
   `IndexerPort` (not in the core). spec 225 §4/§7.
3. **OIDC provider set** — **Google + GitHub** for the demo (GitHub OAuth-not-OIDC,
   keyed on numeric id), Apple deferred. spec 224 §6.
4. **Broker token algorithm** — **EdDSA/Ed25519 default**, ES256 a published
   capability-fallback `kid` (not a mechanism fallback). spec 224 §4.
5. **Ontology scope bound** — phase-1 = identity/credential/custody/delegation/
   audit/naming **+ org** (org added per audit P2-3). spec 225 §11.

Full finding-by-finding disposition: [`docs/audits/sso-wave-audit-findings.md`](../audits/sso-wave-audit-findings.md).
