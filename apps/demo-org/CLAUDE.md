# demo-org — Claude guide

## What this app is

An **SSO relying site** (spec 229). You sign in by **agent name** (passkey or
SIWE) to the **same canonical person agent** you use elsewhere, then create a
named **Organization Smart Agent** custodied by your credential and linked
`you → HAS_GOVERNANCE_OVER → org` on-chain (Base Sepolia, chain 84532).

Doctrine: name = universal username; passkeys are per-origin; runtime auth is
**on-chain custody** (not a central IdP) — see [spec 229](../../specs/229-personal-central-auth.md)
+ memory `project_personal_central_auth`.

## Layout

```
functions/
  _lib/server-broker.ts     ← signer (ES256) + jwks; no directory/OIDC
  connect/{nonce,passkey-challenge,name,name-info,with-name,siwe,passkey}.ts
  jwks.ts · a2a/[[path]].ts ← proxy → demo-a2a (DEMO_A2A_URL)
src/
  App.tsx                   ← header + name-first connect/sign-up + create-org
  connect-client.ts         ← siwe/passkey login, claimName, executeCall, createOrg
  lib/{chain,passkey,wallet}.ts · csrf.ts
```

Ported from demo-sso's **hardened** connect path (nonce-gated `executeCall`,
batched `claimName`). No Google, no PII/`/me`, no directory.

## Auth model

**Live model — [ADR-0019](../../docs/architecture/decisions/0019-relying-site-authority-is-a-scoped-delegation.md) / spec-229 P6:**
a relying-site passkey is a **scoped ERC-7710 delegate** of the person SA, NOT a
custodian. Enrollment at the central auth issues a caveated `person → site-delegate-SA`
delegation (time-boxed, `value 0`, targets limited to naming + relationship — see
`apps/demo-sso/src/lib/delegation.ts`). Runtime auth = "holds a live, unrevoked,
in-window delegation" → a **login-grade** session; on-behalf actions redeem the
delegation. No `addPasskey`, no custodian slot — the person can revoke at the
DelegationManager and the SA address never changes.

- **Passkey path** → `connectWithDelegation` → `/connect/with-delegation`: verifies
  `delegator == person`, `isValidSignature`, not revoked, in-window. Does NOT check
  `isCustodian`. (`src/connect-client.ts`, `functions/connect/with-delegation.ts`.)
- **Wallet/SIWE path** → `connectWithName` → `/connect/with-name`: the EOA IS the
  person's own custodian; the site holds no standing credential and you sign each
  on-behalf action with your wallet directly.
- **Cross-origin enrollment:** popup-first (`src/lib/central-auth.ts`) with redirect
  fallback; origin/source/state validated (audit F3/F5).
- **Sign up here:** passkey signup is homed at the central auth; wallet signup local.
- Session persists (localStorage + JWT `exp`), restored synchronously.

## Org / service-agent creation (central-auth ceremony)

EVERY agent created here (org now; any service agent e.g. Treasury later) is
custodied by **the person's ROOT passkey at demo-sso** — same pattern as the
person SA — NEVER this site's passkey, NEVER the person SA (memory
`project_demo_org_durable_org_custody`). `startOrgCreation` only builds the
central-auth URL; the demo-sso popup runs the ceremony
(`createChildAgentForSite`): deploy mode-0 AgentAccount custodied by the ROOT
passkey (salt = scope + entropy, **never the name** — ADR-0010) → claim name →
`person --HAS_GOVERNANCE_OVER--> org` (propose+confirm, ROOT signs) → mint a
scoped `org → this-site's-delegate-SA` delegation → return it. demo-org stores
the org + its delegation; **`readOrgData` presents that stored delegation**
(requester = delegate), like `readPersonData`. Needs the stored person→site
delegation (for the delegate SA) → passkey setup required to create orgs.

## Running / deploy

```bash
pnpm --filter @agenticprimitives-demo/org dev      # :5473 (proxies /a2a → demo-a2a)
pnpm --filter @agenticprimitives-demo/org build
wrangler pages deploy dist                          # set BROKER_PRIVATE_JWK, BROKER_KID, DEMO_A2A_URL
```

KV `AUTH_CODES` (own namespace) holds single-use nonces/challenges.

## Generated files (ignore)

`dist/`, `node_modules/`, `.wrangler/`.
