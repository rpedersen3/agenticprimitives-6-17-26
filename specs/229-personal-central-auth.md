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
  the person's own origin (`<handle>.agentictrust.io`, the same subdomain that
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

- **Now:** the central auth is a single configured origin (the deployed
  `demo-sso`). Relying sites read it from build config (`CENTRAL_AUTH_ORIGIN`).
- **Target:** the issuer is the person's subdomain, derived from the ANS label
  (`rpedersen.agent` → `https://rpedersen.agentictrust.io`) **or** read from an
  **on-chain issuer facet** (an ANS text record / profile field the agent
  declares). Resolution is a single read — name → issuer; no fallback chain.

The migration `single configured origin → per-person subdomain` changes only this
resolver + deployment topology; the protocol in §5 is unchanged.

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
   fingerprint: *"Add a new sign-in key for **demo-org** to rpedersen.agent? This
   key will be able to act as you on this agent."* (See §8 — a per-site passkey is
   a **full custodian**; that authority MUST be disclosed.)
4. On approval, submit `execute(self, addPasskey(enroll_digest, enroll_x,
   enroll_y))` signed by the primary credential, via the hardened nonce-gated
   path (reuse `addPasskeyCredential` / `executeCall`). Idempotent if already a
   custodian (`PasskeyAlreadyRegistered` → treat as success).
5. Mint a single-use `code` bound to `{ aud, sub, redirect_uri }` (120 s TTL) and
   `302` back to `redirect_uri?code=…&state=…`.

`POST /token { code, aud }` → `{ agentSession }` (existing; single-use, aud-checked).
`GET /jwks` verifies it (existing). `state`/PKCE/nonce + single-use code reuse the
existing CN-1/CN-9 handling.

## 6. Relying-site (`demo-org`) auth, both paths — one mechanism each

- **Has a local passkey for this agent (return):** challenge → local passkey
  assert → `POST /connect/with-name` (relying site's own broker) → verify
  `isCustodian` on-chain → custody-grade `AgentSession` (`aud=demo-org`). The
  central auth is **not** contacted.
- **No local passkey (first visit):** §5 enrollment, then store the local passkey.
- **Session persistence:** the localStorage + TTL pattern from demo-sso (own
  origin). "Already connected → come right in." `signOut` clears it.

There is exactly ONE auth path per state; "no local passkey" is an answer that
triggers enrollment, never a silent fallback to a weaker check (ADR-0013).

## 7. `demo-org` as the first relying site (deliverable)

`apps/demo-org` (separate origin) demonstrates the model + an org-creation feature
(folds the earlier demo-org ask):

- **Header** (upper-right): signed-out → **Sign in / Sign up**; signed-in →
  `rpedersen.agent` with a menu (view agent, copy address, sign out).
- **Connect** = §3/§6 (name-first; no Google; no SIWE required).
- **Create organization:** type an org name → `/connect/name-info` uniqueness
  gate → deploy a **simple (mode-0) AgentAccount custodied by the connected local
  passkey** (salt from credential + `org` scope + entropy — **never the name**,
  ADR-0010) → claim the org name (batched register + setPrimary, nonce-gated) →
  **person `HAS_GOVERNANCE_OVER` org** edge (propose from person SA, confirm from
  org SA). Progress modal; then a "My organizations" list.

## 8. Security considerations

1. **A per-site passkey is a FULL custodian** (can sign any `execute`, add/remove
   custodians). Enrolling a site grants its local key full agent authority. For
   this demo that is acceptable and disclosed in the consent (§5.3). **Future
   hardening (out of scope, flag for ADR/spec):** relying sites should receive a
   **scoped delegation / session key**, not full custody — the central auth would
   mint a caveated delegation instead of `addPasskey`.
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
6. **Revocation:** removing a site = `removePasskey` of that site's custodian
   (custody-grade, signed by any remaining custodian). The "must leave at least
   one signer" invariant holds.

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
- **P4 — Issuer from name / on-chain facet** (drop the hardcoded
  `CENTRAL_AUTH_ORIGIN`).
- **P5 (future) — `*.agentictrust.io`:** wildcard Worker, per-person subdomain RP,
  per-person primary passkey. Deployment-topology only.

## 11. Open questions

1. **ADR-0019?** The personal-central-auth + per-site-enrollment pattern is new
   doctrine; likely warrants an ADR once P2 validates it. Write after P2.
2. **Scoped delegation vs full custodian** for relying sites (§8.1) — defer, but
   decide before any non-demo use.
3. **Issuer facet shape** (ANS text record key vs profile field) — decide in P4.
4. **Multiple devices per site:** each device on the same site enrolls its own
   passkey (another custodian). Fine; just accrues custodians. Confirm UX.

## 12. Out of scope

- Wallet/SIWE and Google paths on demo-org (name + passkey only here).
- Multi-custodian / threshold / CustodyPolicy orgs (simple mode-0 org only).
- Scoped delegations for relying sites (§8.1).
- The real `agentictrust.io` domain + wildcard Worker (P5).
