# @agenticprimitives-demo/sso

The **Agentic Connect SSO demo** — enroll one credential at the Connect origin,
sign in across two relying sites (one-enroll SSO), with a step-up gate for
custody-class actions. The capstone integration demo for the SSO wave
([spec 224](../../specs/224-agentic-connect.md) / [ADR-0014](../../docs/architecture/decisions/0014-connect-is-an-sso-broker.md)).

```bash
pnpm --filter @agenticprimitives-demo/sso dev   # http://localhost:5373
```

## What you'll see

1. The **Connect origin** starts a broker (asymmetric signing key, ES256; JWKS published).
2. **Sign in once** — Alice passkey, Alice GitHub (OIDC), or Bob passkey.
3. **Both relying sites** (Shop, Forum) receive an `aud`-bound `AgentSession` with
   the **same `sub`** (the canonical agent) — verified against the JWKS.
4. **Attempt a custody-class action** (rotate credential): allowed for a passkey
   (custody-grade) session, **blocked → step-up** for a GitHub OIDC (login-grade) one.

## How it's wired

`src/broker.ts` composes the real packages:

- [`@agenticprimitives/connect`](../../packages/connect) — `generateBrokerKeypair`,
  `issueForResolution` (convergence + issuance gates), `verifyAgentSession`,
  `publishJwks`/`importJwks`, `requiresStepUp`.
- [`@agenticprimitives/identity-directory`](../../packages/identity-directory) —
  `createDirectory` (indexer proposes, on-chain confirms).
- [`@agenticprimitives/identity-directory-adapters`](../../packages/identity-directory-adapters) —
  `makeNamingPort` / `makeOnChainReadPort` / `createInMemoryIndexer`.

## Demo simplifications

The broker key is generated in-browser and credential verification is simulated
(see `src/broker.ts` + `CLAUDE.md`) — production puts the key in a server-side
Pages Function/Worker and uses connect-auth's real ceremonies + on-chain reads.
The focus here is the SSO flow, package integration, and the security gates.
