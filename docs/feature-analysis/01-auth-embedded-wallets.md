# 01 — Auth, embedded wallets & onboarding

**Focus area:** user login, sessions, account linking, passkey ceremonies, embedded wallet provisioning, onboarding UX.
**AP packages in scope:** `connect`, `connect-auth`, `browser-identity`, `fedcm-idp`, `fedcm-rp`, `key-custody` (custody half in [03](03-key-custody-kms-recovery.md)).
**AP capability today:** SIWE + passkey + OIDC custody paths anchored to the Smart Agent address; FedCM IdP/RP primitives; per-app session tokens; every identity facet points at the canonical SA address (ADR-0010).

> Gap layers: `[Contracts]` Solidity surface · `[SDK]` TS packages/backends · `[UX]` product surface (**deferred**). See [index](index.md#gap-layers-every-gap-is-classified-into-exactly-one).

---

## Category verdict at a glance

| Product | Type | Tags | Verdict |
| --- | --- | --- | --- |
| Privy | Commercial | AUTH WALLET CUSTODY POLICY PAYMASTER | **Compete** (closest UX benchmark) + adopt patterns |
| Dynamic | Commercial | AUTH WALLET CUSTODY POLICY PAY MCP | Adopt patterns (connector breadth, fraud controls) |
| Web3Auth / MetaMask Embedded Wallets | Commercial SDK | AUTH WALLET CUSTODY AA | Adopt patterns (platform reach) |
| Magic | Commercial | AUTH WALLET | Adopt patterns (low-friction login) |
| Turnkey Embedded Wallets | Commercial | AUTH WALLET CUSTODY POLICY DELEG | **Integrate** (custody backend; see 03) |
| Capsule | Commercial | AUTH WALLET CUSTODY RECOVERY | Adopt patterns (consumer recovery UX) |
| Portal | Commercial | AUTH WALLET CUSTODY | Track |
| Crossmint Wallets | Commercial | AUTH WALLET PAY | Integrate (fiat/onramp adapters) |
| Coinbase CDP Wallets | Commercial | WALLET CUSTODY PAY MCP | **Partner** (agent wallets + x402 rails) |
| Circle Programmable Wallets | Commercial | WALLET CUSTODY PAY TREASURY | Integrate (stablecoin rails; see 09) |
| Auth0 / Okta | Commercial | AUTH POLICY | **Integrate** (upstream enterprise IdP) |
| Clerk | Commercial | AUTH | Adopt patterns (drop-in components, org UI) |
| WorkOS | Commercial | AUTH POLICY DIR | **Integrate** (SSO/SCIM for B2B) |
| Stytch | Commercial | AUTH RECOVERY | Adopt patterns (passkey ceremony + fraud signals) |
| Descope | Commercial | AUTH POLICY | Track (workflow builder) |
| Ory | OSS/commercial | AUTH POLICY | Integrate option (self-hosted identity) |
| Keycloak | OSS | AUTH | Integrate (enterprise OIDC/SAML adapter) |
| Supabase Auth / Firebase Auth | Commercial/OSS-adjacent | AUTH | Track (DX baseline only) |
| Hanko / Corbado / OwnID / Passage | Commercial/OSS | AUTH RECOVERY | Adopt patterns (passkey UX) |

---

## Deep dives — primary overlap products

### Privy — Compete / adopt patterns

- **Identity:** commercial embedded-wallet + auth platform; hosted API + client SDKs.
- **Feature inventory:** email/social/passkey/SMS login; account linking across credentials; embedded EOA + smart-wallet provisioning; server wallets (agent/treasury patterns); wallet policy engine with manual-approval queues; key export; gas sponsorship hooks; partner fiat onramps.
- **Overlap with AP:** directly overlaps `connect`/`connect-auth` (login + linking), `key-custody` (embedded key holding), SA bootstrap (spec 220). Privy's "user with N linked credentials" ≈ AP's credential-facet model — except Privy's root is a vendor user row; AP's is the on-chain SA address.
- **AP lacks:**
  - `[SDK]` SMS/email OTP custody factors in `connect-auth`; key-export / self-custody offboarding path; quickstart/docs quality as a measurable DX bar.
  - `[UX]` (deferred) hosted prebuilt onboarding components; account-linking + recovery prompt flows; policy admin UI with manual-approval queue.
- **Privy lacks:**
  - `[Contracts]` canonical on-chain identity (users are vendor rows — migration risk); open custody contracts; name/attestation registries bound to the account.
  - `[SDK]` delegation shared across app/MCP/on-chain paths; audit evidence artifacts as code.
- **Verdict:** compete on positioning, copy onboarding ergonomics later. Near-term bar is SDK parity: OTP factors + key export.

### Dynamic — adopt patterns

- **Feature inventory:** multi-wallet connector hub (external + embedded), server wallets, stablecoin accounts, fraud/risk controls, onboarding flows, organization support, agentic-wallet positioning.
- **Overlap with AP:** `connect` (wallet connection + auth), `key-custody` (embedded/server wallets).
- **AP lacks:**
  - `[SDK]` wallet-connector breadth (hundreds of external wallets behind one interface); anti-abuse/fraud signal pipeline; multi-chain account discovery.
  - `[UX]` (deferred) fintech-grade stablecoin account surface.
- **Dynamic lacks:**
  - `[Contracts]` on-chain account model with custody tiers; registries.
  - `[SDK]` delegation/caveat semantics; MCP/A2A authorization.
- **Verdict:** adopt patterns; integrate standard connector libraries rather than rebuilding connectors in `connect`.

### Web3Auth / MetaMask Embedded Wallets — adopt patterns

- **Feature inventory:** social login → MPC key shares, mobile/game/web SDKs across many platforms, MetaMask ecosystem distribution, AA integrations.
- **Overlap with AP:** `connect-auth` (social → wallet), `key-custody` (MPC-style splits vs AP's KMS-custody approach).
- **AP lacks:**
  - `[SDK]` platform SDK breadth (Unity, mobile native); turnkey social-login share recovery.
  - `[UX]` (deferred) mainstream-brand onboarding distribution.
- **Web3Auth lacks:**
  - `[Contracts]` smart-account-native custody policy (key-share custody is account-agnostic).
  - `[SDK]` delegation semantics; canonical identity binding.
- **Verdict:** adopt SDK packaging patterns; AP keeps stronger SA/delegation semantics.

### Turnkey Embedded Wallets — integrate

- Covered in depth in [03 — Key custody](03-key-custody-kms-recovery.md). For this focus area: Turnkey's session + delegated-access model is the strongest auth-adjacent pattern (short-lived session keys with policy-scoped grants ≈ AP session tokens with caveats).
- **AP lacks:** `[SDK]` session-issuance ergonomics with policy scoping at parity.
- **Verdict:** integrate as custody backend; adopt session/policy patterns.

### Auth0 / Okta / WorkOS / Keycloak / Ory — integrate (enterprise identity)

- **Feature inventory (collectively):** OIDC/SAML SSO, SCIM directory sync, MFA, tenant management, admin portals, audit log streams, organization modeling.
- **Overlap with AP:** upstream of `connect-auth` — enterprise users authenticate against their IdP, then bind to the SA.
- **AP lacks:**
  - `[SDK]` SAML assertion support; SCIM provisioning/deprovisioning into `identity-directory`; org directory sync; auth-event compliance export.
  - `[UX]` (deferred) hosted admin portal.
- **They lack:**
  - `[Contracts]` + `[SDK]` everything below the OIDC layer — wallet/account custody, on-chain identity, delegation. Prerequisites for B2B deals, not competitors.
- **Verdict:** integrate. Consume OIDC/SAML as custody-credential evidence; SCIM-driven org membership. Never rebuild an IdP (`fedcm-idp` — AP acting as FedCM IdP — is the differentiator exception).

### Stytch / Hanko / Corbado / OwnID / Passage — adopt patterns (passkeys)

- **Feature inventory:** passkey-first ceremonies, cross-device education flows, fallback factor policy, fraud/device fingerprint signals, account recovery journeys.
- **Overlap with AP:** `browser-identity` passkey ceremonies; WebAuthn custody path (`key-custody` + `WebAuthnLib`).
- **AP lacks:**
  - `[SDK]` device/fraud risk signals feeding custody-policy decisions.
  - `[UX]` (deferred) passkey education/recovery flows (cross-device sync explanation, fallback enrollment nudges).
- **They lack:**
  - `[Contracts]` passkeys as on-chain custody credentials with rpIdHash pinning + UV enforcement — AP's contract-level WebAuthn verification is materially deeper.
- **Verdict:** adopt ceremony UX later; contract-level passkey verification is a defensible differentiator now.

---

## Compact entries — remaining products

| Product | Overlap with AP | AP lacks (layer) | Verdict |
| --- | --- | --- | --- |
| Magic | `connect-auth` email-first onboarding | `[UX]` ultra-low-friction hosted login | Adopt patterns |
| Capsule | `key-custody` + recovery UX | `[UX]` cross-device onboarding, recovery messaging | Adopt patterns |
| Portal | `key-custody` MPC WaaS | `[SDK]` enterprise SDK abstraction depth | Track |
| Crossmint | `connect` + `payments` edges | `[SDK]` fiat onramp/offramp adapters | Integrate adapters |
| Coinbase CDP Wallets | `key-custody`, `a2a` agent wallets | `[SDK]` hosted wallet rails; x402/USDC adjacency | Partner |
| Circle Programmable Wallets | `key-custody`, `payments` | `[SDK]` stablecoin-native transaction primitives | Integrate (see 09) |
| Clerk | `connect` org/session UX | `[UX]` drop-in components, org membership UI | Adopt patterns |
| Descope | `connect-auth` flows | `[UX]` no-code flow builder; `[SDK]` risk-based step-up | Track |
| Supabase/Firebase Auth | `connect-auth` baseline | `[SDK]` starter DX | Track |

---

## Focus-area gap rollup — by layer

### `[Contracts]` gaps

*None new in this focus area.* The contract-side auth surface (on-chain WebAuthn verification, custody credentials) is an AP **advantage** here, not a gap.

### `[SDK]` / package gaps — active

| Gap | Evidence | Roadmap ID |
| --- | --- | --- |
| External wallet connector breadth / chain abstraction adapter | Dynamic, Web3Auth, Particle | FG-SDK-2 |
| Enterprise SSO inputs: SAML support + SCIM provisioning into `identity-directory` | WorkOS, Auth0, Okta | FG-ENT-1 |
| Fraud/device-risk signal pipeline feeding custody + policy decisions | Stytch, Dynamic | FG-SEC-4 |
| Key-export / self-custody offboarding path | Privy, Web3Auth | FG-SDK-3 |
| SMS/email OTP custody factors | Privy, Magic | FG-SDK-4 |
| Fiat onramp/offramp partner adapters | Crossmint, Coinbase CDP | FG-SDK-5 |

### `[UX]` gaps — **deferred (recorded, not current focus)**

| Gap | Evidence |
| --- | --- |
| Hosted onboarding + account-linking components (passkey education, recovery prompts, org setup, wallet migration) | Privy, Clerk, Magic, Capsule |
| Policy admin UI with manual-approval queues | Privy, Permit.io |
| Hosted enterprise admin portal | WorkOS |

**Substrate advantages to preserve:** SA address as root (no vendor user-row lock-in); contract-level passkey verification (rpIdHash + UV); credential rotation as custody-policy operation (ADR-0011); FedCM IdP capability.
