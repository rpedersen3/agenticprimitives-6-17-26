# Spec 259 — Relying-app ⇄ IdP responsibility split (connect flow)

**Status:** accepted · **Supersedes the relying-side name UI of** [spec 257](257-credential-first-connection.md) + [spec 258](258-demo-gs-connect-ux.md) · **ADR:** [ADR-0029](../docs/architecture/decisions/0029-relying-app-vs-idp-responsibility-split.md)

## Problem

The relying apps (demo-gs "Global.Church", demo-jp "Impact Community") still owned a *name* on
their connect screen — a collapsed "Use my Impact name" panel with a handle field, a remembered
last-name, and a separate "Continue with this name" CTA. Even collapsed, it created the exact
mental model we are trying to avoid: that a social login is about to bind to `rp-adopt-4`. Worse,
the post-connect landing was incoherent for the (now default) **name-deferred** Google/passkey
path: the app rendered "Welcome, **you**" and "**you · choose a workspace**", where *workspace* is
invented jargon and *you* is an empty-name fallback. Direct user feedback: *"the social path
results in no name flow and I get 'you — choose a workspace'. The user has no idea what a workspace
is. This is really disjointed."*

## Decision

**Relying apps ask for access; the home (IdP) resolves the person; names are managed at the home.**

1. **The relying connect screen answers only four questions** — why am I connecting, what access is
   this app asking for, what happens after, and launch / cancel / popup-blocked / retry. It renders
   **one** credential-first CTA ("Continue with Global.Church" / "Connect via Impact Community") and
   launches the popup **nameless** (`startConnectPopup(undefined, …)`). It NEVER collects, prefills,
   or remembers an Impact name. The collapsed name panel, the handle field, the `LAST_NAME_KEY`
   memory, and the "Continue with this name" path are **deleted**.

2. **The home (demo-sso) owns everything identity-shaped** — credential choice (Google / passkey /
   wallet), account discovery + the account chooser, name lookup, name claim, recovery, credential
   linking, step-up, and delegation consent. The relying app trusts the returned subject
   (`id_token.sub` = the Smart Account **CAIP-10** address) and treats the name as a mutable
   public-handle facet, never the login key (OIDC `sub` is the stable key; `preferred_username`/name
   are mutable — [OIDC §2.5.3], Google "store the `sub`").

3. **A new passkey's handle is collected inside the home popup, never on the relying app.** A
   brand-new passkey home is `<handle>.impact-agent.me` and its WebAuthn **RP ID is domain-bound**;
   the `navigator.credentials.create()` ceremony must run on the handle's home origin, so a relying
   app physically cannot mint a correctly-scoped passkey. In the home popup's enroll entry, passkey
   and wallet therefore route to a single **"Continue with a passkey or wallet"** → name-entry step
   (consolidated from two redundant buttons + a redundant "use my name" link).

4. **The post-connect landing drops the "workspace" vocabulary and the fake name.** A name-deferred
   member has **no** name, so the app renders identity-light copy instead of a placeholder:
   - heading: `Welcome, {name}` when named, else `You're connected to {home}`.
   - header pill / dropdown: `{name}` when named, else **`Connected`** (with the home shown
     generically, never a junk `.impact-agent.me` subdomain derived from an empty handle).
   - "Roles are **workspaces**, not separate accounts" → "What would you like to do? You can do both
     and switch any time — it's all one connection, not separate accounts."
   - "Setting up your **workspace**" + the developer-jargon steps ("Read your vault (gs:needs /
     gs:offering)", "Resolved your available workspaces") → "Connecting you to {home}" / "Getting
     things ready" with human steps ("Signed in", "Confirmed your access", "Loaded your information",
     "Ready"). Access-disclosure rows use human labels ("Your posted needs"), not vault keys.
   - menu/labels: "choose a workspace" → removed; "Switch workspace: X" → "Switch to X"; "Set up X
     workspace" → "Set up X"; "Open GCO workspace" → "Open your organization"; "Open adopter
     workspace" → "Continue as adopter".

## Who owns what (industry-aligned; see ADR-0029 audit)

| Responsibility | Relying app | Home / IdP |
| --- | :---: | :---: |
| Access-intent display, launch / cancel / retry, popup-blocked fallback | ✅ | |
| Code exchange → app session (trusts CAIP-10 `sub`) | ✅ | |
| Credential choice · social · passkey · wallet · account chooser | | ✅ |
| Name lookup · name claim · new-passkey handle entry | | ✅ |
| Recovery · credential linking · step-up · delegation consent · connected-app receipt | | ✅ |

This matches Google ("Continue with"+account chooser, key on `sub`), Sign in with Apple, Clerk
`<SignIn/>`, Privy's modal, and WorkOS AuthKit hosted UI. We are *more* opinionated than Auth0/Okta
identifier-first only in that we don't collect a name at all unless a NEW passkey is being minted —
and even they collect the identifier on the **IdP-hosted** page, never the relying app.

## Residual risk + mitigation

A returning user who knows only their handle and has **no discoverable passkey on this device**
must not be stranded. Removing the relying-app name field is safe **iff** the home popup provides
(a) an account chooser, (b) handle/email entry when no discoverable passkey is found, and (c) at
least one non-passkey resolver (Google). demo-sso's `EntryExperience` provides all three (the
`enroll-name` → `NameStart` path + Google + the account chooser); the relying-app field was never a
substitute for them and is not retained as a crutch.

## Reference: smart-agent patterns to port

`/home/barb/smart-agent` (branch `003-intent-marketplace-proposal`) keeps its sign-in surface in the
identity host and has relying surfaces consume the resolved subject — we port that boundary (relying
trusts the returned subject; host owns the chooser) and **diverge** by expressing the subject as a
CAIP-10 Smart Account address (ADR-0010) rather than a hosted user id, and by making the name an
optional on-chain handle facet that may be entirely absent (name-deferral, spec 257). smart-agent
has no per-handle passkey-home subdomain model, so the RP-ID-bound new-passkey-handle rule is
AP-specific (no analog to port).

## Acceptance criteria

- demo-gs / demo-jp `ConnectScreen` render one nameless CTA; no name field, no `showNamePanel`, no
  "Use my Impact name", no `LAST_NAME_KEY`; `startConnectPopup(undefined, …)` /
  `startConnect(undefined)`. (Guarded by `connect-ux.test.ts`.)
- A Google/passkey name-deferred connect lands on a screen that never shows "you" or "workspace";
  the header pill reads "Connected" until a handle is claimed.
- demo-sso enroll entry shows Google + a single "Continue with a passkey or wallet"; the new-passkey
  handle is collected in the home popup.
- `pnpm --filter @agenticprimitives-demo/{gs,jp,sso-next} typecheck && build` green; demo-gs vitest
  green.
