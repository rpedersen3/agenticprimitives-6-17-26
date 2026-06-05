# ADR-0029 — Relying apps ask for access; the home (IdP) resolves the person

**Status:** accepted (2026-06-05) · **Spec:** [259](../../../specs/259-relying-idp-responsibility-split.md) · **Builds on:** [ADR-0010](0010-smart-agent-canonical-identifier.md) (SA address is the identity), [ADR-0013](0013-no-silent-fallbacks.md)

## Context

Our relying apps (demo-gs, demo-jp) opened a popup to the central home (demo-sso) but still owned a
*name* on their own connect screen. An external audit of how mature identity products split
responsibility — Auth0, Okta, Clerk, Privy, Stytch, WorkOS, Sign in with Apple, Google Identity
Services — found a clear consensus:

- The relying app renders **"Continue with X"** and trusts the returned subject; it does **not**
  collect a username before federating. (Google "Sign in with Google" + account chooser; Apple
  "Continue with Apple"; WorkOS AuthKit hosted UI; Clerk `<SignIn/>`; Privy modal.)
- The **IdP owns** account discovery, the account chooser, social/passkey/wallet login, recovery,
  credential linking, and profile-handle management. Even Auth0/Okta *identifier-first* collects the
  identifier on the **IdP-hosted** page, never the relying app (home-realm discovery is an IdP-side
  function).
- The OIDC **`sub` is the stable account key**; `email`/`preferred_username`/`name` are mutable and
  "MUST NOT be used as unique identifiers" ([OIDC Core §2.5.3]; Google: "store the `sub` field …
  the only identifier"). This is exactly our model: `id_token.sub` = the Smart Account CAIP-10
  address; the name is a public handle facet.
- **WebAuthn RP ID is domain-bound** (eTLD+1+): a passkey created for `<handle>.impact-agent.me` can
  only be created on that origin. A relying app at `global.church` literally cannot mint a
  correctly-scoped passkey for the home, so a relying-app "new passkey" name field is a footgun.

The pre-existing relying-side name panel contradicted all four points, and its empty-name fallbacks
produced an incoherent post-connect landing ("Welcome, you" / "you · choose a workspace").

## Decision

Relying apps own only the **bookends** — declare access-intent + launch the popup, and redeem the
code → start their own session (trusting the CAIP-10 `sub`). **Everything identity-shaped** —
credential choice, account chooser, name lookup/claim, new-passkey handle entry, recovery, linking,
step-up, delegation consent — is owned by the home (demo-sso). Names are managed at the home, never
at relying sites. A new passkey's handle is collected **inside the home popup** (RP-ID reason), via
a single "Continue with a passkey or wallet" → name step. The relying post-connect UI renders
identity-light copy for the name-deferred path ("Connected", "You're connected to {home}") and drops
the invented "workspace" vocabulary.

## Consequences

- **Aligned with, and slightly more opinionated than, industry practice** — we never collect a name
  unless a new passkey is being minted, and that happens IdP-side. Less surface, fewer footguns.
- The relying-app name field is **deleted**, not deprecated (architecture-purity). `LAST_NAME_KEY`
  and the named-connect path are gone; the launch wrappers always enroll nameless.
- **Residual risk:** a returning user who knows only their handle with no discoverable passkey on
  this device must be resolvable IdP-side. demo-sso's `EntryExperience` provides the account chooser
  + handle/email entry + Google, so the relying-app field is not needed as a crutch (spec 259
  acceptance).
- Enforcement is doctrine + `apps/demo-gs/src/components/connect-ux.test.ts` (no `showNamePanel`, no
  "Use my Impact name", nameless launch).
