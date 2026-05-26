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

- **Return visit:** name → local passkey/SIWE → `/connect/with-name` verifies
  `isCustodian` on-chain → `aud='demo-org'` AgentSession. Session persists
  (localStorage + JWT `exp`); restored synchronously on load.
- **Sign up here:** new agent (local passkey or wallet) + claim name.
- **Cross-origin passkey** (a demo-sso agent on this origin) needs P2
  central-auth enrollment — NOT built yet (use a wallet-secured agent for now).

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
