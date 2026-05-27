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

**Target ([ADR-0019](../../docs/architecture/decisions/0019-relying-site-authority-is-a-scoped-delegation.md)):**
a relying-site key is a **scoped ERC-7710 delegate** of the person SA, NOT a
custodian. Runtime auth = "holds a live, unrevoked, in-window delegation" → a
**scoped (login-grade) session**; on-behalf actions redeem the delegation. This is
the spec-229 **P6** build (server enrollment-grant endpoint + issue/verify/redeem).

**Currently implemented (pre-P6 — being retired):** enrollment uses
`addPasskey` (the site key becomes a custodian) and `/connect/with-name` verifies
`isCustodian` → session. The full-authority grant is disclosed in consent until P6.

- **Cross-origin enrollment:** popup-first (`src/lib/central-auth.ts`) with redirect
  fallback; origin/source/state validated (audit F3/F5).
- **Sign up here:** passkey signup is homed at the central auth; wallet signup local.
- Session persists (localStorage + JWT `exp`), restored synchronously.

## Org creation

`createOrg`: deploy mode-0 AgentAccount custodied by the connected credential
(salt = credential scope + entropy, **never the name** — ADR-0010) → claim name
(nonce-gated batch) → `person --HAS_GOVERNANCE_OVER--> org` (propose+confirm).

## Running / deploy

```bash
pnpm --filter @agenticprimitives-demo/org dev      # :5473 (proxies /a2a → demo-a2a)
pnpm --filter @agenticprimitives-demo/org build
wrangler pages deploy dist                          # set BROKER_PRIVATE_JWK, BROKER_KID, DEMO_A2A_URL
```

KV `AUTH_CODES` (own namespace) holds single-use nonces/challenges.

## Generated files (ignore)

`dist/`, `node_modules/`, `.wrangler/`.
