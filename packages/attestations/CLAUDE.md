# @agenticprimitives/attestations — Claude guide

> **Status:** STUB (Wave 0.5). Full implementation in Wave 4 per [w1-implementation-wave-plan.md](../../docs/architecture/w1-implementation-wave-plan.md).

## What this package owns

- **`AttestationRegistry.sol` SDK** — encoder/decoder + read client + ABI mirror for the contract specified in [ADR-0023](../../docs/architecture/decisions/0023-attestation-registry-eas-aligned-bilateral-consent.md).
- **Credential-type taxonomy for layers 12–15** — `AssociationCredential`, `EvidenceCredential`, `OutcomeCredential`, `ValidationCredential`, `TrustUpdate`. Per ADR-0024 Decision 2: these are credential TYPES discriminated by `credentialType`, NOT separate contracts. Architectural inverse of the smart-contract-per-credential anti-pattern.
- **Bilateral-consent helpers** — `CalldataHashEnforcer`-pinned delegation builder for joint-agreement assertions (delegation-as-authorization-predicate pattern; uses `DelegationManager.verifyAuthorization(...)` extension from spec 242 PD-9).
- **Revocation encoders** — holder-only for `Association` / `Evidence` / `Outcome`; either-party for `JointAgreement`; validator-only for `Validation` / `TrustUpdate`. **NO** `issuerRevoke` entrypoint (D-18 + AR-10).
- **EIP-712 typed-data shapes** for all assertion variants.

## What this package does NOT own

- **The `Eip712Signature2026` envelope itself** — that's `verifiable-credentials`. This package depends type-only.
- **The `AgreementCredential` shape** — that's `agreements` per PD-22.
- **Bilateral-consent semantics for ANY non-attestation use** — delegation-as-predicate via `verifyAuthorization` is consumed here but lives in the `delegation` package.

## Read these first

1. [`spec.md`](./spec.md) → [`specs/242-trust-credentials-and-public-assertions.md`](../../specs/242-trust-credentials-and-public-assertions.md)
2. [ADR-0023](../../docs/architecture/decisions/0023-attestation-registry-eas-aligned-bilateral-consent.md) — locked contract surface
3. [`coordination-substrate.md`](../../docs/architecture/coordination-substrate.md) §6 (the composability table — layers 12–15)
4. [`privacy-and-self-sovereign-identity.md`](../../docs/architecture/privacy-and-self-sovereign-identity.md) D-46 (vault residency)

## Stable public exports (planned)

`buildAssociationAssertion`, `buildJointAgreementAssertion`, `revokeOwnAssociation`, `revokeOwnJointAgreement`, `JOINT_CONSENT_TYPEHASH`, `jointConsentDigest`, `AttestationClient.getAttestation`, `AttestationClient.isValid`, `AssociationCredential`, `EvidenceCredential`, `OutcomeCredential`, `ValidationCredential`, `TrustUpdate` (credential class types).

> RW1-1 (ADR-0027): `assertJointAgreement` VERIFIES bilateral consent on-chain —
> it recomputes `jointConsentDigest(party1, party2, agreementCommitment,
> credentialHash)` and requires BOTH party signatures over it (`party1Signature`,
> `party2Signature` on the request; ERC-1271 / ECDSA). `bilateralConsentRef` is
> ignored (pass `bytes32(0)`). The cross-stack `check:eip712-typehash-equality`
> gate locks `JOINT_CONSENT_TYPEHASH` to `AttestationRegistry.sol`.

## Allowed imports

- `@agenticprimitives/types`, `@agenticprimitives/verifiable-credentials` (type-only), `@agenticprimitives/delegation` (type-only — for bilateral-consent payload construction), `@agenticprimitives/ontology` (IRI constants)
- `viem`

## Forbidden imports

- Runtime call into `delegation` (type-only edge only — runtime call goes through the SA's userOp execution path)
- `apps/*`
- Vertical vocabulary

## Drift triggers — STOP and route

- "Add an `issuerRevoke(...)` entrypoint" — **STOP.** D-18 + ADR-0023 (D4). Issuer revocation is off-chain via StatusList2021.
- "Add a Resolver / Module hook (EAS / Verax pattern)" — **STOP.** ADR-0023 (D2). Validation lives in the registry contract; fixed pipeline.
- "Create a separate registry for `OutcomeCredential` / `EvidenceCredential`" — **STOP.** ADR-0024 Decision 2; same registry, different `credentialType`.
- "Promote a vault-resident credential body to PR" — **STOP.** D-46.3; explicit opt-in only.

## Validate

```bash
pnpm --filter @agenticprimitives/attestations typecheck
pnpm --filter @agenticprimitives/attestations test
```
