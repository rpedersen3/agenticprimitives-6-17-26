# Spec 260 — Identity architecture doctrine: the relying app asks for access, the home resolves the person

**Status:** reference / doctrine (authority document) · **Generalizes:** [spec 259](259-relying-idp-responsibility-split.md) + [ADR-0029](../docs/architecture/decisions/0029-relying-app-vs-idp-responsibility-split.md) · **Grounds:** [ADR-0010](../docs/architecture/decisions/0010-smart-agent-canonical-identifier.md) (SA address is the identity), [ADR-0011](../docs/architecture/decisions/0011-credential-recovery-and-re-association.md) (credentials rotate, identity persists) · **Last researched:** 2026-06-05

> This spec is the *why* behind the connect flow. Spec 259 is the product decision; this is the
> standards-and-experts foundation it rests on, plus the forward map for passkeys, biometrics, digital
> credential wallets, and AI-agent identity. It is meant to be cited in code reviews and onboarding, and
> to settle "should the relying app collect X?" arguments by appeal to a named authority rather than taste.

---

## 0. Thesis (one paragraph)

A digital identity is a **stable, opaque, never-reassigned subject key**. Everything a human reads or
types — a name, a handle, an email, and even the *credential* used to prove control (passkey, wallet,
Google account) — is a **mutable facet** over that key, not the key itself. It follows that a **relying
application asks only for access** ("Continue with X" + what it wants to do) and **trusts the returned
subject**; the person's **home** owns credential choice, the account chooser, name lookup/claim,
recovery, linking, consent — **and the person's data, organizations, agreements, agents, and the
delegations that grant relying apps scoped access**. This is not our opinion — it is the consensus of the
OpenID Connect and OAuth standards, the W3C WebAuthn model, every major hosted-login product, the
verifiable-credentials holder/verifier model, and the foundational identity literature. Our only
opinionated move (justified below) is to make the subject key an on-chain **Smart Account address** and
the name an optional on-chain handle that may be entirely absent.

---

## Part 0 — What "the home" is: Impact is far more than SSO

A standing correction for this whole document: **the home (Impact / demo-sso) is NOT just an identity
provider.** SSO is one capability of a much larger thing — a **personal, sovereign data-and-agent home**.
Throughout this spec, wherever the federated-identity literature says "the IdP", read "**the home**". The
list below is grounded in the *actual* demo-sso-next routes and the `packages/*` substrate, not an
aspiration:

| Home capability | What it is | demo-sso route(s) · package(s) |
| --- | --- | --- |
| **Identity custody** | the canonical SA address + its control credentials, rotatable under custody policy | `account-custody`, `key-custody`, `agent-account` (ADR-0010/0011) |
| **SSO / auth broker** | "Continue with the home" → an OIDC code + `id_token` whose `sub` is the SA address | `/oidc/authorize-grant`, `/token`, `/jwks`, `/.well-known/openid-configuration`; `connect-auth` |
| **Naming** | claim / resolve / reverse-resolve the public `<handle>.impact-agent.me` handle facet | `/connect/name`, `/name-info`, `/with-name`, `/reverse-name`; `agent-naming` |
| **Credential mgmt · recovery · step-up · linking** | add/replace/remove passkey, SIWE, Google-KMS; trustee/guardian recovery; re-auth for sensitive ops | `/security`, `/connect/passkey(-challenge)`, `/siwe`, `/stepup`, `/link`; `account-custody`, `key-custody` |
| **Personal data vault** | the person's PII / profile / contacts — owner-keyed, read/written only over a delegation | `/profile`, `/data-sources`, `/me/[...path]`; `mcp-runtime`, `agent-profile`, demo-mcp (spec 247) |
| **Organization custody + person↔org links** | the orgs a person stewards (each its own SA) + the private related-agent links | `/organizations`, `/connect/related-orgs`; `related-agents` (ADR-0025) |
| **Signed agreements & attestations** | MOU / WEA / consent signed *in the vault*; the relying app gets only the attestation | `/wea-sign`, `/consent-sign`; `agreements`, `attestations` |
| **Delegation authority (issued + received)** | issues the scoped, revocable grant a relying app presents; tracks grants the person's orgs *receive* too | `/oidc/grant`, `/oidc/authorize-grant`, `/connect/delegated-orgs`, `/received-delegations`; `delegation` + caveat enforcers |
| **Connected apps · revocation · activity / audit** | the home is where you see which apps you granted, revoke them (→ visibility zero), and read the access log | `/apps`, `/activity`; `audit` |
| **Treasury / funds** | the person's treasury account(s) the home custodies | `/treasuries`; `agent-account`, `payments` |
| **Agent / A2A host** | the person's own agent endpoint (`<handle>.impact-agent.io`) + PII MCP — the home *acts* for the person | `/me/[...path]`; demo-a2a, `mcp-runtime` |
| **Personal home portal** | the `/you` surface that ties identity, orgs, data, delegations, security together | `/(portal)/you`, `/(portal)/page.tsx` |
| **(emerging) credential wallet** | holder of verifiable credentials it presents to verifiers (Part IV.2) | `verifiable-credentials` |

So the relationship is not "relying app ⇄ login service." It is **relying app (verifier / requester) ⇄
the person's home (identity custodian + data holder + delegation issuer + recovery authority + agent
host + audit ledger)**. This is the **issuer → holder → verifier** triangle of verifiable credentials
(Part IV.2) and the demo doctrine already in the apps — *"JP runs the program; your home holds the
data"*, *"Switchboard reads only what you grant"* (`apps/demo-jp/CLAUDE.md`, `apps/demo-gs/CLAUDE.md`).
The "relying app asks for access" rule is therefore **stronger** than the SSO framing implies: the
relying app asks the home not merely *who you are* but *for a scoped, revocable delegation into data the
home custodies* — issued, audited, and revocable at the home, with the home (never the relying app) the
durable owner of the relationship. **SSO is the front door; the home is the house** — and the vault,
the org registry, the signing desk, the treasury, the agent, and the access log are all inside it.

---

## Part I — First principles

### I.1 The subject is the key; the name is a facet

- **OpenID Connect Core §2** defines `sub` as *"a locally unique and never reassigned identifier within
  the Issuer for the End-User."* The Basic Client Implementer's Guide §2.5.3 is blunt: *"the `sub` and
  `iss` Claims, used together, are the **only** Claims that an RP can rely upon as a stable identifier …
  other Claims such as `email`, `phone_number`, and `preferred_username` … **MUST NOT** be used as unique
  identifiers."* (https://openid.net/specs/openid-connect-core-1_0.html)
- **Google's** Sign-in best practices restate it operationally: *"the `sub` field is unique and stable …
  and never reused. … Store the `sub` field … don't use email address as an identifier because a Google
  Account can have multiple email addresses at different points in time."*
  (https://developers.google.com/identity/siwg/best-practices)
- **Caveat to honor in code:** `sub` is only *locally* unique to an issuer. The account primary key is the
  **`(iss, sub)` tuple**, never bare `sub`.
- **Kim Cameron — *The Laws of Identity* (2005)** is the foundational authority for "names are facets."
  Two laws are directly on point: **Law 2 (Minimal Disclosure)** — *"the solution which discloses the
  least identifying information … is the most stable long-term"* (don't anchor identity on PII like names/
  emails); **Law 4 (Directed Identity)** — a system must support both omni-directional public identifiers
  and unidirectional per-relationship pseudonyms. Cameron's lasting contribution, **claims-based
  identity**, says identity *is* a bag of revocable claims asserted about a stable subject — names, emails,
  usernames are claims, not the identifier. (https://www.identityblog.com/ ·
  https://www.windley.com/archives/2019/01/the_laws_of_identity.shtml)
- **Our application:** the canonical subject is the **ERC-4337 Smart Account address** (ADR-0010). The
  name (`<handle>.impact-agent.me`) is a `preferred_username`-class facet — and may be **absent**
  entirely (name-deferral, spec 257). Passkeys, SIWE EOAs, and Google logins are *control-credential*
  facets that rotate without changing the address (ADR-0011). This is the OIDC `sub`-vs-attributes rule +
  Cameron's claims model applied to an on-chain account.

### I.2 Our subject is a *public* identifier — privacy lives at the delegation layer

- OIDC §8 defines two `subject_type`s: **`public`** (same `sub` to every client — correlatable) and
  **`pairwise`/PPID** (a different opaque `sub` per client/sector, so clients can't correlate the user).
  IETF **RFC 9493** ("Subject Identifiers for Security Event Tokens") formalizes structured subjects and
  registers formats including **Account (`acct:`)**, **DID**, and **Aliases** (one subject, many
  identifiers). (https://datatracker.ietf.org/doc/rfc9493/)
- A blockchain account address is, by construction, a **public, omni-directional** identifier — the
  *opposite* of a PPID. Using a CAIP-10 (`chain_id:address`) account as `sub` is spec-coherent (RFC 9493
  anticipates DID/URI subjects; `did:pkh` wraps a CAIP-10 account), **but** it means full cross-relying-app
  correlatability is inherent. **Therefore privacy must be engineered at the access/delegation layer**
  (scoped, revocable per-relying-app delegations; contact released only on accept), **not** at the
  identifier. This is an explicit, documented divergence from the PPID privacy default — we trade
  identifier-level unlinkability for an on-chain canonical address, and recover privacy through scoped
  grants. (CAIP-10: https://chainagnostic.org/CAIPs/caip-10)

### I.3 The relying ⇄ IdP responsibility split (hosted-login doctrine)

The IdP owns everything identity-shaped; the relying app owns the bookends. This is the documented
default of every hosted-login product:

- **Auth0 Universal Login** — login is *"hosted on Auth0's Authorization Server"*; **identifier-first +
  Home Realm Discovery** is an IdP-hosted function. (https://auth0.com/docs/authenticate/login/auth0-universal-login/identifier-first)
- **WorkOS AuthKit** — *"WorkOS owns and manages the sign-in UI"* (sign-up, password reset, MFA, SSO
  routing, org switcher). (https://workos.com/docs/authkit/hosted-ui)
- **Clerk** `<SignIn/>` owns provider buttons + social + passkey + linking; **Privy's** modal owns
  social/email/wallet + embedded-wallet provisioning + account linking. (https://clerk.com/components/sign-in
  · https://docs.privy.io/)
- **Google / Apple** own the **account chooser** and credential selection; the relying app renders only a
  button. (https://developers.google.com/identity/gsi/web/guides/overview)

**Home Realm Discovery is an IdP function by design** — moving identifier entry into the relying app
duplicates routing logic and creates drift (Auth0/Okta keep it on Universal Login). The relying app's
job is to construct the request (scopes, PKCE, `state`/`nonce`, exact `redirect_uri`), **validate the
token** (signature, `iss`, `aud`, `exp`, `nonce`), and mint **its own session keyed on `(iss, sub)`**.

These hosted-login products are the *floor*, not the ceiling, of what our home does. Auth0/WorkOS/Clerk
own the credential + chooser; **our home also owns the data the relying app wants to touch** — the vault,
the orgs, the agreements, the treasury, the agent — and issues the scoped, revocable **delegation** that
grants access to it (Part 0). So when this spec says "the home owns identity," it means the home owns the
*credential, the data, and the authority* the relying app is asking for — and hands back only a narrow
grant. The split is wider than SSO precisely because the home is more than an SSO.

### I.4 The authentication ceremony is origin-bound (the load-bearing reason for IdP-side passkeys)

- **WebAuthn RP ID is a domain string** that must be the origin's effective domain or a registrable suffix
  — an **eTLD+1 or higher**; IP addresses and bare public suffixes are forbidden. The browser ties the
  passkey to the RP ID at creation; an authenticator only releases a credential to an operation asserting
  the **same RP ID** (anti-phishing + privacy). (https://www.w3.org/TR/webauthn-2/ ·
  https://web.dev/articles/webauthn-rp-id)
- Subdomain scoping is **asymmetric**: a passkey for `example.com` works on `login.example.com`; a passkey
  for `login.example.com` does **not** work on `shop.example.com`.
- **Consequence:** a relying app at `global.church` **physically cannot** mint a correctly-scoped passkey
  for a `<handle>.impact-agent.me` home — the `create()` ceremony must run on the home origin. So a
  new-passkey handle is collected **inside the home popup**, never on the relying app. A relying-app "name
  for a new passkey" field would be a dead end. (This is spec 259's load-bearing rule, now grounded in the
  normative WebAuthn text.)

---

## Part II — Passkeys & biometrics (the credential layer)

### II.1 Discoverable credentials, biometrics stay on the device

- **Discoverable credentials (resident keys)** store the private key + user handle on the authenticator,
  so the user signs in with **no username typed** and the OS shows an **account selector**. `user.id` (the
  handle) is opaque, ≤64 bytes, and **MUST NOT contain PII**; `user.name`/`displayName` are the
  human-readable labels shown in the picker. (https://web.dev/articles/webauthn-discoverable-credentials)
- **User Verification (UV) vs User Presence (UP):** UP = "someone tapped"; UV = "the right person was
  verified" via a **local biometric** (Touch ID / Face ID / Windows Hello / Android biometric) **or** a
  device PIN. The authenticator performs the match **locally** and signs **only a boolean UV flag** — the
  fingerprint/face template **never** appears in the WebAuthn message and **never reaches the server**.
  (https://web.dev/articles/webauthn-user-verification · https://developers.yubico.com/Passkeys/)
  → "Biometric login" in our system means a local gesture unlocking a device-held key; we never receive,
  store, or transmit biometric data. State this plainly in user-facing copy.

### II.2 Device-bound vs synced; assurance; attestation

- WebAuthn L3 flags **BE (Backup Eligible)** + **BS (Backup State)** distinguish **device-bound** (`BE=0`
  — hardware keys; lost device = lost credential) from **synced/multi-device** passkeys (`BE=1`, `BS=1`
  once synced via iCloud Keychain / Google Password Manager / 1Password etc.). (https://www.w3.org/TR/webauthn-3/)
- **Assurance:** **NIST SP 800-63-4** (final, July 2025) classifies **synced passkeys as AAL2**;
  device-bound hardware keys can reach **AAL3**. Enterprises that need a hardware-bound, non-copyable key
  use **enterprise attestation** (returns uniquely-identifying device info) — *consumer flows should use
  `attestation: "none"`*; AAGUIDs validate against the **FIDO Metadata Service**.
  (https://fidoalliance.org/wp-content/uploads/2024/06/EDWG_Attestation-White-Paper_2024-1.pdf)

### II.3 The RP-ID boundary decision for `<handle>.impact-agent.me` (most load-bearing finding)

The single most important passkey design decision for our per-handle-home model is **where to set the RP
ID** — and it interacts with the `.me` (SSO) / `.io` (A2A) split and our "subdomain-isolated ROOT
passkeys" choice:

- **Option A — RP ID = `impact-agent.me` (eTLD+1):** one shared passkey covers *every* `<handle>`
  subdomain automatically (the eTLD+1 subdomain rule). Simple, but the passkey is scoped to the parent,
  not isolated per handle.
- **Option B — RP ID = `<handle>.impact-agent.me` (per-subdomain, our current ROOT-passkey model):**
  each handle's passkey is **cryptographically siloed**; a compromise of one subdomain cannot assert
  another's credential. This is the stronger isolation and matches `feedback_rpidhash_must_match_client_server`.
- **Related Origin Requests (ROR) does NOT rescue a wildcard handle scheme.** ROR lets one RP ID span
  extra origins via `https://{RP ID}/.well-known/webauthn` (`{"origins":[…]}`), **but the allowlist is
  capped at 5 unique eTLD+1 *labels*** and no client supports more. So ROR is the right tool for a small
  fixed set of sibling domains — e.g. unifying our **`.me`/`.io` split** — but it **cannot** unify
  thousands of `<handle>` subdomains. Don't expect ROR to paper over the RP-ID boundary; choose it
  deliberately. (https://web.dev/articles/webauthn-related-origin-requests ·
  https://passkeys.dev/docs/advanced/related-origins/)
- **Doctrine:** keep Option B (per-handle isolation) for ROOT passkeys; use ROR only for the fixed
  `.me`↔`.io` sibling pair if a single credential must span them. Record any change to this boundary as an
  ADR — it is a security boundary, not a config knob.

### II.4 Frontier features to adopt (roadmap, not yet built)

- **Conditional UI / autofill** (`mediation:"conditional"`, `autocomplete="username webauthn"`) — surface
  passkeys in the autofill dropdown with no modal; keep an explicit "Sign in with a passkey" button as the
  fallback. (https://developer.chrome.com/docs/identity/webauthn-conditional-ui)
- **Conditional Create** — silently upgrade an existing credential to a passkey after a successful login.
- **Cross-Device Authentication (hybrid/caBLE)** — desktop QR + phone + BLE proximity; the key never
  leaves the phone. (Adam Langley, https://www.imperialviolet.org/)
- **Signal API** (`signalUnknownCredential` / `signalAllAcceptedCredentials` / `signalCurrentUserDetails`)
  — keep the OS passkey picker in sync with server truth; the hygiene tool to retire a rotated/lost
  credential. (https://developer.chrome.com/docs/identity/webauthn-signal-api)
- **FIDO Credential Exchange (CXF + CXP)** — standard passkey portability between providers (HPKE-encrypted);
  CXF reached FIDO Proposed Standard (Aug 2025), iOS/macOS 26 first to ship. Kills the lock-in objection.
  (https://fidoalliance.org/specifications-credential-exchange-specifications/)

### II.5 Recovery is an identity-layer operation, not a WebAuthn feature

WebAuthn has **no in-band "recover my passkey"** — a lost device is a lost authenticator. Recovery is an
IdP/identity-layer problem: re-establish identity via a *different* factor, then enroll a fresh passkey
and **evict the dead one via the Signal API**. This is exactly our **ADR-0011 / spec 221** shape:
*the canonical SA address persists while credentials rotate under custody policy* — the right architecture,
and the reason recovery belongs at the home, never at a relying app. (https://www.corbado.com/blog/passkey-fallback-recovery)

---

## Part III — UX doctrine (the connect surface)

- **Render a button, not a form.** "Continue with X"; the IdP owns the chooser. Google's personalized
  button *recognizes an existing account to prevent duplicate creation* — that recognition is IdP-driven,
  never RP-asserted. Sign in with Apple's only approved labels are "Sign in / Sign up / Continue with
  Apple" — pick one verb and use it consistently. (https://developers.google.com/identity/gsi/web/guides/personalized-button
  · https://developer.apple.com/design/human-interface-guidelines/sign-in-with-apple)
- **FedCM is the future of "Continue with X".** The browser-mediated Federated Credential Management API
  replaces third-party-cookie + redirect federation; Google has made it mandatory for GSI. Build on
  FedCM-enabled GSI; do **not** design around third-party cookies. (https://www.w3.org/TR/fedcm/)
- **Prompt passkey *creation* at account-create / settings / recovery — never mid-sign-in.** FIDO's UX
  research (Passkey Central) found mid-login prompts perform worse. Bookend the OS sheet with "handshake"
  copy showing your site + the OS cooperating. (https://www.passkeycentral.org/design-guidelines/principles)
- **Identifier-first only to *route* (HRD), on the IdP.** Never ask for a handle before SSO on the relying
  app (spec 259). Password-first is an anti-pattern: it dead-ends SSO/passkey users (Baymard: forgotten-
  password abandonment).
- **Microcopy + a11y (NN/g, GOV.UK, W3C WAI):** distinct "Create account" vs "Sign in" paths; blame-free,
  specific, inline errors; defer account creation; allow paste + password managers; **WCAG 2.2 §3.3.8
  Accessible Authentication** forbids cognitive-function tests and *requires* allowing autofill — a direct
  standards argument for passkeys/SSO over typed secrets + CAPTCHAs. Use `aria-live` for status,
  `aria-invalid` + `aria-describedby` on errors, ≥24px (44px touch) targets, focus-to-first-error.
  (https://www.w3.org/WAI/WCAG22/Understanding/accessible-authentication-minimum.html ·
  https://www.nngroup.com/articles/error-message-guidelines/ · https://design-system.service.gov.uk/patterns/create-accounts/)
- **COOP / popup pitfall (we live this):** `COOP: same-origin` nulls `window.opener`, silently breaking a
  popup's `postMessage` back to the opener — use `same-origin-allow-popups` / `restrict-properties`, or a
  redirect, or FedCM. (See `feedback_oauth_popup_coop_opener_severance`; ours uses a same-origin
  BroadcastChannel relay + a parent-side AbortSignal cancel — no `popup.closed` poll.)
- **Anti-patterns (all forbidden on the relying app):** pre-filling/pre-binding a username; asking for a
  handle before SSO; implying social login binds to a remembered name. (The exact bug spec 259 fixed.)

---

## Part IV — The future (3–5 years)

> Part IV is the **standards-and-evidence** treatment of where identity is heading. **Part VII** turns it
> into our **layered architecture direction** (passkeys for presence · wallets for attributes · FedCM for
> federation · on-chain attenuated delegation for agents), with the applied demo-gs maturity levels and
> the recommended architecture-doc language. Read IV for *what the standards say*; read VII for *how we
> layer them*.

### IV.1 Passkeys become the default; portability arrives
Microsoft made passkeys the **default for new accounts** (May 2025); FIDO cites **>3B passkeys in active
use**. CXP/CXF portability (II.4) removes lock-in. Plan for passkey-first, password-as-legacy.

### IV.2 Authentication (passkeys) + attributes (wallets) + SSO converge
The credible trajectory is **layered, not replacement**: passkeys for phishing-resistant *auth*, digital
credential **wallets** for portable *attributes*, federated SSO for org access, with the browser
**Digital Credentials API** as the common presentation channel.
- **W3C Digital Credentials API** (Federated Identity WG) extends `navigator.credentials` to broker
  **mdoc (ISO 18013-5/-7)** and **OpenID4VP** presentations; shipping in Chrome 141 + Safari 26 (Sept
  2025), protocol allowlist finalized at TPAC Nov 2025. (https://www.w3.org/TR/digital-credentials/)
- **EU EUDI Wallet + eIDAS 2.0** (in force May 2024; wallets ~2026) mandate **OID4VCI/OID4VP** with
  **SD-JWT VC** + **ISO mdoc**. (https://github.com/eu-digital-identity-wallet/eudi-doc-standards-and-technical-specifications)
- **W3C Verifiable Credentials 2.0** (Recommendation, May 2025) + **DID Core** + **SD-JWT VC** (IETF
  draft) formalize the **issuer → holder → verifier** triangle — which is structurally *the relying app
  (verifier) requesting scoped attributes from the user's wallet/agent (holder)* against authority-issued
  credentials. This is the wallet-centric inversion of federated SSO and the natural home for our
  delegation/grant model. (https://www.w3.org/TR/vc-data-model-2.0/)

> **We are not waiting for this future — Impact already plays the holder/wallet + issuer role (Part 0).**
> The home custodies the person's data, issues the scoped delegation a relying app presents, and holds the
> signed agreements/attestations. Adopting the **Digital Credentials API / OID4VP / SD-JWT VC** is mostly
> a matter of making our *existing* holder role speak the standard wire protocol to off-platform verifiers
> — not bolting on a new capability. The `verifiable-credentials` package + the `delegation` grants are
> the holder/issuer substrate; the gap is the standard presentation envelope.

### IV.3 Self-sovereign handle systems already prove "name is a facet" (prior art to cite)
Every major decentralized-identity system separates a **stable key** from a **mutable handle** — exactly
our doctrine, and the prior art for ADR-0010:
- **ENS** — `.eth` names over an Ethereum **address** (one address, many names, transferable).
- **Farcaster** — immutable **FID** (on-chain ID registry) vs mutable **fname/ENS** ("changing names does
  not affect your history or followers").
- **AT Protocol / Bluesky** — stable **DID** (`did:plc`/`did:web`) vs a **domain handle** verified by DNS
  that can change anytime ("the DID is the stable identifier, the handle is mutable").
- **Nostr** — stable **secp256k1 pubkey** (`npub`) vs **NIP-05** `name@domain` (display, reassignable).
(ENS https://docs.ens.domains/ · Farcaster https://docs.farcaster.xyz/learn/what-is-farcaster/usernames ·
AT Proto https://atproto.com/guides/identity · Nostr NIP-05 https://nips.nostr.com/5)

### IV.4 AI-agent identity & delegation (most relevant to *us*)
This is the frontier our whole product sits on, and it is moving fast in 2025:
- **MCP Authorization** (Anthropic-led) models a protected MCP server as an **OAuth 2.1 Resource Server**;
  the June 2025 update mandates **OAuth 2.1 + PKCE**, **Protected Resource Metadata (RFC 9728)** for AS
  discovery, and **Resource Indicators (RFC 8707)** to bind tokens to a target resource.
  (https://modelcontextprotocol.io/specification/draft/basic/authorization)
- **IETF `draft-oauth-ai-agents-on-behalf-of-user`** (T. S. Senarath, WSO2, May 2025) extends OAuth so an
  agent gets a **delegated** token to act for a user: a `requested_agent` consent parameter, an
  agent-authorization grant, and an **`act` (actor) claim** recording the chain **user (`sub`) → agent
  (`act.sub`) → app (`azp`)**. (https://datatracker.ietf.org/doc/html/draft-oauth-ai-agents-on-behalf-of-user-00)
- **"Authenticated Delegation and Authorized AI Agents"** (South, Marro, Hardjono, Mahari, Whitney,
  Greenwood, Chan, Pentland — MIT/Oxford, arXiv **2501.09674**, Jan 2025) proposes scoped/attenuated
  agent delegation with auditable accountability chains, **extending OAuth 2.0 + OIDC** with agent
  credentials — the canonical academic citation for what our delegation package does on-chain.
  (https://arxiv.org/abs/2501.09674)
- **Open problem the industry flags:** OAuth handles one-hop delegation but lacks **multi-hop /
  cross-domain capability chaining** — precisely where our on-chain attenuated-delegation primitives (the
  `delegation` package + caveat enforcers) are a differentiated answer. A 2026 survey found 93% of agent
  projects still ship **unscoped API keys** — the over-privilege problem our scoped grants exist to solve.

### IV.5 Skeptic checkpoints (honesty)
- Adding passkeys as an *option* ≠ phishing resistance — that requires removing all phishable auth +
  recovery paths.
- SSI/VC adoption remains thin outside pilots; "decentralized" branding can hide centralized control
  (`did:plc`'s directory is single-writer today). Treat wallet/VC integration as forward-looking, not
  table stakes.

---

## Part V — How agenticprimitives maps (alignment & deliberate divergence)

| Principle | Industry default | agenticprimitives | Match / divergence |
| --- | --- | --- | --- |
| Stable subject key | OIDC `(iss,sub)` | SA address (CAIP-10) as `sub` | **Match** (RFC 9493 DID/URI subjects) |
| Name | mutable `preferred_username` | on-chain handle, **may be absent** | **Match + stronger** (name-deferral, spec 257) |
| Credential | password/passkey/social | passkey / SIWE EOA / Google-KMS, **rotatable** | **Match** (ADR-0011 = WebAuthn recovery reality) |
| Subject privacy | pairwise PPID default | **public** address + scoped delegations | **Deliberate divergence** (I.2) — privacy at the grant layer |
| Relying ⇄ home split | IdP owns chooser/name/recovery | home owns those **+ data vault, orgs, agreements, treasury, agent, audit**; relying apps ask for access | **Match + broader** (spec 259, Part 0) |
| Data custody / holder | IdP holds attributes; wallet holds VCs | home is the **owner-keyed vault + delegation issuer + VC holder** | **Match** (Part 0, IV.2) |
| New-passkey handle | IdP-side (RP-ID bound) | collected in the home popup | **Match** (II.3) |
| Account = programmable | — | ERC-4337 + ERC-7579 modular validators | **Our substrate** (credentials = validator modules) |
| Agent delegation | OAuth `act` claim (draft) | on-chain attenuated delegation + caveats, **issued + audited at the home** | **Ahead** of the draft for multi-hop |

**Forward roadmap items this doctrine implies** (not yet built; each its own future spec): conditional-UI
passkey autofill at the home; Signal-API credential hygiene on rotate/recover; a ROR `/.well-known/webauthn`
for the `.me`↔`.io` sibling pair (II.3); a verifier-side path that accepts a **Verifiable Presentation**
from a holder wallet as an alternative to the OIDC code flow (IV.2); and aligning our delegation token
shape with the OAuth `act`-claim chain (IV.4) for interop with non-chain agents.

---

## Part VI — The canonical responsibility matrix

The home is the identity custodian **and** the data holder, delegation issuer, and agent host (Part 0) —
so the split is wider than the classic SSO matrix: the relying app gets a *scoped grant into data the
home keeps*, not just a `sub`.

| Responsibility | Relying app | The home (Impact) |
| --- | :---: | :---: |
| Access-intent display · launch / cancel / retry · popup-blocked fallback | ✅ | |
| Token validation · code exchange → app session (key on `(iss,sub)`) | ✅ | |
| Its own program logic + UI over the data it is *granted* | ✅ | |
| Credential choice · social · passkey · wallet · **account chooser** | | ✅ |
| Name lookup · name claim · **new-passkey handle entry** | | ✅ |
| Recovery · credential linking · step-up · consent | | ✅ |
| **Personal data vault** (PII / profile / contacts) — owner-keyed custody | | ✅ |
| **Organization custody** + private person↔org links | | ✅ |
| **Signed agreements / attestations** (held in vault; app gets the attestation) | | ✅ |
| **Delegation issuance** — the scoped, revocable grant the app presents; revoke → zero | | ✅ |
| **Agent / A2A host** — the person's own agent acting on their behalf | | ✅ |
| Durable ownership of the **relationship** | | ✅ |

The relying app owns only the bookends (declare intent + launch; redeem + run its program over granted
data). Everything **identity- and data-custody-shaped** is the home's. This is the Google / Apple /
WorkOS-hosted / Auth0-Universal-Login / Clerk / Privy SSO consensus **plus** the verifiable-credentials
holder model (Part IV.2) — the home is both the authenticator *and* the wallet, and spec 259's rule is
the consequence.

---

## Part VII — Future identity & delegation architecture (the layered model)

> This part expands Part IV's brief "passkeys + wallets + FedCM + on-chain delegation converge" into the
> full architecture direction. The near-term integration can stay conservative (VII.8 Level 1 — a signed
> assertion the relying app verifies + a local session). The long-term direction is **not** "OAuth
> everywhere" or "wallet login everywhere" — it is a **layered** model where each layer answers exactly
> one question. New standards this part anchors: [AP-1](261-ap1-public-profile-schema.md) (profile),
> [AP-2](262-ap2-agent-capability-descriptor.md) (capability), [ADR-0030](../docs/architecture/decisions/0030-agent-discovery-via-indexer-not-registry-scan.md) (discovery).

### VII.1 The layered model

| Layer | Is for | Answers |
| --- | --- | --- |
| **Passkeys** | default human login + presence / step-up approval | "Is this human present right now? Did they approve this sensitive action?" |
| **Wallets / smart accounts** | durable agent identity, org identity, attributes, attestations, delegation | "What identity / authority / attributes does this account durably hold?" |
| **FedCM** | browser-mediated cross-app sign-in & handoff (no redirects, iframes, or third-party cookies) | "Hand this already-signed-in human into a relying app, natively." |
| **On-chain attenuated delegation** | portable, inspectable, multi-hop agent authority | "Who authorized this agent, to do *exactly* what, with what limits, and can it sub-delegate?" |

Normal users get a simple **passkey-first** experience; the agentic system gets a **cryptographic
authority model** underneath. The discipline is: each layer answers one question and is not asked to
answer the others.

### VII.2 Passkeys = the default human login

Passkeys should become the default sign-in for the home and its relying surfaces (Impact / demo-sso /
demo-gs and partner handoffs). A passkey is the right primitive for *human authentication* because it
proves possession of a user-controlled authenticator with no shared secret — WebAuthn public-key
credentials are RP-scoped, created with user consent, browser-mediated, and bound to authenticators, and
one RP cannot detect another RP's credentials (Part II; privacy across RPs).

The passkey answers: *"Is this human present right now?"*, *"Is this the same human-controlled account?"*,
*"Did the human approve this sensitive action?"* It must **not** be the sole store of: organization
membership, expertise/skill claims, signatory authority, attestations, app-to-agent or sub-agent
delegation, agreement status, or cross-ecosystem authorization. Those belong in wallets, credentials,
smart accounts, graph claims, and delegation records.

### VII.3 Wallets-for-attributes, not wallet-login-first

Do **not** make wallets the default login surface for ordinary users — wallet login is still too foreign
for many non-crypto users. Wallets are excellent for **portable attributes and authority claims**. So the
UX is: the user signs in with a passkey; *then* the platform resolves the Person Agent, Organization
Agent, linked wallet / smart account, delegations, credentials, attestations, and claims. The wallet is
the durable cryptographic container **behind** the account, not the front door.

Attributes anchored through wallet/smart-account infrastructure (illustrative):

- **Person Agent:** verified email/phone, preferred display name, linked passkey credential IDs, linked
  EOA / smart account, expertise-profile reference, skill attestations.
- **Organization Agent:** claimed org identity, public org URI, signatories, admin delegations, role
  claim, category, public website/about.
- **Expert/provider:** skills offered, causes/regions/languages served, evidence/endorsements,
  confidentiality tier.
- **Delegation:** "Person X can act for Org Y", "Impact Agent can draft needs for Org Y", "demo-gs can
  compute matches", "the marketplace can read public need anchors", "contact release requires explicit
  agreement."

This maps cleanly onto the marketplace integration, which already separates **public discoverability**
from **confidential profile + connection data** — the relying marketplace keeps its app, backend,
messaging, and confidential data posture; the home mirrors only the public board + taxonomy.

### VII.4 FedCM = the browser-native "one-tap into the marketplace" handoff

The conservative handoff is: the home signs the user in, issues a signed identity assertion, the user
clicks "Continue to <marketplace>", and the marketplace verifies the assertion and mints its own local
session (VII.8 Level 1). **FedCM is the browser-native future of that seam** — a privacy-preserving
federated sign-in with no third-party cookies or redirect-heavy flows, and protocol-agnostic (an OAuth
server can layer FedCM on top and exchange the returned code for a token; Part III). The product
invariant holds across both: **the home owns discovery + identity; the marketplace owns the marketplace
experience; FedCM makes the seam browser-native.** It also reinforces *deep-link / handoff, not iframe* —
the user actually uses the marketplace inside the marketplace's own UI.

### VII.5 OAuth is useful, but not enough for agentic multi-hop authority

OAuth/OIDC remains the right tool for **API sessions and partner interoperability**: sign-in, ID/access
tokens, scopes, audiences; **OAuth Token Exchange (RFC 8693)** for swapping tokens incl. delegation and
impersonation (and it distinguishes them — under *delegation*, actor A keeps its own identity while
acting for principal B, surfaced via the `act` claim); the **JWT access-token profile** for interop; and
**DPoP** for sender-constrained, proof-of-possession tokens that resist replay. But RFC 8693 is
*deliberately scoped to the exchange* — it states the syntax, semantics, security characteristics, and
trust model of the tokens are **out of scope**. OAuth answers *"can this client call this API right now
with this token?"* It does not, on its own, answer *who originally authorized this agent, what exactly was
delegated, whether it may sub-delegate, what constraints applied, which chain of authority led here,
whether a hop was revoked, or whether any hop expanded authority.* That gap is the opening for the home's
delegation model (Part IV.4 — we are ahead of the OAuth on-behalf-of-agents draft for multi-hop).

### VII.6 Attenuated delegation = authority that can only narrow

Attenuated delegation means **every hop can only narrow authority, never expand it** — a sub-agent can
never receive more power than its delegator holds. Illustrative chain:

```
Person  → Impact Agent:   draft needs for Org Y · read public taxonomy · NO publish · NO contact release
                          · expires 7d · may sub-delegate ONLY match computation
Impact Agent → Match Worker: compute candidate matches · read public needs+offerings · NO messaging
                          · NO agreement · NO confidential contact · expires 1h · may NOT sub-delegate
```

The policy check is therefore **authority-chain verification**, not scope checking. Not `token.scope
includes match:compute`, but: `chain[0].issuer is the person/org authority` **AND** each hop is signed
**AND** each hop attenuates the previous **AND** the action ⊆ final delegated scope **AND** the resource
⊆ delegated resource set **AND** audience correct **AND** time window valid **AND** no active revocation
**AND** the presenter proves possession of the delegated key. That is the difference between *scope
checking* and *authority-chain verification*.

### VII.7 Why on-chain / wallet delegation is ahead for multi-hop agents

OAuth tokens are usually **session artifacts**; the home's delegations are **durable authority objects** —
portable, verifiable across apps, revocable by the principal, discoverable by policy engines, anchored to
the Person/Org Agent identity, composable across hops, independent of any one app's session database, and
auditable after the fact. When an action crosses several boundaries
(home → Impact Agent → matching service → marketplace handoff → agreement / contact release), OAuth can
secure each API call, but the home's model describes the **whole authority graph**:

```
Passkey            proves the human is present.
Wallet             proves they control / are linked to the Person Agent.
Org smart account  proves they can act for the organization.
Delegation registry proves an agent may perform a bounded action.
Graph              records the NeedIntent, IntentMatch, Agreement, provenance.
Marketplace        remains system of record for marketplace UX + messaging.
```

### VII.8 Applied to demo-gs / Switchboard — three maturity levels

**Level 1 — current practical handoff.** Home identity → signed JWT/OIDC assertion → the marketplace
verifies → the marketplace mints a local session. Maps onto the marketplace's existing magic-link/Google
SSO and a shared identity provider; the one-tap arrival is a signed assertion it can verify.

**Level 2 — passkeys-default + wallet-backed attributes.** User signs into the home with a passkey; the
home resolves Person Agent, Organization Agent, expertise profile, role claim, signatory authority, skill
attestations, and wallet/smart-account references; the home sends the marketplace a stable person URI, a
stable org URI (if acting for an org), verified email (as allowed), a role hint, and a signed assertion.
The marketplace still owns its local session, marketplace UI, needs board, matching UX, connection
workflow, and messaging — the home owns discovery + handoff.

**Level 3 — agentic delegated actions.** Human signs in with a passkey; delegates bounded authority to an
Impact Agent; the Impact Agent drafts a NeedIntent; demo-gs computes an IntentMatch; the human approves
the Agreement / contact release with a **passkey step-up**; the marketplace receives the handoff / status
projection; the graph records provenance. This is where on-chain attenuated delegation is materially
better than an OAuth-only design.

**Worked example — an organization uses Impact to find grant-writing help.** *Passkey:* the person is
present for sign-in and for the sensitive approval. *Wallet/delegation:* Impact can act, but only within a
bounded scope. *demo-gs:* computes the match and records the IntentMatch. *Marketplace (Switchboard):*
owns the actual connection workflow + messaging. *Graph:* records the public Need, match provenance, and
the Agreement projection.

### VII.9 Recommended architecture-doc language

> The long-term identity model should be **passkeys-default, wallets-for-attributes, and FedCM-compatible
> federation.** Passkeys provide the human-friendly, phishing-resistant login and step-up approval
> surface. Wallets and smart accounts hold durable identity, organizational authority, skill
> attestations, and revocable delegations. FedCM becomes the browser-mediated handoff from the home into
> relying applications without iframe embedding, third-party-cookie dependence, or full account
> re-onboarding. OAuth/OIDC remains useful for API sessions and partner interoperability, but agentic
> multi-hop workflows require a stronger authority substrate than ordinary bearer tokens or app-local
> scopes.
>
> The home's **on-chain attenuated delegation** model should be treated as a forward-looking advantage.
> It models delegated authority as a portable, inspectable chain: each hop is signed, narrower than the
> previous hop, time-bound, resource-bound, audience-bound, and revocable. This lets a Person Agent or
> Organization Agent safely delegate limited work to an Impact Agent, which may further delegate a
> narrower subtask to a broker or match worker, without losing provenance or expanding authority. OAuth
> token exchange can express delegation concepts, but its standard layer deliberately leaves token
> semantics and trust model to deployment profiles. The home can therefore become the cross-ecosystem
> **authority graph underneath** future OAuth/FedCM sessions, rather than waiting for OAuth agent
> standards to fully solve multi-hop agent delegation.

**The one-line summary:** *Passkeys are for human presence. Wallets are for durable claims. FedCM is for
cross-app login. OAuth is for API sessions. The home's delegation is for agent authority.*

---

## Authorities & canonical reading list

**Standards & bodies:** W3C WebAuthn WG (L2 Rec / L3 ED) · FIDO Alliance (CTAP, MDS, CXP/CXF) · IETF
OAuth WG (RFC 9700 Security BCP, PKCE 7636, DPoP 9449, Browser-Based Apps BCP, on-behalf-of-agent draft) ·
OpenID Foundation (OIDC, FAPI, OID4VCI/VP) · W3C Federated Identity WG (FedCM, Digital Credentials API) ·
W3C VC/DID WGs · ISO/IEC JTC1/SC17 (18013-5/-7 mDL) · Chain Agnostic Standards Alliance (CAIP-2/10/122) ·
Ethereum EIPs (4361 SIWE, 4337, 7579) · IDPro (Body of Knowledge) · Trust over IP Foundation.

**People (who / what to read):**
- **Aaron Parecki** — oauth.net, *OAuth 2.0 Simplified*, OAuth-for-Browser-Based-Apps BCP. https://oauth.net/
- **Vittorio Bertocci** (1972–2023) — *Modern Authentication*, *Identity, Unlocked* podcast. https://identityunlocked.auth0.com/
- **Justin Richer** — *OAuth 2 in Action*, GNAP (RFC 9635). https://www.manning.com/books/oauth-2-in-action
- **Nat Sakimura · John Bradley · Michael B. Jones** — OIDC Core, JWT (RFC 7519), PKCE (7636). https://self-issued.info/
- **Pamela Dingle** — Microsoft Director of Identity Standards. https://authenticatecon.com/speaker/pamela-dingle/
- **Kim Cameron** (1955–2021) — *The Laws of Identity*; claims-based identity. https://www.identityblog.com/
- **Eve Maler** — SAML co-inventor, UMA chair. https://kantarainitiative.org/work-groups/uma/
- **Philippe De Ryck** — Pragmatic Web Security (OAuth/OIDC security training). https://pragmaticwebsecurity.com/
- **Emil Lundberg (Yubico) · Tim Cappalli · Nina Satragno (Google) · J.C. Jones · Jeff Hodges** — WebAuthn
  editors. **Adam Langley** (Google) — caBLE/hybrid, *A Tour of WebAuthn*. https://www.imperialviolet.org/
- **Andrew Shikiar · Christiaan Brand** — FIDO Alliance / Google passkeys.
- **Manu Sporny · Drummond Reed · Ivan Herman · Markus Sabadello** — DID Core / VC 2.0 editors.
- **Tobin South · Thomas Hardjono · Alex Pentland et al.** — *Authenticated Delegation and Authorized AI
  Agents* (arXiv 2501.09674). · **T. S. Senarath** — IETF OAuth on-behalf-of-agents draft.

**Key specs to bookmark:** OIDC Core (`sub`/`iss`) · RFC 9493 (subject identifiers) · RFC 9700 (OAuth
Security BCP) · W3C WebAuthn L2/L3 · web.dev RP-ID + Related-Origin-Requests · NIST SP 800-63-4 ·
W3C Digital Credentials API · W3C VC 2.0 · MCP Authorization · `draft-oauth-ai-agents-on-behalf-of-user`.

---

## Reference: smart-agent patterns to port

`/home/barb/smart-agent` (branch `003-intent-marketplace-proposal`) keeps the sign-in surface in the
identity host and has relying surfaces consume the resolved subject — we **port** that boundary. We
**diverge** by expressing the subject as a CAIP-10 Smart Account address (ADR-0010), making the name an
optional on-chain handle facet that may be absent, treating credentials as rotatable ERC-7579 validator
modules (ADR-0011), and putting attenuated agent delegation on chain (ahead of the OAuth `act`-claim
draft, IV.4). smart-agent has no per-handle passkey-subdomain model, so the RP-ID boundary rule (II.3) is
AP-specific with no analog to port. No third-party identity runtime is adopted; these are doctrine +
standards citations, not dependencies.
