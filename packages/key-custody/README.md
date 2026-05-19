# @agenticprimitives/key-custody

Pluggable envelope encryption + signers + HMAC providers. Local-AES (dev only), AWS KMS, GCP KMS in v0.

**Narrower than you might expect:** session lifecycle is owned by `@agenticprimitives/delegation`. This package provides the crypto primitives; delegation's `SessionManager` wires them into the lifecycle.

See [`spec.md`](./spec.md) → [`specs/203-key-custody.md`](../../specs/203-key-custody.md).

## Quick start

```ts
import { buildKeyProvider, createKmsAccount, canonicalContextBytes } from '@agenticprimitives/key-custody';

const provider = buildKeyProvider({ backend: process.env.A2A_KMS_BACKEND });

// Generate a wrapped data key for envelope encryption
const { plaintextDataKey, encryptedDataKey, keyId, keyVersion } =
  await provider.generateSessionDataKey({ aadContext: { /* caller-supplied */ } });

// Sign as a viem-compatible signer
const signer = buildSignerBackend({ backend: 'aws-kms' });
const kmsAccount = await createKmsAccount(signer);
```

## Production guard

`local-aes` refuses to boot when `NODE_ENV=production`. AWS and GCP backends have **no local fallback** — they fail-closed on outage. This is intentional.

## Status

Pre-alpha. Spec stable.
