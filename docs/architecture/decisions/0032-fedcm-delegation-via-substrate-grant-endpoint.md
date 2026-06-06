# ADR-0032 — FedCM issues identity; a substrate grant endpoint issues the delegation

**Status:** accepted (2026-06-05) · **Spec:** [264](../../../specs/264-fedcm-idp-adapter.md) (amends the assertion/grant split) · **Extends:** [ADR-0031](0031-fedcm-and-browser-credential-apis-are-adapters.md) (FedCM is an adapter, not the substrate; thin-assertion rule) · **Relates:** [ADR-0010](0010-smart-agent-canonical-identifier.md) (SA = identity), [ADR-0013](0013-no-silent-fallbacks.md) (one mechanism per path), [spec 235](../../../specs/235-google-kms-custody.md) (per-(iss,sub) KMS custody), [ADR-0028](0028-accepted-testnet-posture.md)

## Context

The FedCM RP ceremony (spec 264, demo-gs) needs TWO things to seat a member: their **identity** (which
Smart Agent they are) and a **scoped delegation** (`person → relying-app delegate`, the authority the app
acts under). FedCM natively returns ONE opaque `token` string. A first implementation packed
`{ id_token, delegation }` into that token — minting the delegation inside `/fedcm/assertion`. That
**violated ADR-0031's thin-assertion rule** (FedCM became the capability substrate, not just an identity
adapter) and it **failed in practice**: the assertion handler called the browser-side `givePermission`
path, which reads `document.cookie` for CSRF — `document is not defined` on the server, so every grant
threw `give_permission_failed`.

The naïve fix — a plain credentialed grant endpoint authorized by the `ap_sso` cookie — is **unsafe**:
`ap_sso` is `SameSite=None` (it must be, so FedCM's cross-site fetches carry it), so *any* site could
`fetch(.../grant, {credentials:'include'})` and silently harvest a delegation. The cookie cannot be the
authorization.

Two custody classes also pull in different directions. A **Google/KMS** member (spec 235) is custodied by
a per-(iss,sub) key the broker can derive server-side → the delegation can be signed with **zero device
prompts**. A **passkey or wallet** member is custodied by a key that lives **only on the device** → the
substrate physically *cannot* sign their delegation server-side.

## Decision

**FedCM issues identity (a thin id_token); a separate, id_token-authorized substrate endpoint issues the
delegation; the custody class decides where it is signed.** Three layers:

### Layer 1 — `/fedcm/assertion` is thin (ADR-0031 restored)
The assertion verifies the chosen account against the home session and returns **only**
`buildTokenResponse(id_token)` — the same `AgentSession` the relying app already verifies, nonce-bound,
`aud` = the client. No delegation, no custody call, no `document`.

### Layer 2 — `/fedcm/grant` (new): id_token → delegation
A credentialed POST `{ id_token, client_id }` from the relying app, authorized by the **id_token, not the
cookie**:
1. Verify the id_token is one **we** minted for **this** client (`expectedAud = client_id`,
   `expectedIss = home`). Only a site the user actually picked in the browser's FedCM chooser holds an
   `aud`-bound token — the browser binds `aud` to the requesting origin, and we re-check
   `Origin ∈ client origins`. This defeats the `SameSite=None` CSRF-harvest: a bare credentialed POST
   from `evil.com` has no valid demo-gs-`aud` id_token and a non-registered Origin.
2. Read the `ap_sso` cookie purely to reach **custody** (the `via` + custody token) and require it to be
   the **same subject** as the id_token.
3. Branch on custody class (Layer 3).

### Layer 3 — custody boundary
- **Google/KMS** → the broker calls a **bridge-authenticated** demo-a2a endpoint
  (`/custody/google/sign-site-delegation`) that derives `C_sub`, **builds** the `person → delegate`
  least-privilege site delegation server-side, and signs it. Zero device prompt. Returns `{ delegation }`.
- **passkey / wallet** → return `{ needs_device_credential, via }`. The relying app falls back to the
  spec-259 popup/redirect, where the **device** signs the delegation (the only place it can). This is an
  **explicit** fallback (ADR-0013), not a silent second mechanism: the grant path has exactly one answer
  per custody class — sign here, or say "the device must."

### Constrained signing (custody invariant)
The bridge sign endpoint does **not** sign a caller-supplied hash (unlike the browser `/custody/google/sign`,
which a device-gated UI guards). It **builds** the delegation itself — time-boxed, value 0, allowed-targets
`{relationship, naming, subregistry}`, `delegator = the session's SA` — and signs only that. Two independent
gates protect it: the **bridge HMAC envelope** proves the broker (audience `custody.google.sign-delegation`,
single-use nonce, 60 s freshness — SEC-010), and the **custody token** proves the member. A broker
compromise can therefore at worst mint a scoped, value-0, revocable site delegation — **never** a
fund-moving userOp. The broker already holds the KMS master, so this path grants it **no new authority**;
it only adds a constrained shape for an authority it already has.

## Consequences

- FedCM is purely an identity adapter again (ADR-0031 holds); the delegation is always the substrate's
  scoped, revocable, value-0 object, issued by the substrate — never a FedCM payload.
- One round-trip more than the (broken) packed-token design, but each leg has a single, auditable
  responsibility.
- Google members connect to demo-gs with zero device prompts after the FedCM chooser; passkey/wallet
  members get the identity fast-path then ONE on-device signature via the popup/redirect fallback —
  unavoidable and correct (device custody signs on the device).
- The grant endpoint is the **only** new browser-reachable surface; it is fail-closed (id_token +
  same-subject + registered-Origin all required) and CORS-pinned to the exact RP origin with credentials.

## Who gets the FedCM chooser — the per-origin login-status boundary (2026-06-05)

FedCM's account chooser only appears for members the **IdP origin** (`www` apex) sees as logged-in, via
the per-origin `navigator.login.setStatus` signal. This cleanly splits along custody class:

- **Google/KMS** members complete their OIDC return **on www** → www's login-status is `logged-in` →
  chooser appears → Layer-2 server-side sign → zero-prompt connect. FedCM delivers its full payoff.
- **passkey/wallet** members are **subdomain-homed** (`<handle>.impact-agent.me`, rpId-isolated). Their
  login-status is set **on the subdomain**, and the FedCM status signal is **per-origin and does not cross
  subdomains** (the `ap_sso` session cookie *does* — `.impact-agent.me`, `SameSite=None` — but the status
  signal does not). So the www IdP reports them logged-out → **no chooser** → the demo-gs FedCM strategy
  throws → the spec-259 **redirect** fallback runs.

**Decision: do NOT force the chooser for subdomain-homed members.** It is structurally a non-win: a
device-custodied member must produce an **on-device signature** for the delegation regardless (Layer 3),
so the redirect to their home is unavoidable — a FedCM chooser would only prepend a dialog to the same
redirect. Making www recognize cross-subdomain sessions would require a hidden www-origin iframe calling
`setStatus` across a cross-site boundary (Chrome-restricted, uncertain) for no real step-saving. FedCM is
therefore the **Google/www-homed fast-path**; passkey/wallet use the (working) redirect by design. The
default demo-gs path (no `?fedcm=1`) already uses the popup for everyone, so this surfaces only under the
opt-in test flag.

## Reference: smart-agent patterns

smart-agent has no FedCM IdP; the assertion/grant split is adopted from the W3C/Chrome FedCM contract.
The custody-class branch ports spec 235's per-(iss,sub) KMS derivation (server-custodied) vs. device
credentials, and the bridge-HMAC envelope (SEC-010) is the same one the Google `resolve` leg uses.

## Open follow-ups (for the security review)

- **id_token replay within TTL.** The id_token is `aud`-bound + short-lived (3600 s); a replay re-issues
  the *same* scoped delegation. If the review wants single-use, bind a one-time `jti` in KV at assertion
  and consume it at grant.
- **Grant rate / audit.** The bridge sign emits `key-custody.sign` (G-2); confirm the grant endpoint's
  own audit line and any per-subject rate cap are sufficient.
