# @agenticprimitives/attestations

**Agent reputation needs public, revocable claims pinned to a persistent identity — not to a key that rotates away.** When an agent's track record lives on chain, three things must be true: the subject is an address that survives credential recovery, the claim cannot be anchored against a different subject by replaying a signature, and a "joint" claim genuinely carries both parties' consent. This package is the SDK for `AttestationRegistry.sol`, the single on-chain registry where those guarantees are enforced — bilateral consent is verified on chain from both party signatures, not assumed from a stored reference.

It is EAS-aligned where alignment helps (UID model, schema IDs, refUID chaining) and deliberately stricter where EAS is loose: one registry, credential types as discriminators rather than per-type contracts, and no issuer-unilateral revocation entrypoint at all.

> Part of [agenticprimitives](../../README.md) — the trust substrate for the agent economy: one canonical Smart Agent identity with custody, delegation, naming, credentials, and audit evidence designed as one system.

## What ships today

The W1 foundational slice — the cryptographic spine the contract and downstream packages already rely on:

- **`CREDENTIAL_TYPE`** — keccak discriminators for `Association`, `Evidence`, `Outcome`, `Validation`, `TrustUpdate`, `JointAgreement`, `PaymentReceipt` (one registry, many types — [ADR-0024](../../docs/architecture/decisions/0024-intent-coordination-substrate.md) Decision 2).
- **`computeAttestationUid(...)`** — recomputes the on-chain UID per `AttestationRegistry._computeUid`.
- **`JOINT_CONSENT_TYPEHASH` + `jointConsentDigest(...)`** — the digest BOTH parties sign to consent to a joint agreement. `assertJointAgreement` recomputes it on chain and verifies both signatures (ERC-1271 / ECDSA); a stored consent reference is not consent (RW1-1, [ADR-0027](../../docs/architecture/decisions/0027-canonical-authority-binding.md)). `chainId` and the registry address are bound, so consent cannot be replayed cross-chain (ATT-3).
- **`JOINT_ISSUER_TYPEHASH` + `jointIssuerDigest(...)`** — the issuer signs parties, schema, credential type/hash, agreement commitment, chain, and registry — never a bare hash (ATT-1).
- **`ASSOCIATION_ATTESTATION_TYPEHASH` + `associationAttestationDigest(...)`** — binds the subject, so a known credential hash cannot be anchored against someone else (SC-2).
- **Request payload shapes** — `AssociationAttestationRequest`, `JointAgreementAttestationRequest`, matching the contract ABI.

Every typehash above MUST byte-equal its `AttestationRegistry.sol` constant — enforced by the cross-stack `check:eip712-typehash-equality` CI gate.

Planned for later waves per the [W1 implementation wave plan](../../docs/architecture/w1-implementation-wave-plan.md): assertion builders (`buildAssociationAssertion`, `buildJointAgreementAssertion`), the `AttestationClient` read client, and revocation encoders (holder-only / either-party / validator-only per type).

## How it's different

Against EAS and Verax, three concrete deltas:

1. **Contracts and SDK are one artifact.** The EIP-712 typehashes in this package are CI-locked to the Solidity constants. In EAS-style stacks the client SDK and the chain are separate codebases that drift; here drift fails the build.
2. **Bilateral consent is verified, not asserted.** A joint attestation requires both parties' signatures over a digest the contract recomputes. There is no resolver/module hook where consent semantics can be customized away ([ADR-0023](../../docs/architecture/decisions/0023-attestation-registry-eas-aligned-bilateral-consent.md), D2).
3. **No `issuerRevoke`.** Holders revoke their own associations; joint agreements revoke by either party; issuer revocation is off-chain via StatusList2021 (D-18). An issuer cannot unilaterally erase a subject's record.

The credential bodies themselves are W3C VCs from [`verifiable-credentials`](../verifiable-credentials) (type-only dependency); only their canonical hashes touch the chain. Vault-resident bodies stay private unless explicitly opted into public assertion (D-46).

## Status

**Foundational (W1) — code shipped; not production enforcement.** The digest math, typehashes, and payload shapes above are real and gate-checked; the full builder/client surface lands in Wave 4 per the [wave plan](../../docs/architecture/w1-implementation-wave-plan.md). See [AUDIT.md](./AUDIT.md).

> Testnet/pilot-ready. Production launch is gated on the public checklist in the root README — including third-party contract audit and governance key rotation. Track every security finding live in [`docs/audits/findings.yaml`](../../docs/audits/findings.yaml).

**Owns spine layers:** 12–15.
**Authoritative spec:** [`specs/242-trust-credentials-and-public-assertions.md`](../../specs/242-trust-credentials-and-public-assertions.md) — see `spec.md` for the symlink. Bounded surface: `CLAUDE.md` + `capability.manifest.json`.

## Build

```bash
pnpm --filter @agenticprimitives/attestations typecheck
pnpm --filter @agenticprimitives/attestations test
pnpm --filter @agenticprimitives/attestations build
```
