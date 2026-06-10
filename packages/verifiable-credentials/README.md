# @agenticprimitives/verifiable-credentials

**A credential is only as durable as the identity it points at.** Most verifiable-credential stacks bind claims to a key — and when the key rotates, the trust graph quietly breaks. Here the issuer and subject of every credential is a Smart Agent address: a persistent ERC-4337 account whose keys are replaceable facets. Rotate a passkey, recover from a lost device, swap a signer — the address persists, and every credential issued by or about it stays verifiable.

This package is the W3C VC 2.0 envelope for that model: an `Eip712Signature2026` proof signed by a smart account and verified with an ERC-1271 round-trip against the chain, plus the RFC 8785 (JCS) canonical hash that every downstream registry stores as the on-chain anchor. It is the substrate layer — specific credential types (associations, agreements, evidence, outcomes, receipts) are composed on top by consumer packages.

> Part of [agenticprimitives](../../README.md) — the trust substrate for the agent economy: one canonical Smart Agent identity with custody, delegation, naming, credentials, and audit evidence designed as one system.

## What ships today

- **W3C VC 2.0 envelope** — `@context`, `type`, `issuer`, `validFrom`, `credentialSubject`, `proof`, `credentialStatus` (`VerifiableCredential`, `UnsignedCredential` types).
- **`Eip712Signature2026` proof** — `signCredential(unsigned, signer)` produces the proof; `eip712Digest(...)` matches the Solidity verifier byte-for-byte (cross-stack typehash equality, CI-gated per spec 242 §4.3).
- **Verifier** — `verifyCredential(vc, client)` runs structural checks, recomputes the digest, and verifies the issuer signature via ERC-1271 against the issuer's Smart Agent. One mechanism, no silent fallbacks ([ADR-0013](../../docs/architecture/decisions/0013-no-silent-fallbacks.md)). `verifyCredentialStructural(vc)` is the offline subset.
- **Canonical hash** — `credentialHash(vc)` / `canonicalHash(...)` / `jcsCanonicalize(...)`: the RFC 8785 JCS hash used as the credential anchor everywhere downstream (attestation registries, vault indexes, status lists).
- **DOLCE+DnS Situation pattern** — `buildSituation(...)` and the `Situation` / `DescriptionRef` / `RoleName` shapes that all substrate credential subjects compose against.
- **Schema URIs** — `buildShapeUri` / `parseShapeUri` / `shapeHash` for the `did:shape:<name>:<version>` convention that pairs with the on-chain `ShapeRegistry`.

```ts
import { credentialHash, verifyCredential } from '@agenticprimitives/verifiable-credentials';

const anchor = credentialHash(vc);                 // RFC 8785 JCS hash — what registries store
const result = await verifyCredential(vc, client); // ERC-1271 round-trip against the issuer Smart Agent
```

## How it's different

Veramo, Trinsic, and the broader W3C VC tooling ecosystem resolve issuers through DID methods and key registries — so credential validity is coupled to key material. Here the issuer is a CAIP-10 smart-account address and verification is ERC-1271 against the chain: **keys rotate, the address persists, credentials survive recovery** ([ADR-0011](../../docs/architecture/decisions/0011-credential-recovery-and-re-association.md)). And because the EIP-712 digest is locked to its Solidity counterpart by a CI gate, the contracts and the SDK are one artifact — the client cannot drift from the chain, which is precisely where stitched VC stacks decay.

The package is deliberately a leaf: it imports only `types`, `ontology`, `viem`, and `@noble/hashes`, and defines no specific credential types — `attestations`, `agreements`, `fulfillment`, and `payments` own those.

## Status

**W1 foundational — implemented and security-load-bearing.** The envelope, proof, canonical hash, and verifier ship today and are exercised by downstream packages; verifier findings VC-1/VC-2 are closed (see [AUDIT.md](./AUDIT.md)). Alternative proof types (BBS+ / SD-JWT / AnonCreds) have a reserved envelope slot and land in later waves per the [W1 implementation wave plan](../../docs/architecture/w1-implementation-wave-plan.md).

> Testnet/pilot-ready. Production launch is gated on the public checklist in the root README — including third-party contract audit and governance key rotation. Track every security finding live in [`docs/audits/findings.yaml`](../../docs/audits/findings.yaml).

**Authoritative spec:** [`specs/242-trust-credentials-and-public-assertions.md`](../../specs/242-trust-credentials-and-public-assertions.md) §4 — see `spec.md` for the symlink. Bounded surface: `CLAUDE.md` + `capability.manifest.json`.

## Build

```bash
pnpm --filter @agenticprimitives/verifiable-credentials typecheck
pnpm --filter @agenticprimitives/verifiable-credentials test
pnpm --filter @agenticprimitives/verifiable-credentials build
```
