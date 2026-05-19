# @agenticprimitives/identity-auth

User authentication (passkey + SIWE + Google OAuth), JWT sessions, and pluggable `Signer` interfaces consumed by `@agenticprimitives/agent-account` and `@agenticprimitives/delegation`.

This is the Privy-style abstraction without the Privy dependency. See [`spec.md`](./spec.md) → [`specs/200-identity-auth.md`](../../specs/200-identity-auth.md) for the full contract.

## Install

```bash
pnpm add @agenticprimitives/identity-auth
```

## Quick start

```ts
import { mintSession, verifySession } from '@agenticprimitives/identity-auth';
import * as passkey from '@agenticprimitives/identity-auth/passkey';

// In your /api/auth/passkey-signup handler:
const { sessionClaims } = await passkey.completeSignup(req);
const cookieValue = mintSession(sessionClaims);
// consumer sets the cookie via their framework
```

## Auth methods (tree-shakable)

- `@agenticprimitives/identity-auth/passkey` — WebAuthn signup/login
- `@agenticprimitives/identity-auth/siwe` — Sign-In with Ethereum
- `@agenticprimitives/identity-auth/google` — OAuth via Google IdP

Importing one does not pull the others.

## Signer interfaces

This package's most important architectural commitment: a single `Signer` interface (specialized as `PasskeySigner` / `EOASigner` / `KMSSigner`) that downstream packages consume without knowing how the user signs.

```ts
import type { Signer, KMSSigner } from '@agenticprimitives/identity-auth';
// Concrete KMSSigner instances come from @agenticprimitives/key-custody
```

## Status

Pre-alpha. Spec stable.
