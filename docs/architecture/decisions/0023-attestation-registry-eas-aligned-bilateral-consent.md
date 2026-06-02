# ADR-0023 — Attestation registry: EAS-aligned, Verax-informed, with bilateral consent

**Status:** Accepted (2026-06-02).
**Drivers:** ecosystem alignment, audit cost, third-party legibility, bilateral-consent first-class support, W3C VC integration without surrendering ERC-1271-native auth.
**Concrete spec:** [`specs/242-trust-credentials-and-public-assertions.md`](../../../specs/242-trust-credentials-and-public-assertions.md).
**Companion ADR:** [ADR-0024](./0024-intent-coordination-substrate.md) (the spine this registry serves evidence + reputation for).

---

## Why this ADR exists

The `@agenticprimitives/attestations` package + its `AttestationRegistry.sol`
contract are the on-chain substrate for **every** public, holder-asserted claim
in the platform — Association credentials, joint Agreement credentials,
fulfillment Evidence, Outcome credentials, Validation credentials, TrustUpdates
(reputation), and any future credential type from `@agenticprimitives/verifiable-credentials`.

The 2026 Ethereum ecosystem has converged on two reference implementations:
**EAS** (Ethereum Attestation Service: 2 contracts, dominant adoption, EIP-712
+ ERC-1271-aware) and **Verax** (Linea: 4 contracts, Portal/Module pattern,
issuer-policy-as-contract). Both are credible patterns; neither maps cleanly
onto our requirements.

The decisions below are **architecture-of-record**. They MUST NOT drift
without a successor ADR.

## The contract surface

`AttestationRegistry.sol` ships with this single canonical struct:

```solidity
struct Attestation {
    bytes32 uid;                          // deterministic keccak256
    bytes32 schemaId;                     // → ShapeRegistry.getShape(...) row
    bytes32 credentialType;               // VC type class (Association / JointAgreement / Evidence / Outcome / Validation / TrustUpdate / ...)
    bytes32 credentialHash;               // RFC 8785 JCS hash of off-chain VC body
    bytes32 refUID;                       // EAS-style single back-pointer (e.g. agreementCommitment for joint)
    bytes32 bilateralConsentRef;          // 0 for unilateral; signatures-bundle hash or pinned-delegation hash for joint
    bytes32 offchainCredentialStatusList; // W3C VC StatusList2021 pointer
    uint64  epochBucket;                  // attest time in EPOCH_SECONDS buckets
    uint64  revocationEpochBucket;        // 0 if not revoked
    address subject;                      // SA address of holder (unilateral) or parties[0] (joint)
    address party2;                       // address(0) for unilateral; parties[1] for joint
    address issuer;                       // SA address of off-chain VC signer
}
```

Two write entrypoints (per credential class):

```solidity
function assertAssociation(AssociationAttestationRequest) external returns (bytes32 uid);
function assertJointAgreement(JointAgreementAttestationRequest) external returns (bytes32 uid);
```

Two revoke entrypoints (holder-only / either-party):

```solidity
function revokeOwnAssociation(bytes32 uid) external;       // subject only
function revokeOwnJointAgreement(bytes32 uid) external;    // either party
```

Two view entrypoints:

```solidity
function getAttestation(bytes32 uid) external view returns (Attestation memory);
function isValid(bytes32 uid) external view returns (bool); // !revoked && !expired
```

Three events (each 4 indexed topics, mirroring EAS):

```solidity
event Attested(address indexed subject, address indexed issuer, bytes32 indexed uid, bytes32 indexed credentialType);
event JointAttested(address indexed party1, address indexed party2, bytes32 indexed uid, bytes32 indexed credentialType);
event Revoked(address indexed subjectOrParty, bytes32 indexed uid, bytes32 indexed credentialType, bytes32 reasonHash);
```

## What we adopt from EAS — as-is

| Pattern | Why |
|---|---|
| **Deterministic `uid`** (`keccak256(...)`) | Audit-friendly; matches Verax |
| **EIP-712 typed-data signatures** with delegated-payer split | The holder (SA) signs the typed-data; relayer/paymaster pays gas. Native ERC-1271 path. |
| **`refUID` single back-pointer**, validated to exist | This is exactly how `JointAgreementAssertion` references the `AgreementRegistry` commitment row |
| **Off-chain hash-timestamp pattern** (`timestamp(bytes32)`) | Useful for evidence preservation without publishing the artifact itself |
| **Four indexed event topics** | Generous query surface for indexers (subject, issuer, uid, credentialType) |

## What we adopt from EAS — with modification

| EAS pattern | Our modification | Why |
|---|---|---|
| `recipient: address` | Split into `subject: address` + `party2: address` | Explicit bilateral-party slots for joint attestations; either party is queryable as the indexed `subject` of an event |
| "Only the original attester can revoke" | **Subject (holder) only for unilateral; EITHER party for joint** | Matches D-18 (no issuer-revoke) + D-26 (either-party joint revoke) |
| Schema as raw string | Replace with `bytes32 schemaId` → `ShapeRegistry.getShape(...)` row | We already have SHACL-shape-based schemas via [ADR-0009](./0009-on-chain-ontology-shacl-naming.md); no need for EAS's ad-hoc string ABI |
| Single `signature` in `attestByDelegation` | Generalize to **bilateral signatures** OR pre-pinned bilateral-consent delegation (per spec 242 §6) | Bilateral consent is our differentiator vs. EAS |
| Schema-level `revocable` boolean | Schema names a **revocation policy class** (holder-only, either-party, none) | Richer semantics than a single boolean |

## What we reject from EAS

| Pattern | Reject reason |
|---|---|
| **Resolver pattern** (per-schema `ISchemaResolver` contract with `onAttest`/`onRevoke` hooks) | Adds attack surface; forces every consumer to evaluate resolver trust. We bake validation into the registry (schema check + signature check + bilateral check) — known fixed pipeline, audit-bounded. |
| **Permissionless schema registration** | Our `ShapeRegistry.defineShape(...)` is **`onlyGovernor`**-gated by design. Every substrate Description is governance-blessed. Permissionless schemas would invite SHACL-shape squatting and trust-substrate dilution. |
| **Irrevocable-schemas flag** | All our attestations are revocable; the question is by-whom (codified per credential type) |

## What we reject from Verax

| Pattern | Reject reason |
|---|---|
| **Portal pattern** (issuer-as-contract entry point) | Powerful but our model already has issuers as SAs with ERC-1271-verified credentials. Portals duplicate that layer. |
| **Module chain** (pluggable per-portal validation) | Invites "rogue module" trust risk. We keep validation in-registry: known + audited + fixed. |
| **Four-contract split** (Schema / Module / Portal / Attestation) | Three registries (ShapeRegistry — existing; AttestationRegistry — this ADR; AgreementRegistry — spec 241) is sufficient. More contracts = more upgrade-coordination surface. |

## What we add beyond both EAS and Verax

| Feature | Why |
|---|---|
| **`parties: address[2]` for `JointAgreement` attestations** | Both parties first-class on chain; bilateral-consent visible to indexers |
| **`bilateralConsentRef: bytes32`** | References the signature bundle hash OR `CalldataHashEnforcer`-pinned delegation hash that authorized the joint attestation. Audit-time proof. |
| **`credentialType: bytes32`** | Distinct from `schemaId` — `schemaId` is the SHACL shape, `credentialType` is the W3C VC type class. Lets queries filter by credential class without decoding payload. |
| **`credentialHash: bytes32`** | RFC 8785 JCS canonical hash of the off-chain VC body. Lets verifiers reconcile the on-chain row with the off-chain credential. |
| **`offchainCredentialStatusList: bytes32`** | Pointer to issuer's W3C VC [StatusList2021](https://www.w3.org/TR/vc-status-list/) entry. Holder revocation on-chain ≠ issuer revocation off-chain — both independently meaningful. |
| **Epoch-bucket timestamps** | Damps timing-correlation attacks; consistent with [spec 241](../../../specs/241-agreement-commitment-registry.md). Raw `block.timestamp` never stored. |
| **Nullifier set on revocation** | Same pattern as spec 241; one-shot revocations; prevents replay across same `(uid, party)` pair. |

## Why these choices

**(D1) Ecosystem legibility.** A third-party developer reading
`AttestationRegistry.sol` recognizes the EAS-derived shape immediately —
deterministic UID, refUID back-pointers, EIP-712 + ERC-1271, four indexed
event topics. They don't have to learn a novel pattern.

**(D2) Audit-bounded validation.** Rejecting Resolver + Module patterns
means the validation pipeline is **fixed and finite**: schema check,
signature check, bilateral check, refUID existence. No pluggable risk
surface. The registry is one contract; the auditor reads one file.

**(D3) Bilateral consent is a contract-level invariant, not a convention.**
`assertJointAgreement` must carry `bilateralConsentRef` and `party2` —
a unilateral mis-use cannot compile against the right function. EAS would
require the same constraint to live in resolver bytecode or off-chain
convention; we put it in the type system.

**(D4) Holder-only revocation by construction.** No `issuerRevoke(...)`
entrypoint exists; the surface CANNOT express it. This is enforceable by
static analysis. Issuers control credential STATUS off-chain via
StatusList2021 (the `offchainCredentialStatusList` pointer); on-chain
revocation is a separate, holder-owned concept.

**(D5) W3C VC + EAS dual-citizenship.** `credentialType` + `credentialHash`
+ `offchainCredentialStatusList` make every attestation simultaneously a
W3C-compatible reference and an EAS-recognizable on-chain row.
W3C verifiers can reconcile; EAS indexers can index.

## Composability across the platform

Every credential class in the platform asserts into this same registry:

| Credential class | Owner | Cardinality | Revocability |
|---|---|---|---|
| `AssociationCredential` | `@agenticprimitives/verifiable-credentials` | Per-(holder, issuer, type) | Holder only |
| `AgreementCredential` | `@agenticprimitives/agreements` (PD-22) | Per-(party1, party2, agreementCommitment) | Either party |
| `EvidenceCredential` | `@agenticprimitives/fulfillment` (spec 244) | Per-(holder, taskId) | Holder only |
| `OutcomeCredential` | `@agenticprimitives/fulfillment` (spec 244) | Per-(holder, intentId) | Holder only |
| `ValidationCredential` | `@agenticprimitives/attestations` | Per-(validator, subjectAttestationUid) | Validator only |
| `TrustUpdate` | `@agenticprimitives/attestations` (reputation extension) | Per-(subject, basedOnIntentId, validator) | Validator only |
| `PaymentReceipt` | `@agenticprimitives/payments` (spec 243) | Per-(payer, payee, paymentMandateId) | Neither (receipts are immutable) |

No new contracts per credential type. The substrate is `credentialType` discrimination, not per-type registries. This is the **inverse** of the smart-contract-per-credential anti-pattern.

## Drift triggers — STOP and reroute

- "I want to add an `issuerRevoke(...)` entrypoint." — **STOP.** D-18 + (D4) above. Issuer revocation is off-chain via StatusList2021.
- "I want to add a Resolver / Module hook." — **STOP.** (D2). Validation lives in the registry. Add a new credential type instead.
- "I want a separate registry for `OutcomeCredential` / `EvidenceCredential` / reputation." — **STOP.** Same registry, different `credentialType`. See composability table above.
- "I want to register a SHACL shape from app code without governor signature." — **STOP.** ShapeRegistry is `onlyGovernor`-gated. App-specific shapes register through the governance flow.
- "I want `subject = address(0)` for global attestations like EAS supports." — **STOP.** Our subjects are always a SA address. Global attestations don't fit our trust model.
- "I want `multiAttest` for batching." — Acceptable as a future addition; not in W1; specify in a successor ADR if added.

## What this ADR is NOT

- NOT EAS-binary-compatible. We don't intend to deploy EAS-readable attestations; we intend EAS-pattern-recognizable ones.
- NOT a replacement for off-chain credential infrastructure. The off-chain VC body, its issuer signature, and StatusList2021 are separate substrate; this ADR governs the on-chain anchor.
- NOT a governance contract. ShapeRegistry handles schema governance; this contract handles holder-asserted instances.
- NOT mutable. The contract has no admin, no upgrade path, no fees.

## Related ADRs + specs

- [ADR-0009](./0009-on-chain-ontology-shacl-naming.md) — SHACL/ontology naming; the schema substrate this registry reads.
- [ADR-0010](./0010-smart-agent-canonical-identifier.md) — SA address is the identity; subjects are SA addresses.
- [ADR-0013](./0013-no-silent-fallbacks.md) — one mechanism per read path; no fallback to log-walking.
- [ADR-0022](./0022-authority-must-be-declarative.md) — every contract entrypoint gets a manifest entry.
- [ADR-0024](./0024-intent-coordination-substrate.md) — the v2 spine this registry serves.
- [spec 242](../../../specs/242-trust-credentials-and-public-assertions.md) — the implementation spec consuming this ADR.
- [spec 241](../../../specs/241-agreement-commitment-registry.md) — the agreement-commitment registry whose rows are the `refUID` targets for `JointAgreement` attestations.
- [spec 225](../../../specs/225-ontology.md) — the ontology + ShapeRegistry that schemas live in.

## Sources

- [EAS source — ethereum-attestation-service/eas-contracts](https://github.com/ethereum-attestation-service/eas-contracts)
- [Verax architecture — docs.ver.ax](https://docs.ver.ax/)
- [W3C VC Data Model 2.0](https://www.w3.org/TR/vc-data-model-2.0/)
- [W3C VC StatusList2021](https://www.w3.org/TR/vc-status-list/)
- [ERC-5851 — On-Chain Verifiable Credentials](https://eips.ethereum.org/EIPS/eip-5851)
- [RFC 8785 — JSON Canonicalization Scheme](https://www.rfc-editor.org/rfc/rfc8785)
