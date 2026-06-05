# Spec 264 — FedCM IdP adapter (browser-integration layer over the authority substrate)

**Status:** draft (implementation spec) · **Decision:** [ADR-0031](../docs/architecture/decisions/0031-fedcm-and-browser-credential-apis-are-adapters.md) (FedCM is an adapter, not the substrate) · **Doctrine:** [spec 260](260-identity-architecture-doctrine.md) Part VII, [spec 259](259-relying-idp-responsibility-split.md) / [ADR-0029](../docs/architecture/decisions/0029-relying-app-vs-idp-responsibility-split.md) · **App:** demo-sso (the IdP) · **Packages (new, provisional):** `browser-identity`, `fedcm-rp`, `fedcm-idp`

## Abstract

Make agenticprimitives' home (Impact / demo-sso) capable of acting as a **FedCM Identity Provider**, so
relying sites can sign a user/agent in via `navigator.credentials.get({ identity: … })` — browser-
mediated, no third-party cookies, no redirect/iframe plumbing — and so "Sign in with my Person Agent" /
"Sign in with my Organization Agent" can sit beside "Sign in with Google." Per ADR-0031 this is a
**feature-detected, fallback-backed adapter** over the authority substrate: the FedCM assertion is a
*thin identity + intent bootstrap*; the deep capability/delegation object is issued by the substrate
afterward (the spec-259 consent → scoped, attenuated delegation), **never** encoded as FedCM scopes.

## Architecture — the browser-integration layer

```
Relying site (demo-gs / demo-jp / partner)
  └─ @agenticprimitives/browser-identity  ── chooseSignIn(): feature-detect →
        ├─ FedCM available?  → @agenticprimitives/fedcm-rp  (navigator.credentials.get)
        └─ else              → spec-259 popup/redirect ("Continue with the home")  [GUARANTEED fallback]
                                  │
   ┌──────────────────────────────┘  (thin assertion: sub = SA address, ADR-0010)
   ▼
demo-sso = FedCM IdP  (@agenticprimitives/fedcm-idp builders/verifiers + app-hosted endpoints)
   └─ identity bootstrapped → substrate runs consent + issues the SCOPED, ATTENUATED DELEGATION
        (capability · caveat · expiry · revocation · audit — spec 260 §VII.5–7). NOT FedCM's job.
```

**The fixed split (ADR-0031):** FedCM answers *"who is this user/agent to this relying site?"* The
substrate answers *"what authority, granted by whom, under what caveats, sub-delegable?, acting for which
org?, transaction rights?, revoked how?, audited how?"* FedCM is never used for agent-to-agent mandates,
transaction-signing authority, multi-hop delegation, caveats, org governance, revocation proofs, audit
trails, or cross-chain authority.

## IdP endpoints (hosted by demo-sso; built/verified by `fedcm-idp`)

Per the FedCM IdP contract, demo-sso exposes:

| Endpoint | Role | Maps to |
| --- | --- | --- |
| `GET /.well-known/web-identity` | declares the IdP config URL(s) for this origin | static (points at `/fedcm/config.json`) |
| `GET /fedcm/config.json` | IdP config: accounts/assertion/login/disconnect/metadata URLs, branding | derived from the whitelabel config |
| `GET /fedcm/accounts` | the signed-in agents the browser may offer (Person + Org Agents) | the home session(s) → resolved SAs + AP-1 profiles (spec 261) |
| `POST /fedcm/assertion` | mint the **thin** identity+intent assertion for the chosen account + RP | reuses the existing OIDC signer + **JWKS** (`/jwks`) |
| `GET /fedcm/login` | the URL the browser opens when the user must (re)authenticate | the spec-259 credential-first entry (passkey/Google/wallet) |
| `POST /fedcm/disconnect` | RP-initiated disconnect for an account | clears the relying-app grant (connected-apps + revoke) |
| `GET /fedcm/client-metadata` | RP ToS/privacy metadata | per-RP whitelabel entry |

All carry the existing **CSRF / origin** posture; the assertion is signed by the same key our `id_token`
uses, so existing verification (`(iss, sub)`, ADR-0010) is unchanged.

## The assertion (thin bootstrap — NOT the authority model)

```jsonc
{
  "iss":  "https://www.impact-agent.me",
  "aud":  "<relying-site client_id>",
  "sub":  "eip155:84532:0x…",        // the Smart Account (CAIP-10) — the canonical subject (ADR-0010)
  "agent_did": "did:pkh:eip155:84532:0x…",  // optional DID view of the same account
  "origin": "https://relying-site.example",  // RP origin the browser asserts (FedCM binds this)
  "nonce": "…",                       // RP-supplied replay protection (FedCM `params.nonce`)
  "intent": "signin",                 // signin | org-create | data-access (bootstraps the next step)
  "delegation_request_hash": "…"      // OPTIONAL — hashes the access the RP will request; binds the
                                      //   FedCM bootstrap to the delegation the SUBSTRATE then issues
}
```

The relying site treats the assertion exactly like the spec-259 path: it trusts `sub` (the SA address),
mints its own session, and — for anything beyond "who" — proceeds to the substrate's consent step, which
issues the scoped, revocable, attenuated delegation. **No `scope` string in FedCM grants authority.** The
optional `delegation_request_hash` lets the issued delegation be cryptographically bound to the exact
request the user saw in the FedCM prompt.

## RP integration (via `fedcm-rp`, behind `browser-identity`)

```ts
// browser-identity picks FedCM when available, else the spec-259 popup/redirect — same return shape.
const id = await chooseSignIn({
  providers: [
    { configURL: 'https://www.impact-agent.me/fedcm/config.json', clientId: 'demo-gs',
      params: { scope: 'profile.read agent.intent.request', nonce, intent: 'signin' } },
    // Chrome 136: multiple IdPs in ONE call — Person Agent, Org Agent, and (optionally) Google side by side.
  ],
});
// → { via: 'fedcm' | 'home-popup' | 'home-redirect', assertionOrCode, … } → exchange + (if needed) consent.
```

`chooseSignIn` **feature-detects** `IdentityCredential`; absent it, returns the guaranteed spec-259 path
(no behavior change for non-Chrome users). Multi-IdP (Chrome 136) drives the "use Google / Person Agent /
Org Agent / ecosystem IdP" chooser; "Sign in with Organization Agent" yields an assertion whose `sub` is
the **org** SA (acting-for).

## Phased implementation plan

**Phase 0 — adapter seam + feature-detect + fallback (no FedCM yet; pure refactor).** Add
`@agenticprimitives/browser-identity` with `chooseSignIn()` that today *only* returns the spec-259
path, plus a `fedcmAvailable()` probe. Route demo-gs/demo-jp through it instead of calling
`startConnectPopup` directly. Behavior identical; the seam is now FedCM-ready. *Ship + verify (no UX
change).*

**Phase 1 — demo-sso as a FedCM IdP (sign-in only).** Implement the seven endpoints (above) in demo-sso
+ the `fedcm-idp` builders/verifiers + `fedcm-rp` `get()` wrapper. `chooseSignIn` now uses FedCM when
available. The assertion bootstraps identity; the relying app still exchanges for its session + the
scoped delegation via the existing `/token` + `/oidc/grant` path (substrate issues the delegation). *Ship
behind feature-detection; fallback path unchanged.*

**Phase 2 — multi-IdP account chooser (Chrome 136).** `providers[]` = Person Agent + Org Agent
(+ optionally Google). "Sign in with Organization Agent" → org-SA assertion (acting-for). *Verify the
chooser + org path.*

**Phase 3 — intent + delegation negotiation binding.** Carry `intent` + `delegation_request_hash` in
FedCM `params`; after the assertion, the substrate's consent issues the scoped/attenuated delegation and
**binds** it to `delegation_request_hash` (spec 260 §VII.6 authority-chain). Org-create + data-access
intents resume the existing ceremonies post-bootstrap.

**Phase 4 — Digital Credentials API companion (watch/prototype).** Behind the same `browser-identity`
seam, add a DC-API presentation path (OID4VP / mdoc — spec 260 §IV.2) for "present a verifiable
credential," gated on browser support. Does not block Phases 0–3.

Every phase keeps feature-detection + the spec-259 fallback intact, and tracks the **Chrome 143→145
breaking-change surface** (structured JSON responses, endpoint validation) as a CI/manual checkpoint.

## Risk / adoption posture (see ADR-0031 for signals)

FedCM-**first**, not FedCM-**only**: it is MDN "Limited availability / Experimental," not Baseline, so
the spec-259 popup/redirect is the **guaranteed** path and FedCM is the enhancement where supported
(Chrome ≈70% share; Google retained FedCM while retiring most of Privacy Sandbox; W3C FPWD + active FedID
WG). The strategic posture: *we are not betting the substrate on FedCM — we make the substrate accessible
through FedCM when the browser supports it.*

## Reference: smart-agent patterns to port

`/home/barb/smart-agent` (branch `003-intent-marketplace-proposal`) keeps sign-in on the identity host
and has relying surfaces consume the resolved subject — we port that boundary and add FedCM as a
browser-native *transport* for the same "RP trusts the returned subject" contract (ADR-0029). We diverge
by (i) the subject being a CAIP-10 SA (ADR-0010), (ii) the thin-assertion rule (authority is issued by
the substrate post-bootstrap, never as FedCM scopes), and (iii) the feature-detect + spec-259 fallback.
smart-agent has no FedCM IdP, so the endpoint set is adopted from the W3C/Chrome FedCM IdP contract, not
ported.

## Acceptance criteria

- `browser-identity.chooseSignIn()` returns the spec-259 path when FedCM is unavailable (feature-detect),
  with **no UX change** for non-supporting browsers (Phase 0).
- demo-sso serves the FedCM IdP endpoints; a Chrome RP can `navigator.credentials.get({identity})` and
  receive a thin assertion whose `sub` is the SA address; the relying app then obtains its session + a
  scoped delegation via the existing substrate path (Phase 1).
- No FedCM `scope` string ever grants authority; every authority decision reads the substrate
  delegation (ADR-0031 invariant).
- Multi-IdP chooser works incl. "Sign in with Organization Agent" (Phase 2); `delegation_request_hash`
  binds the issued delegation (Phase 3).
- Package purity: `browser-identity` / `fedcm-rp` / `fedcm-idp` carry no white-label/vertical content
  (ADR-0021); IdP hosting + account list live in demo-sso.
