# @agenticprimitives/key-custody

**Custody is not authority.**

In this stack, keys sign — they do not decide. Authority lives in delegations and custody policy; this package is the cryptographic floor underneath them: pluggable envelope encryption, KMS-backed signers, and HMAC providers behind one `A2AKeyProvider` interface. Local-AES and a local secp256k1 signer for development, AWS KMS and GCP KMS for real deployments. Because a signer here is just a signer, a compromised session key is a revocation event, not an identity loss — the Smart Agent address and its custody policy sit above the key, not inside it.

**Narrower than you might expect, on purpose:** session lifecycle is owned by `@agenticprimitives/delegation`. This package provides the crypto primitives; delegation's `SessionManager` wires them ([ADR-0002](../../docs/architecture/decisions/0002-session-lifecycle-in-delegation.md)). Payloads are opaque bytes with caller-supplied AAD — bound identically into AES-GCM AAD and KMS EncryptionContext, so tampering trips both.

> Part of [agenticprimitives](../../README.md) — the trust substrate for the agent economy: one canonical Smart Agent identity with custody, delegation, naming, credentials, and audit evidence designed as one system.

See [`spec.md`](./spec.md) → [`specs/203-key-custody.md`](../../specs/203-key-custody.md).

## Quick start

```ts
import { buildKeyProvider, buildSignerBackend, createKmsAccount, canonicalContextBytes } from '@agenticprimitives/key-custody';

const provider = buildKeyProvider({ backend: process.env.A2A_KMS_BACKEND });

// Generate a wrapped data key for envelope encryption
const { plaintextDataKey, encryptedDataKey, keyId, keyVersion } =
  await provider.generateSessionDataKey({ aadContext: { /* caller-supplied */ } });

// Sign as a viem-compatible signer
const signer = buildSignerBackend({ backend: 'aws-kms' });
const kmsAccount = await createKmsAccount(signer);
```

Beyond the basics: per-OIDC-subject signer derivation via HKDF (`deriveSubjectSigner`, [spec 235](../../specs/235-google-kms-custody.md)), a relay-only master signer that throws on any signing call (`getRelayOnlySigner`), and HMAC providers under the `/mac` subpath. Every decrypt and signing operation emits an audit row with `keyVersion` and a hashed session ID — the raw session ID is never logged.

## Production guard

`local-aes` refuses to boot when `NODE_ENV=production`. AWS and GCP backends have **no local fallback** — they fail-closed on outage. This is intentional: a key-custody layer that silently downgrades to a weaker backend is not a custody layer.

## How it's different

Turnkey and Fireblocks are strong custody products: managed key infrastructure with their own policy engines, consoles, and trust models. They are also where your authority model ends up living — the policy that governs a key is the vendor's policy, expressed in the vendor's terms. This package takes the opposite position: KMS backends are interchangeable plumbing (`buildKeyProvider({ backend })`), and the authority model lives one layer up, in on-chain custody policy and EIP-712 delegations that the rest of the substrate enforces and audits. You keep cloud-KMS-grade key protection without making a vendor's policy engine your source of truth for who may do what.

## Validate

```bash
pnpm --filter @agenticprimitives/key-custody typecheck
pnpm --filter @agenticprimitives/key-custody test
```

## Status

Testnet/pilot-ready. Production launch is gated on the public checklist in the root README — including third-party contract audit and governance key rotation. Track every security finding live in [`docs/audits/findings.yaml`](../../docs/audits/findings.yaml).
