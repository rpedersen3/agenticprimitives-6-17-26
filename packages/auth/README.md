# @agenticprimitives/auth

Privy-style user auth + deterministic ERC-4337 smart account initiation.

See [`spec.md`](./spec.md) for the full contract.

## Install

```bash
pnpm add @agenticprimitives/auth
```

## Quick start

```ts
import { mintSession, verifySession, AgentAccountClient } from '@agenticprimitives/auth';
import * as passkey from '@agenticprimitives/auth/passkey';

const account = new AgentAccountClient({
  rpcUrl: process.env.RPC_URL!,
  chainId: Number(process.env.NEXT_PUBLIC_CHAIN_ID),
  entryPoint: process.env.ENTRYPOINT_ADDRESS as `0x${string}`,
  factory: process.env.AGENT_FACTORY_ADDRESS as `0x${string}`,
});

// In your /api/auth/passkey-signup handler:
const { sessionClaims, smartAccountAddress } = await passkey.completeSignup(req);
const cookieValue = mintSession(sessionClaims);
```

## Auth methods

- `@agenticprimitives/auth/passkey` — WebAuthn signup/login, deterministic salt from label
- `@agenticprimitives/auth/siwe` — Sign-In with Ethereum, EOA-as-owner
- `@agenticprimitives/auth/google` — OAuth via Google IdP, relayer-signer model

Each is tree-shakable; importing one does not pull the others.

## Status

Pre-alpha. Spec stable; implementation lands incrementally.
