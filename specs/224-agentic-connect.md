# Spec 224 — Agentic Connect (SSO broker)

**Status:** v0 / planned (2026-05-25).
**Owner:** `@agenticprimitives/connect` (new) + `apps/demo-sso` (new, the hosted
broker origin). Updates `@agenticprimitives/connect-auth` (real OIDC) +
`@agenticprimitives/types` (`AgentSession`, `CredentialPrincipal`, `Assurance`).
**Architecture commitment:**
[ADR-0014 — Connect is an SSO broker at a central origin](../docs/architecture/decisions/0014-connect-is-an-sso-broker.md).
**Related ADRs:** 0010 (canonical SA), 0011 (credential recovery), 0016
(CanonicalAgentId / no owner), 0017 (OIDC = login facet / step-up), 0008
(CAIP-10).
**Related specs:** [200 (connect-auth)](./200-connect-auth.md),
[223 (directory)](./223-identity-directory.md), [220 (bootstrap)](./220-agent-identity-bootstrap.md),
[221 (recovery)](./221-credential-recovery.md).

---

## 1. Purpose

Single-sign-on across relying websites: a user proves a credential once at the
**Connect origin** and receives an `AgentSession` bound to their canonical Smart
Agent. Relying sites integrate by redirect, never by running credential
ceremonies themselves.

## 2. Broker model (ADR-0014)

- Credential ceremonies (passkey / SIWE / OIDC) run on **one central Connect
  origin** (e.g. `connect.<host>`, served by `apps/demo-sso`). The passkey RP id
  is the Connect origin, so one enrollment serves every relying site.
- A relying site opens Connect via redirect/popup, and receives back a signed
  `AgentSession` token. It never sees raw credential material.
- `@agenticprimitives/connect` is the **state machine + token issuer**
  (transport-agnostic). `apps/demo-sso` is the hosted origin. Depends on
  `@agenticprimitives/types`, `@agenticprimitives/connect-auth` (credential
  methods), `@agenticprimitives/identity-directory` (convergence).

## 3. `AgentSession` shape (ADR-0016 — no owner)

```ts
interface AgentSession {
  sub: CanonicalAgentId;          // CAIP-10 — the canonical subject (NEVER a name, NEVER bare Address)
  principal: CredentialPrincipal; // the credential that authenticated this session
  assurance: Assurance;           // login-grade vs custody-grade (ADR-0017)
  aud: string;                    // relying-site client_id this token is for
  iss: string;                    // the Connect origin
  iat: number; exp: number;       // short-lived
  jti: string;                    // replay id
  // NO `owner` field. A credential CONTROLS an agent under custody policy; it does not OWN it.
}
interface CredentialPrincipal {
  kind: 'passkey' | 'siwe-eoa' | 'hardware' | 'oidc';
  id: string;                     // credentialId / EOA address / "iss#sub" — a facet key, not the identity
  assurance: Assurance;
}
```

The principal→subject relationship is **"this credential is a control facet of
this agent under its custody policy"** — authorization, never ownership.

## 4. Token design — asymmetric broker token + same-origin HS256

Two distinct tokens, two trust models:

- **`BrokerSession`** (same-origin) — the broker's own session at the Connect
  origin. `connect-auth`'s **HS256** JWT (symmetric, rotated) is fine: issuer ==
  verifier, one trust domain. It is named (`BrokerSession`), NOT "the session", to
  keep it distinct from `AgentSession` and from the delegation `SessionRow`
  (vocabulary-map rows required).
- **`AgentSession`** (cross-origin) — delivered to *independent relying sites*
  that must verify but must NOT be able to forge. **Asymmetric**, private key held
  only by the broker, published via a **JWKS endpoint** with `kid` +
  overlapping-key rotation. Relying sites verify with the public key.
  **Algorithm: EdDSA/Ed25519 is the default**; **ES256 is a documented
  *capability* fallback** (published as a second `kid` in JWKS) for relying-site
  JOSE stacks lacking Ed25519 — this is algorithm capability negotiation, NOT a
  mechanism fallback, and does NOT violate ADR-0013 (the verifier still uses
  exactly one key/alg per token).

> **Why not reuse HS256 cross-origin:** HS256 verification needs the signing
> secret, so every relying site could forge tokens for any user and one leak
> burns the whole fabric. Asymmetric keeps the broker the sole minter — exactly
> the OIDC IdP model, which also lets Connect become an OIDC provider later.

**Token-soundness controls (security audit P1-1):**
- **Pin the expected algorithm set per key; NEVER read `alg` from the token.**
  Reject `alg: none`. (Defends RS/ES↔HS alg-confusion + pubkey-as-HMAC-secret.)
- **Disjoint `kid` namespaces AND distinct `iss`** for `BrokerSession` (HS) vs
  `AgentSession` (asymmetric); verify `iss` FIRST so an HS token can never enter
  the asymmetric verifier and the HS secret can never leak into cross-origin
  verification.
- **Bounded JWKS cache TTL + a key-compromise revocation runbook** (a removed key
  must stop verifying within the TTL, not whenever caches expire). Gate-5 runbook.

Binding rules: `aud` = relying-site client_id (exact match); short `exp`;
`state` + `nonce` round-tripped; `sub` = `CanonicalAgentId`. Delivery + replay:
see §4a.

## 4a. Redirect & response delivery (security audit P0-1 / P2-1)

The broker is an IdP-class trust concentration (ADR-0014). The `AgentSession`
MUST NOT be delivered as a bearer token in a redirect URL. Controls:

- **`redirect_uri` allowlist, per `client_id`, exact-match**, registered
  out-of-band (never user-supplied/derived). Same discipline as spec 200 §6 CSRF
  origins. Blocks open-redirect → token exfiltration.
- **Authorization-code-style delivery, not implicit.** The redirect carries a
  single-use, short-TTL (≤120s) `code`; the relying site exchanges it server-side
  at the broker token endpoint (which holds the atomic single-use store) for the
  `AgentSession`. Keeps the token out of URLs/history/Referer/proxy logs and gives
  a `jti`/`code` replay store the relying site need not run itself.
- **Popup/`postMessage` mode:** pin `targetOrigin` to the registered relying
  origin; never `*`.
- **Bind `state` to the relying origin**; reject on mismatch. Defends IdP/broker
  mix-up.
- New threat-model boundary **"Browser ↔ Connect origin"** + evidence-checklist
  rows `CN-1`…`CN-12` (added in `docs/audits/`).

## 5. Entry flows + convergence

Four entry flows, all resolving to a `CanonicalAgentId` via
`identity-directory` (spec 223):

| Entry | Resolve step |
|---|---|
| **Name** (`alice.agent`) | `directory.resolveByName` → CanonicalAgentId |
| **OIDC** (Google/GitHub) | verify claim → `directory.resolveByOidcSubject(iss, sub)` |
| **SIWE / EOA** | verify signature → `directory.resolveByCredential` |
| **Passkey** | assert → `directory.resolveByCredential` |

**Convergence cardinality** (from spec 223 §6) decides the next state:
- **0 agents** → route to bootstrap (spec 220): create + name + custody a new SA,
  then issue the session. **Rate-limited + verified-credential-gated** (security
  audit P2-3): bootstrap triggers an on-chain deploy + a forced-unique name claim,
  so it is a deploy-spam / name-squat surface — gate behind a verified credential
  (e.g. `email_verified`, §6) + per-IP/per-subject token-bucket; prefer deferring
  the on-chain deploy to a deliberate user action over auto-on-first-login.
- **1 agent** → issue `AgentSession`. **Session issuance has an assurance floor
  and re-reads authority** (security audit P0-3 / P1-3): the credential→agent edge
  backing the session MUST be re-read from an authority source (the on-chain
  current custodian/credential-facet set via the account read path), NOT accepted
  from an `asserted`/stale directory edge — the directory accelerates *discovery*,
  it never *authorizes* (ADR-0015). A credential revoked on-chain (spec 221) MUST
  NOT ride a stale edge into a session.
- **many agents** → present a disambiguation step (the credential is a control
  facet of several agents); the user picks; never auto-select. **The selection is
  validated server-side to be a member of the exact convergence result** held in
  the `BrokerSession` (security audit P1-2) — never trust a client-echoed `sub`,
  or an attacker tampering the picker selects an agent the credential does not
  control.

**Non-EVM subject gate (security audit P1-5).** A `CanonicalAgentId` whose
namespace is not EVM-custodied (currently only `eip155`; `hedera:*`/`solana:*`
are `controlStatus = "identifier-only"` per spec 225 §6) gets at most a
**read/identifier-grade** session and can NEVER reach step-up or any control
action — there is no on-chain custody policy to evaluate against. Make this a
first-class convergence branch, not an implicit failure.

## 6. OIDC implementation (ADR-0017)

Replaces the `connect-auth` Google **stub** with a real implementation:
- **PKCE + `state` + `nonce`** mandatory; validate `iss` + `aud`; bind the
  resulting session to the resolved `CanonicalAgentId`, never to the raw OIDC
  `sub`.
- **Require `email_verified=true`** (security audit P0-3); reject claims/providers
  that don't assert it. The facet edge is keyed on `(iss, sub)`, never on email,
  to resist email-reuse takeover.
- **Providers:** **Google** first (canonical OIDC: discovery doc + id_token +
  PKCE). **GitHub** second — note GitHub is **OAuth2, not full OIDC** (no
  id_token/discovery), so the `OidcPort` adapter synthesizes a verified subject
  from the userinfo API and **MUST key the subject on the immutable numeric
  account `id`, never the reusable `login`/username** (security audit P0-3) — a
  renamed/reclaimed username must not inherit prior facet edges. **Apple deferred**
  (form_post + ES256-JWT client secret + first-auth-only name → later drop-in via
  the same port).
- OIDC is a **login facet, not custody** (ADR-0017): an OIDC-only session gets a
  lower `assurance` and cannot authorize custody-class actions.

## 7. WebAuthn hardening (broker origin)

- RP id = the Connect origin (single RP → SSO works).
- Server-generated, single-use, expiring **challenges**; reject on mismatch.
- Strict **origin + RP-id** validation on assertion; low-`s` enforcement.
- **`userVerification: 'required'`** (security audit P1-4) — without UV a
  stolen-but-unlocked authenticator asserts silently.
- **Explicit signCount policy** (a known footgun): accept `signCount = 0` from
  platform authenticators (Apple/most return 0), enforce strict-monotonic when
  non-zero, and **audit any regression** as possible cloned-authenticator.
- **Anti-phishing posture** (the single-RP central origin concentrates phishing):
  the relying-site SDK pins the Connect origin; no downgraded fallback method;
  consider registered-origin attestation. ADR-0014 names this trust concentration.

## 8. Step-up (ADR-0017)

Custody-class actions — credential add/replace/remove (spec 221), custody-policy
changes, above-threshold value movement, delegation issuance above a threshold —
require **step-up** to a custody-grade credential the on-chain custody policy
recognizes.

- **The step-up on-chain check uses the custody/account read path directly**
  (spec 221 / `agent-account` / `account-custody` — ERC-1271 + custody policy),
  **never `identity-directory`'s ports** (security audit P2-4). The directory
  accelerates *discovery*; authority verification is a separate, direct on-chain
  read, keeping the read-model/authority line sharp (ADR-0015).
- **A login-grade (e.g. OIDC) session authorizes NO on-chain state change at all**
  (security audit P0-2). It is **read + initiate-only**. There is no Connect-side
  "low-risk write" tier: `AgentAccount` userOp validation knows only signatures
  against the custodian set, not an off-chain `assurance` label, so any write —
  even a "low-risk" one — must be signed by a credential the on-chain policy
  recognizes. "Pre-authorized low-risk bounds" therefore means an **on-chain
  session-key policy** (a scoped ERC-7579 session-key module with on-chain
  spend/target caveats), NOT a Connect-side assurance judgment. This keeps
  ADR-0017's tiering load-bearing instead of cosmetic.

## 9. Anti-patterns (hard "do NOT")

- `AgentSession.owner`, or any ownership-implying field (ADR-0016).
- `sub` = a name or a bare `Address` — `sub` is always the CAIP-10
  `CanonicalAgentId`.
- Treating an OIDC/social login as custody authority (ADR-0017).
- Embedding the passkey ceremony in a relying site (per-site RP → no SSO; ADR-0014).
- Reusing the HS256 secret for cross-origin tokens (§4).
- Reading `alg` from the token, or accepting `alg: none` (§4).
- Authorizing ANY on-chain state change from a login-grade session (§8).
- Trusting a client-echoed disambiguation `sub` not server-validated against the
  convergence result (§5).
- Issuing a session off an `asserted`/stale directory edge without re-reading
  on-chain authority (§5).
- Leaking `smartAccountAddress`/`walletAddress`/`owner`-shaped fields into the
  cross-origin `AgentSession` (§12 step 1–2).
- Delivering the `AgentSession` as a bearer token in a redirect URL, or
  `postMessage` with `targetOrigin: '*'` (§4a).
- Deriving custody authority from session membership (custody changes go through
  `account-custody` / spec 221, never a session).

## 10. Reference: smart-agent patterns to port

From `/home/barb/smart-agent` (branch `003-intent-marketplace-proposal`):
- `apps/a2a-agent/src/routes/session*.ts` — session issue/verify flow → our
  broker state machine + `AgentSession` issuance.
- `packages/sdk/src/session.ts` + `packages/sdk/src/passkey.ts` — passkey
  ceremony + session token client → the Connect-origin ceremony + relying-site
  SDK.
- `apps/web` `use-auth` hook — the consumer-side session consumption pattern →
  the relying-site integration shape.

**Deliberate divergence:** smart-agent runs auth per-app and treats the session
principal as the account holder; we run a **central broker** (ADR-0014), issue a
**CAIP-10-subject, no-owner** `AgentSession` (ADR-0016), use an **asymmetric**
cross-origin token (§4), and gate custody behind **step-up** (ADR-0017).

## 11. HCS alignment (→ spec 226)

Mostly a **divergence declaration**: HCS-10 (OpenConvAI) inbound/outbound/
connection topics have **no analog** — Connect is HTTPS-redirect SSO, not a
topic mesh. HCS-15's account/key separation parallels our credential-rotates /
identity-persists model (ADR-0011). Full rows in spec 226 (AP-10, AP-15).

## 12. Phased plan

1. `types`: **promote `agent-profile`'s `Caip10Address` brand + `Caip10Parts` +
   `buildCaip10Address(parts)` + `parseCaip10` + `CAIP10_NAMESPACE_ALLOWLIST` into
   `types`** as `CanonicalAgentId` (`agent-profile` re-exports — one brand, one
   builder, namespace-plural; P0-1/P0-2). Add `AgentSession`, `CredentialPrincipal`,
   `Assurance`; keep the P8 `CanonicalAgentIdentity = Address` as the within-chain
   EVM handle (a *different* concept, not renamed).
2. `connect-auth`: real OIDC (Google) with PKCE/state/nonce + `email_verified`;
   WebAuthn challenge + UV hardening. **Specify the `JwtClaims` (spec 200 §3) →
   `AgentSession` translation** (security audit P2-5): re-resolve
   `smartAccountAddress → CanonicalAgentId` at mint time (never trust the claim),
   and define-or-delete `kind: 'session-grant'` under the no-owner model; no
   `smartAccountAddress`/`walletAddress`/`owner`-shaped field may leak into the
   cross-origin token.
3. `connect`: broker state machine, asymmetric token + JWKS, entry flows wired to
   `identity-directory` convergence.
4. `apps/demo-sso`: hosted Connect origin + ≥2 relying sites proving one-enroll
   SSO; GitHub OIDC added; step-up demo for a custody-class action.
