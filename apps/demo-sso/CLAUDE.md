# demo-sso — Claude guide

## What this app is

The **Agentic Connect SSO demo** (spec 224 / ADR-0014). One story end-to-end:

> Enroll one credential at the Connect origin, sign in across two relying sites
> (one-enroll SSO). The `AgentSession` is asymmetric + JWKS-verified, its subject
> is a CAIP-10 `CanonicalAgentId`, and it has no `owner`. Custody-class actions
> require step-up to a custody-grade credential.

It is the **capstone integration demo** for the SSO wave — it wires the real
packages together: `connect` (token + convergence + issuance) +
`identity-directory` (resolution: indexer proposes, on-chain confirms) +
`identity-directory-adapters` (the ports).

## Layout

```
apps/demo-sso/
├── index.html
├── vite.config.ts        ← dev server on :5373 (demo-web 5173, demo-web-pro 5273)
├── wrangler.toml         ← Pages config (KV binding for the auth-code store)
├── scripts/gen-broker-key.mjs   ← generate the ES256 broker key (a Pages secret)
├── functions/            ← the SERVER broker (Pages Functions; key from env)
│   ├── _lib/server-broker.ts    ← signer-from-env + directory + helpers
│   ├── jwks.ts                  ← GET  /jwks
│   ├── authorize.ts             ← POST /authorize  (→ single-use code; CN-1/9)
│   └── token.ts                 ← POST /token      (code → AgentSession)
└── src/
    ├── main.tsx
    ├── lib/broker-core.ts       ← shared directory + issuance/verify (signer injected)
    ├── broker.ts                ← in-browser demo broker (key in-page) over broker-core
    └── App.tsx                  ← Connect origin + 2 relying-site panels + step-up gate
```

Two broker variants share `src/lib/broker-core.ts`: the **in-browser** broker
(`src/broker.ts`, key generated in-page — runnable with no backend, used by the
UI) and the **server** broker (`functions/`, key from an env secret — the
production-correct shape). Same directory + issuance/verification logic.

## Server broker (Pages Functions)

```
GET  /jwks       → the broker's public JWKS (relying sites verify with this)
POST /authorize  { credential, aud, redirectUri? } → { status:'issued', code } | bootstrap | disambiguate | rejected
POST /token      { code, aud } → { agentSession }   (single-use code exchange; CN-1/9)
```

The signing key lives ONLY server-side (`BROKER_PRIVATE_JWK`); the browser sees
only the JWKS. **Local dev (no Cloudflare project needed):**

```bash
cp .dev.vars.example .dev.vars                        # then fill it in
node scripts/gen-broker-key.mjs                       # → BROKER_PRIVATE_JWK + kid for .dev.vars
pnpm --filter @agenticprimitives-demo/sso build
wrangler pages dev dist --kv AUTH_CODES               # :8788 — local KV; serves /jwks /authorize /token /oidc/*
```

`wrangler pages secret put` only works AFTER the project exists (deploy path) —
for local use `.dev.vars`. Full local-vs-deploy steps + the Google console config:
**`OIDC-SETUP.md`**.

## What it demonstrates

- **One-enroll SSO** — one sign-in issues an `aud`-bound session to both relying
  sites with the same `sub`.
- **Convergence** — `connect`'s `issueForResolution` (0 → bootstrap, 1 → issue,
  many → disambiguate).
- **Issuance gates** — the `onchain-confirmed` floor (CN-6) + the non-EVM gate (CN-8).
- **Asymmetric token + JWKS** — relying sites verify with the public key (CN-4).
- **Step-up** — a GitHub OIDC session is login-grade; a custody-class action
  (`credential-change`) is blocked until step-up to a custody-grade passkey
  (ADR-0017 / CN-2).

## Two paths: in-browser demo broker vs server broker

- **In-browser** (`src/broker.ts`, used by the UI): key generated in-page,
  credential verification simulated, on-chain membership an in-memory Set. Runs
  with no backend — the fast "see the flow" path.
- **Server** (`functions/`): the production-correct shape — key from a Pages
  secret, JWKS endpoint, single-use code exchange (CN-1/9). Real OIDC lands here
  (the client secret must be server-side). See `OIDC-SETUP.md`.

## UI modes

- **In-browser broker** (the sign-in buttons): simulated credential, key in-page —
  runs under plain `vite dev`, no backend.
- **Real Google OIDC** (the "Sign in with Google" panel, `src/server-client.ts`):
  redirects to the server broker (`/oidc/google/start` → Google → `/oidc/google/callback`
  → `?code` → `/token`), verified client-side against `/jwks`. Needs the app served
  by the Pages Function broker (`wrangler pages dev dist` / deploy) with the Google
  secrets set (`OIDC-SETUP.md`).

## Next (not yet built)

- Real on-chain `confirmsCredential` (viem `readContract` against the deployed
  custody contract, replacing the in-memory membership Set); provision the KV ids +
  `BROKER_PRIVATE_JWK`/`GOOGLE_*` secrets + a deploy.

## Doctrine pinned to this app

- **Broker, not embedded** (ADR-0014): the credential ceremony belongs at the
  Connect origin, not each relying site.
- **No-owner `AgentSession`, CAIP-10 subject** (ADR-0016): never add an owner;
  the subject is always the canonical agent id.
- **OIDC = login facet, not custody** (ADR-0017): a login-grade session
  authorizes no custody-class action without step-up.

## Running

```bash
pnpm --filter @agenticprimitives-demo/sso dev   # :5373
```

## Generated files (ignore)

`dist/`, `node_modules/`, `.wrangler/`.
