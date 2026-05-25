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
└── src/
    ├── main.tsx
    ├── broker.ts          ← the integration core: wires connect + directory + adapters
    └── App.tsx            ← Connect origin + 2 relying-site panels + step-up gate
```

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

## Demo simplifications (honest about them)

- **The broker key is generated in-browser** so the demo is self-contained. In
  production it lives server-side at the Connect origin (a Cloudflare Pages
  Function / Worker); the browser only ever sees the JWKS. The `src/broker.ts`
  header says so.
- **Credential verification is simulated** (passkey/OIDC) and the on-chain
  membership is an in-memory Set. `connect-auth` owns the real ceremonies and
  the adapters wrap real `agent-naming` + `readContract`; this demo's focus is
  the SSO flow + package integration + the security gates, not re-proving
  passkey/OIDC (connect-auth tests those).

## Next (not yet built)

- A Pages Function broker (real server-side key + JWKS endpoint + the §4a
  redirect/code-exchange flow), real GitHub OIDC token exchange (needs the
  client secret server-side), real on-chain `confirmsCredential`, and a deploy.

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
