# @agenticprimitives/kms

Pluggable envelope-encryption + signer abstraction for agent session keys. Local AES (dev only), AWS KMS, and GCP KMS in v0.

See [`spec.md`](./spec.md) for the full contract.

## Quick start

```ts
import { buildKeyProvider, encryptSessionPackage, decryptSessionPackage } from '@agenticprimitives/kms';

const provider = buildKeyProvider({ backend: process.env.A2A_KMS_BACKEND });

const row = await encryptSessionPackage(
  { sessionPrivateKey, delegation },
  { sessionId, accountAddress, chainId, expiresAt },
  provider,
);
```

## Production guard

`local-aes` refuses to boot when `NODE_ENV=production`. AWS and GCP backends have **no local fallback** — they fail-closed on outage. This is intentional.

## Status

Pre-alpha. Spec stable.
