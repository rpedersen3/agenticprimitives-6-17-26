# Spec 229 — Personal central auth (per-person IdP) + per-site passkey enrollment

**Status:** v0 / planned (2026-05-26).
**Owner:** `apps/demo-sso` (extended into **the central auth**) + a new relying-site
app `apps/demo-org`. Wires existing packages; adds no new package.
**Architecture commitment:** Executes existing doctrine —
[ADR-0010](../docs/architecture/decisions/0010-smart-agent-canonical-identifier.md)
(canonical SA is the identity), [ADR-0011](../docs/architecture/decisions/0011-credential-recovery-and-re-association.md)
(credentials are rotatable facets; the SA address never changes),
[ADR-0014](../docs/architecture/decisions/0014-connect-is-an-sso-broker.md)
(the credential ceremony belongs at a broker origin, not each relying site),
[ADR-0016](../docs/architecture/decisions/0016-canonical-agent-id-is-the-sso-subject.md)
(no-owner `AgentSession`, CAIP-10 subject),
[ADR-0017](../docs/architecture/decisions/0017-oidc-social-is-a-login-facet-not-custody.md)
(credential grade / step-up), [ADR-0013](../docs/architecture/decisions/0013-no-silent-fallbacks.md)
(one mechanism per path). It introduces **one new pattern** that likely warrants a
companion ADR-0019 (see §11): the **personal central auth** — a per-person IdP at
the person's own subdomain that holds their primary credential and authorizes
**per-relying-site passkey enrollment**.
**Related specs:** [220 (bootstrap)](./220-agent-identity-bootstrap.md),
[221 (recovery)](./221-credential-recovery.md), [223 (directory)](./223-identity-directory.md),
[224 (connect)](./224-agentic-connect.md), [227 (real connect)](./227-real-connect-experience.md),
[215 (naming)](./215-agent-naming.md), [216 (relationships)](./216-agent-relationships.md).

---

## 1. Purpose

A person reaches their **one canonical Smart Agent** from any web app by typing a
**memorable agent name** (`rpedersen` → `rpedersen.agent`). Because **WebAuthn
passkeys are bound to a single origin (RP ID)**, a passkey created at one site
cannot sign at another. We turn that constraint into a clean model instead of
fighting it:

- **The agent name is the universal username.** It resolves on-chain to the same
  canonical agent everywhere.
- **Each relying site keeps its own local passkey** as an on-chain custodian, so
  **return visits are one-touch** (local Windows Hello / Face ID, no redirect).
- **The first visit to a new site bootstraps via the person's central auth** —
  the person's own origin (`<handle>.impact-agent.io`, the same subdomain that
  hosts their A2A-agent app) which holds their **primary** credential. The central
  auth proves custody **once** and authorizes adding the new site's local passkey
  as a custodian (`addPasskey` signed by the primary credential, gas-sponsored).
- **After enrollment, the relying site authenticates its local passkey DIRECTLY
  on-chain** (`isCustodian` against the agent). The central auth is an
  **enrollment authority, not a runtime SSO dependency** — no per-request
  redirect, no central point that can lock the user out of an app they already
  enrolled.

This proves the thesis for the multi-app world: **one canonical agent; many
per-site credential facets; a self-sovereign personal IdP that onboards new
sites; and runtime auth that depends only on the chain.** No SIWE/wallet
required; no Google.

## 2. Reference: smart-agent patterns to port (REQUIRED)

From `/home/barb/smart-agent` (`003-intent-marketplace-proposal`):

| Pattern | smart-agent location | Port as |
| --- | --- | --- |
| Passkey register/assert ceremony → P-256 `(x,y)` + credential digest | `apps/web` passkey signup/verify | already ported in `apps/demo-sso/src/lib/passkey.ts` + `connect-auth/passkey` |
| Bundler + paymaster gasless `addPasskey`/`execute` | `packages/sdk/{bundler,paymaster}.ts` | `@agenticprimitives/agent-account` + `apps/demo-a2a` `/session/deploy`, `/account/{build,submit}-call-userop` (the hardened nonce-gated path in `apps/demo-sso/src/connect-client.ts`) |
| Name → canonical address resolve / reconnect | `passkey-verify` (name→addr) | deployed `AgentNameRegistry` + `AgentNamingClient` + `/connect/name-info`, `/connect/with-name` |
| SSO broker `/authorize` → code → `/token` → JWKS | smart-agent had no broker | extend `apps/demo-sso` `functions/{authorize,token,jwks}.ts` (already present from spec 224) |

### 2.1 Deliberate divergence / NEW pattern (do NOT expect a smart-agent analog)

1. **Personal central auth (per-person IdP).** smart-agent had one app + one origin.
   We give each person an IdP at **their own subdomain**. "Central" means central
   **for that person** (all of *their* relying sites federate to *their* origin),
   not a global IdP. Its authority is the person's own primary credential — it is
   **person-agent-based**, not an operator-run identity service.
2. **Per-site passkey custodians via central-auth enrollment.** Rather than share
   one passkey across origins (impossible) or derive identity from email
   (forbidden — ADR-0010), each relying site enrolls its **own** local passkey as
   an on-chain custodian, authorized once by the central auth. Credentials are
   facets that accrete (ADR-0011); the SA address never changes.
3. **Central auth is bootstrap-only, not a runtime dependency.** Unlike a classic
   IdP that every request federates to, after enrollment the relying site verifies
   custody **directly on-chain**. This is the canonical-identity thesis: the chain
   is the source of truth; the IdP is a convenience for onboarding new keys.

## 3. The journey

**First visit to a new relying site (`demo-org`), passkey-only person, no wallet:**

1. App: "Connect to your Smart Agent." User types `rpedersen`.
2. App resolves `rpedersen` → `rpedersen.agent` → canonical agent address + the
   person's **central-auth issuer** (§4).
3. App sees: agent exists; **this site has no local passkey for it yet**.
4. App: *"First time using rpedersen.agent on this site. Add this site to your
   agent?"* → user clicks **Add this site**.
5. App registers a **local passkey** on its own origin, labelled `rpedersen.agent`
   → obtains `{ credentialIdDigest, x, y }`. The private key never leaves the
   authenticator.
6. App redirects to the central auth `/authorize` with `aud`, `redirect_uri`,
   `state`, and the **enroll** parameters `{ credentialIdDigest, x, y }` (§5).
7. Central auth authenticates the person with their **primary** passkey (its own
   origin — Windows Hello), shows **consent** naming the requesting site + key
   fingerprint, and on approval signs `addPasskey(digest, x, y)` on-chain
   (gas-sponsored), then redirects back with a single-use `code`.
8. App exchanges `code` at `/token` → `AgentSession` (`sub` = the person agent),
   verified against `/jwks`. App persists its local passkey. **Signed in.**

**Return visit:**

1. App: **"Continue as rpedersen.agent."** Local Windows Hello prompt.
2. Local passkey signs a challenge → `/connect/with-name` verifies
   `isCustodian(agent, pia)` on-chain → `AgentSession`. **No redirect.**

## 4. Issuer discovery (one mechanism — ADR-0013)

A relying site must learn **where a name's central auth lives** to redirect there.
The person's central auth is their own SSI-wallet origin (`<handle>.impact-agent.io`),
where the ROOT passkey is registered (WebAuthn `rpId = that host`). The relying site
discovers it from the name and redirects there.

**Canonical mechanism — the `authOrigin` facet.** A person agent declares its central
auth as an on-chain **profile string property** on the `agentProfileResolver`:
`getStringProperty(agent, AUTH_ORIGIN)` (predicate `keccak256("authOrigin")`), e.g.
`"https://r-pedersen.impact-agent.io"`. Resolution is a single read — `name → agent →
authOrigin` — **no fallback chain**. An UNSET facet is an *answer*, not a trigger to try a
second mechanism: it resolves to the configured **platform default origin** (a pure
constant). That keeps ADR-0013's "one mechanism" intact (a defined default for an unset
optional field is not a second remote lookup).

**Direction split (each operation = one mechanism):**
- **Connect** (existing agent): resolve `authOrigin` for the agent → redirect there.
- **Bootstrap / sign-up** (no agent yet, so no facet): there is nothing to resolve, so the
  relying site uses the configured platform Connect origin. This is a *different operation*,
  not a fallback within the connect read path.

**Migration phasing (see P4/P5).** P4 isolated resolution behind a single
`resolveAuthOrigin(name)` seam. At the **P5 flip (live on `*.impact-agent.io`)** the seam
**derives** each person's home from the name (`<label>.impact-agent.io`) — the subdomain ⟺
name-label binding is canonical, so this is a pure computation, not a facet read. The
`authOrigin` profile facet (below) is **not written** (it would add no information over the
derivation and would cost a profile-register + an ontology-term registration); it is retained
as the FUTURE override for self-hosted homes. The protocol in §5 is unchanged; only this
resolver + deployment topology change.

## 5. Enrollment protocol (central auth `/authorize` → `/token`)

Extends the spec-224 broker. `GET /authorize`:

```
GET https://<central-auth>/authorize
      ?aud=<relying-site-id>            # e.g. "demo-org"
      &redirect_uri=<allowlisted>       # exact-match allowlist (CN-1)
      &state=<opaque>                   # CSRF/replay binding, single-use
      &enroll_digest=<bytes32>          # the relying site's new local passkey
      &enroll_x=<uint256>
      &enroll_y=<uint256>
```

Central-auth obligations (fail-closed):

1. **Validate** `redirect_uri` against the allowlist and `aud` against the
   registered relying sites. Reject otherwise.
2. **Authenticate the person** with their **primary** credential (passkey at the
   central-auth origin) — **custody-grade** (ADR-0017). A login-grade session is
   insufficient to enroll a custodian.
3. **Consent**, naming the requesting `aud`/origin and showing the enroll key
   fingerprint: *"Add a new sign-in key for **demo-org** to rpedersen.agent?"* —
   scoped per §5.1 (a **site** credential, not a root one).
4. On approval, submit `execute(self, addPasskey(enroll_digest, enroll_x,
   enroll_y))` signed by the primary credential, via the hardened nonce-gated
   path (reuse `addPasskeyCredential` / `executeCall`). Idempotent if already a
   custodian (`PasskeyAlreadyRegistered` → treat as success).
5. Mint a single-use `code` bound to `{ aud, sub, redirect_uri }` (120 s TTL) and
   `302` back to `redirect_uri?code=…&state=…`.

`POST /token { code, aud }` → `{ agentSession }` (existing; single-use, aud-checked).
`GET /jwks` verifies it (existing). `state`/PKCE/nonce + single-use code reuse the
existing CN-1/CN-9 handling.

### 5.1 A relying-site key is a SCOPED DELEGATE, not a custodian (ADR-0019)

The central ANS passkey does **not** "become" the passkey for every relying site,
and a relying-site key is **never a custodian** of the person's canonical Smart
Agent. WebAuthn credentials are RP-scoped, so each site's key is a separate P-256
credential created at that site's `rpId`. What the enrollment grants the site key is
a **caveated ERC-7710 delegation** from the person SA — least-privilege, revocable,
scoped — signed by the person's ROOT/primary credential at the central auth. The
ROOT credential remains the SA's **only custodian**.

```
rpedersen.agent  →  Person Smart Agent (ERC-4337)
  ├─ ROOT passkey   rpId: auth.impact-agent.io   the ONLY custodian (custody-grade;
  │                                               add/remove creds, recover, rotate)
  └─ optional EOA / SIWE                          recovery / fallback custodian
        │
        └─(issues caveated delegations to)─▶ relying-site keys (delegates, NOT custodians)
              demo-org site key   rpId: demo-org.example   delegation: targets={factory,
                                                            naming, relationship}, time-boxed
              demo-sso site key   rpId: demo-sso.example   delegation: scoped to demo-sso
```

**The delegation** (ERC-7710, the deployed `DelegationManager` + caveat enforcers):

```
Delegation {
  delegator: personAgent           // the canonical SA
  delegate:  siteKeyAddress         // the relying site's local key (PIA / session key)
  caveats:   [ TimestampEnforcer(validUntil), AllowedTargetsEnforcer([factory, naming,
               relationship]), AllowedMethodsEnforcer([create/register selectors]),
               ValueEnforcer(0) ]   // least-privilege; tune per relying site
  signature: ERC-1271 over hashDelegation, produced by the ROOT passkey
}
```

The ROOT passkey signs the EIP-712 `hashDelegation` digest with the **same WebAuthn
path that signs UserOps** (`signWithPasskey`); the SA's `isValidSignature` validates
it at redemption. Only the public key + the signed delegation travel; no private key
leaves the authenticator. This needs **no new contract code** — `DelegationManager`
(`0xaEb6…89f2`) + `TimestampEnforcer`/`AllowedTargetsEnforcer`/`AllowedMethodsEnforcer`/
`ValueEnforcer` are deployed; the off-chain SDK is `packages/delegation`.

**Blast radius:** a compromised relying site can only exercise its own caveated
delegation until revoked (`revokeDelegationByOwner`) — it cannot add credentials,
recover, or take over the identity. (Contrast: a custodian could do all of that —
the takeover risk that motivated ADR-0019.)

### 5.2 WebAuthn algorithm + on-chain verification (ES256 / P-256)

Custody (ROOT) credentials AND delegation signatures verified on-chain MUST be
**ES256 / P-256**. Registration requests it explicitly: `pubKeyCredParams: [{ type:
'public-key', alg: -7 }]` (ES256), with `userVerification: 'required'`. An
authenticator returning RSA/EdDSA is unusable (the P-256 verifier can't check it).
On-chain verification uses the **P-256 precompile**: EIP-7951 `P256VERIFY` at
`0x100` (superseding the RIP-7212-style precompile some rollups expose); off
precompile chains, a pure-Solidity P-256 verifier is the fallback (budgeted in gas).

### 5.2 WebAuthn algorithm + on-chain verification (ES256 / P-256)

Custody credentials MUST be **ES256 / P-256** so the agent can verify them on-chain.
Registration requests it explicitly: `pubKeyCredParams: [{ type: 'public-key',
alg: -7 }]` (ES256). An authenticator returning RSA/EdDSA is unusable for custody
(the P-256 verifier can't check it). On-chain, verification uses the **P-256
precompile**: EIP-7951 `P256VERIFY` at `0x100` (which supersedes the RIP-7212-style
precompile some rollups already expose); off precompile chains, a pure-Solidity
P-256 verifier is the fallback (already budgeted in `buildCallUserOp` gas).

## 6. Relying-site (`demo-org`) auth — delegation-holding, not custody (ADR-0019)

- **Has a local key + delegation for this agent (return):** challenge → local key
  assert → `POST /connect/with-name` (relying site's own broker) verifies the key
  asserts AND that a **live, unrevoked, in-window delegation** exists from the agent
  to that key (`hashDelegation` validated by the SA's `isValidSignature`;
  `DelegationManager.isRevoked` false; caveats evaluated) → issues a **scoped
  (login-grade, NOT custody-grade) `AgentSession`** (`aud=demo-org`). It is NOT an
  `isCustodian` check — the site key is a delegate, not a custodian.
- **Acting on the person's behalf** (e.g. create an org): the site key **redeems**
  the delegation via `DelegationManager.redeemDelegation(...)` (gasless UserOp) to
  execute the caveated calls. Caveats enforce on-chain; no session grade exceeds them.
- **No local delegation (first visit):** §5 enrollment (central auth issues the
  delegation), then store it locally.
- **Session persistence:** the localStorage + TTL pattern (own origin). `signOut`
  clears it. Custody-class actions (credential rotation, recovery) are **never**
  available to a relying-site session — they require the ROOT credential (ADR-0017).

One mechanism per state; "no delegation" triggers enrollment, never a silent
fallback to a weaker check (ADR-0013).

## 7. `demo-org` as the first relying site (deliverable)

`apps/demo-org` (separate origin) demonstrates the model + an org-creation feature
(folds the earlier demo-org ask):

- **Header** (upper-right): signed-out → **Sign in / Sign up**; signed-in →
  `rpedersen.agent` with a menu (view agent, copy address, sign out).
- **Connect** = §3/§6 (name-first; no Google; no SIWE required).
- **Create organization (central-auth ceremony):** type an org name →
  `/connect/name-info` uniqueness gate → demo-org calls `startOrgCreation` (build the
  central-auth URL with the person name, the org base, and **this site's delegate SA**)
  and opens the demo-sso popup. The popup runs `createChildAgentForSite`: deploy a
  **mode-0 AgentAccount custodied by the person's ROOT passkey ONLY** (salt = scope +
  entropy — **never the name**, ADR-0010) → claim the org name (batched register +
  setPrimary, nonce-gated) → **person `HAS_GOVERNANCE_OVER` org** edge (propose from the
  person SA, confirm from the org SA — the ROOT passkey signs both, as it custodies both)
  → mint a scoped `org → site-delegate` delegation. The popup returns
  `{orgAgent, orgName, edgeId, governed, orgDelegation}`; demo-org stores it and shows a
  "My organizations" list. Progress modal throughout.

  **Org custody = the ROOT passkey, full stop** (decided 2026-05-26; memory
  `project_demo_org_durable_org_custody`). EVERY agent a relying site creates — the org
  now, **any service agent (e.g. Treasury) later** — follows the SAME pattern as the
  person SA: deployed at the central auth, custodied by the ROOT passkey ONLY (no EOA
  co-custodian, never the site's per-origin passkey, never the person SA — an agent can't
  custody another agent, the hard rule). So the agent is controllable from the person's
  canonical identity anywhere and survives a relying-site storage wipe. The relying site
  is handed a scoped, revocable `agent → site-delegate` delegation to *operate* the agent
  (e.g. `readOrgData` presents it; demo-mcp keys the read by the delegator), never custody.
  `createChildAgentForSite` is parameterized by relationship type so Treasury is a thin
  addition (different `relationshipType`/direction, same custody + delegation shape).
  `HAS_GOVERNANCE_OVER` is governance *metadata*, not signing power.

## 8. Security considerations

1. **Site keys must be ROLE-SCOPED, not root** (§5.1). The target model gives a
   site credential narrow authority (sign for its site; create/govern orgs if
   approved) and reserves `canAddCredentials`/`canRecover` for the ROOT (central)
   credential — so no relying-site passkey becomes a master key. **Current-contract
   reality:** `addPasskey` adds a *full* custodian (no on-chain role field), so the
   demo currently grants full authority to an enrolled site key and discloses it in
   consent. Hardening (flag for a contracts spec): per-credential roles/scopes on
   `AgentAccount`, OR mint the site a **scoped delegation / session key** instead of
   a custodian. The central key only ever *authorizes* the add — it is never reused
   directly by a relying site (WebAuthn RP-scoping makes that impossible anyway).
2. **Enrollment requires custody-grade auth at the central auth + explicit
   consent.** A malicious relying site cannot enroll its own key silently: the
   person must authenticate with their primary credential and approve, seeing the
   requesting origin + key fingerprint.
3. **Enroll key is bound to `state`/redirect_uri**; the minted `code` is bound to
   `{ aud, sub, redirect_uri }`, single-use (no cross-site code replay).
4. **No private key leaves the device.** Only the public `(x,y)` + digest of the
   relying site's local passkey travel to the central auth.
5. **Bootstrap-only dependency.** A compromised/offline central auth cannot lock a
   user out of already-enrolled sites (runtime auth is on-chain), and cannot act
   as the user without their primary credential.
6. **Revocation:** under ADR-0019, removing a site = `revokeDelegationByOwner` of
   that site's delegation (delegator or delegate may revoke) — lighter than a
   custody op, and it does not touch the custodian set.

### 8.x Security-audit status (2026-05-26)

A security review of the cross-origin enrollment (redirect + the popup variant) produced 11 findings. Status:

**Hardened in the demo (done):**
- **Popup channel origin trust (F3):** the ceremony runs in a popup; demo-org accepts a result ONLY from the exact popup window (`event.source`) at the exact `CENTRAL_AUTH_ORIGIN` (`event.origin`); demo-sso posts back ONLY to the validated relying origin (never `'*'`). See `apps/demo-org/src/lib/central-auth.ts` + `postToOpener` in demo-sso.
- **Fail-closed `state` (F5):** a redirect/popup result with absent or mismatched `state` is rejected (no more `&&` short-circuit) — forged returns can't fake success or inject a recovery key.
- **Consent binds to the signed key (F2):** the consent shows the fingerprint of the exact `(digest,x,y)` being added.
- **userVerification REQUIRED + ES256-only (F9):** custody passkeys demand biometric/PIN, not mere presence.
- **Clickjacking (F8):** `frame-ancestors 'none'` / `X-Frame-Options: DENY` via `_headers` on both apps.
- **Storage hygiene (F11):** demo-org's passkey storage key namespaced to its own app.

**DECIDED — the best-architecture fix (ADR-0019, accepted 2026-05-26; in implementation):**
- **F4 (the spine) → scoped delegation, not a custodian.** A relying-site key is a
  **delegate** of the person SA via a caveated ERC-7710 delegation (no new
  contracts — the `DelegationManager` + enforcers are deployed), NOT a custodian.
  Runtime auth becomes "holds a live delegation" (§6), the session is scoped/
  login-grade, and a compromised site can only exercise its caveats until revoked.
  Per-credential custody roles were **explicitly rejected** (would put authority-
  scoping in the custody core — spec-213 firewall). The `addPasskey`-as-full-custodian
  path is retired for relying-site enrollment (it remains for true ROOT credential
  rotation / self-recovery, ADR-0011).
- **F1 → server-minted enrollment authority.** A demo-sso **server** endpoint
  validates `aud`/`redirect_uri` against a **server-env** allowlist + requires a
  custody-grade session, and mints the single-use authorization the delegation-issue
  step must present (`{aud, agent, delegate, caveatHash, redirect_uri, state}`).
  Client allowlists become advisory. In the delegation-native flow there is no
  privileged on-chain userOp through demo-a2a to gate — the grant is a signed
  delegation struct.
- **F2-strong / F6 / F7 fold in:** the WebAuthn approval commits to the server
  authorization (not an opaque hash); the org-recovery key is verified on-chain
  (`hasPasskey`) before use; enrollment threads the agent **ADDRESS**, not the name.

**Implementation status:** ADR-0019 + this spec rewrite are landed; the demo-sso/
demo-org delegation rewrite (issue → verify → redeem) + the server grant endpoint are
the next build. The demo currently still uses the `addPasskey`-custodian path and
discloses the full-authority grant in consent until the delegation rewrite ships.

## 9. Implementation requirements

- **Central auth (extend `apps/demo-sso`):** add `GET /authorize` enrollment per
  §5 (consent UI + primary-passkey auth + `addPasskey` via the existing hardened
  path); register `demo-org` `aud` + callback in `REDIRECT_URI_ALLOWLIST`; reuse
  `/token`, `/jwks`. No new package.
- **`apps/demo-org` (new app):** name-first connect (§3/§6), local-passkey
  create + enroll redirect + `code` exchange, session persistence, header,
  org-creation (§7). Proxies `/a2a/*` → `demo-a2a-production`; own broker for
  `/connect/with-name`, `/connect/name-info`, `/connect/nonce`,
  `/connect/passkey-challenge`, `/me/*`, `/jwks`.
- **Config:** `CENTRAL_AUTH_ORIGIN` (= deployed demo-sso) in demo-org; demo-a2a
  origin/CSRF allowlist includes demo-org; `pnpm check:demo-org`.
- **Reuse, don't fork:** the connect/passkey/executeCall/claimName/relationship
  code is ported from `apps/demo-sso/src/connect-client.ts` (the hardened versions).

## 10. Phase plan (each independently demoable)

- **P1 — Return-visit auth on demo-org:** name-first connect with a local passkey
  already enrolled (manually add the custodian first) → on-chain custody session +
  persistence. Proves the runtime path with no central-auth dependency.
- **P2 — Enrollment via central auth:** demo-sso `/authorize` enroll + consent;
  demo-org first-visit redirect → `addPasskey` → `code` → signed in.
- **P3 — Org creation** (§7) on demo-org.
- **P4 — Issuer discovery behind a resolver seam** (drop the hardcoded
  `CENTRAL_AUTH_ORIGIN` scattered through relying-site code). Relying sites resolve via a
  single `resolveAuthOrigin(name)` and thread the result through the enrollment/org URL
  builders + the popup `postMessage` origin check (validation follows the *resolved* origin,
  not a module constant). Canonical mechanism = the `authOrigin` profile facet (§4); during
  the domain-deferred phase the seam returns the configured platform origin and the facet is
  NOT written (uniform value → a write would only burn scarce paymaster gas). **Done
  2026-05-27** (demo-org). No on-chain writes added.
- **P5 — `*.impact-agent.io` (the real domain; in progress 2026-05-27).** Each person's
  central auth is their own **single-label subdomain** `<handle>.impact-agent.io`, served by
  demo-sso (Pages) via a wildcard custom domain. **Subdomain-isolated ROOT passkey**: the
  WebAuthn RP ID is the serving host, so a passkey created at `<handle>.impact-agent.io` is
  bound to (and isolated to) that subdomain. **Signup happens AT the subdomain** — passkey
  signup/connect at the apex redirects to `<label>.impact-agent.io` and auto-resumes there
  (`src/lib/host.ts` + `App.tsx` `redirectForPasskey`/resume effects). The apex
  `impact-agent.io` is the platform landing + bootstrap origin.
  - **`resolveAuthOrigin` is name-derivation, NOT a facet read.** In this deployment the
    subdomain ⟺ name-label binding is canonical, so the home origin is a PURE function of the
    name (`<label>.impact-agent.io`) — one mechanism, no remote read (ADR-0013). Writing the
    `authOrigin` facet on-chain would need a profile-`register()` + an OntologyTermRegistry
    term for ZERO added information, so it is **not written**. The `authOrigin` predicate
    (`@agenticprimitives/agent-profile` `AUTH_ORIGIN`) is retained as the FUTURE override for
    self-hosted homes; when that lands, `resolveAuthOrigin` reads it first and falls back to
    name-derivation (still one mechanism + a pure default).
  - **The personal subdomain ALSO serves the agent's A2A endpoint** (`.well-known/agent-card.json`
    + `/api/a2a`) — one unified endpoint per agent. See **[spec 231](231-personal-subdomain-endpoint.md)**.
  ⚠️ The subdomain answers *where the ROOT passkey lives*, NOT *what a relying site may do*
  (that stays a scoped delegation — ADR-0019). A personal origin must never be used to
  justify making a relying site a custodian.

## 11. Open questions

1. ~~ADR-0019?~~ **RESOLVED** — [ADR-0019](../docs/architecture/decisions/0019-relying-site-authority-is-a-scoped-delegation.md)
   accepted 2026-05-26.
2. ~~Scoped delegation vs full custodian?~~ **RESOLVED — scoped delegation** (ADR-0019).
3. **Issuer facet shape** (ANS text record key vs profile field) — decide in P4.
4. **Multiple devices per site:** each device on the same site gets its own
   delegation to its own local key. Fine; just accrues delegations (each revocable).
5. **Caveat tuning per relying site** — the target/method/time caveats a relying
   site needs (e.g. demo-org needs factory + naming + relationship targets to create
   orgs). Decide the default caveat set in the P6 build.
6. ~~Who custodies agents a relying site creates (org/treasury)?~~ **RESOLVED — the
   person's ROOT passkey ONLY**, via the central-auth ceremony (decided 2026-05-26;
   §7, memory `project_demo_org_durable_org_custody`). Same pattern as the person SA;
   never the site passkey, never the person SA. Generalizes to any service agent.

## 12. Phase plan addendum (ADR-0019 delegation rewrite)

- **P6 — Relying-site auth becomes a scoped delegation (ADR-0019).** demo-sso server
  enrollment-grant endpoint (F1); enrollment issues a caveated delegation (ROOT
  passkey signs `hashDelegation`) instead of `addPasskey`; demo-org runtime auth =
  delegation-holding → scoped session (§6); on-behalf actions redeem via
  `DelegationManager.redeemDelegation`; regression test (relying-site delegate
  `isCustodian == false`; server rejects non-allowlisted `aud`/`redirect_uri`).
  Retires the `addPasskey`-custodian path for relying-site enrollment.
- **P7 — Created agents are ROOT-passkey-custodied via the central-auth ceremony**
  (decided 2026-05-26; §7). Org creation moves from a local demo-org deploy (site-passkey
  custodian) to a demo-sso popup ceremony (`createChildAgentForSite`): deploy custodied by
  the ROOT passkey ONLY → claim name → `person→HAS_GOVERNANCE_OVER→org` → mint a scoped
  `org→site-delegate` delegation. demo-org stores it; `readOrgData` presents it (no local
  signing). `createChildAgentForSite` is parameterized by relationship type so **any service
  agent (Treasury) reuses it**. Retires the local org deploy + the EOA co-custodian idea.

## 13. Out of scope

- Wallet/SIWE and Google paths on demo-org (name + passkey only here).
- Multi-custodian / threshold / CustodyPolicy orgs (simple mode-0 org only).
- On-chain `authOrigin` facet writes (P5 uses name-derivation; the facet is the
  future self-hosted-home override only).
