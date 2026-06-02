# @agenticprimitives/verifiable-credentials — Claude guide

> **Status:** STUB (Wave 0.5). Full implementation in Wave 2 per [w1-implementation-wave-plan.md](../../docs/architecture/w1-implementation-wave-plan.md).

## What this package owns

- **W3C VC 2.0 envelope** — `@context`, `type`, `issuer`, `validFrom`, `credentialSubject`, `proof`, `credentialStatus`.
- **`Eip712Signature2026` proof type** — primary W1 proof, EIP-712 + ERC-1271-aware verification.
- **DOLCE+DnS Situation pattern** — `Situation` / `Description` / `Roles` / `Participants` typed base shapes that all substrate credential subjects compose against.
- **RFC 8785 JCS canonical hash** — `credentialHash(vc)` returns the canonical hash bytes used everywhere downstream.
- **Schema-registration helper** — `did:shape:<name>:<version>` ↔ on-chain `ShapeRegistry.defineShape(...)` round-trip per PD-12.
- **Verifier** — `verifyCredential(vc, publicClient)`: ERC-1271 issuer signature + optional StatusList2021 fetch + canonical-hash reconciliation. Returns typed validity record.

## What this package does NOT own

- **Specific credential type definitions** — `AssociationCredential` lives in `attestations`; `AgreementCredential` lives in `agreements` (per PD-22); `EvidenceCredential` + `OutcomeCredential` live in `fulfillment`; `PaymentReceipt` lives in `payments`; etc.
- **On-chain attestation registry** — that's `attestations` + `AttestationRegistry.sol` per [ADR-0023](../../docs/architecture/decisions/0023-attestation-registry-eas-aligned-bilateral-consent.md).
- **AnonCreds / BBS+ / SD-JWT alternative proof types** — reserved slot in the envelope per PD-28; implementation deferred to W2+.

## Read these first

1. [`spec.md`](./spec.md) → [`specs/242-trust-credentials-and-public-assertions.md`](../../specs/242-trust-credentials-and-public-assertions.md) §4 (the canonical surface)
2. [`coordination-substrate.md`](../../docs/architecture/coordination-substrate.md) §5.5 (W3C VC composability cross-cutting concern)
3. [ADR-0023](../../docs/architecture/decisions/0023-attestation-registry-eas-aligned-bilateral-consent.md) (how downstream packages consume the envelope)
4. [`privacy-and-self-sovereign-identity.md`](../../docs/architecture/privacy-and-self-sovereign-identity.md) §2 (proof-type plurality posture)

## Stable public exports (planned)

- Main entry: `Vc<T>`, `Eip712Signature2026Proof`, `Situation` / `Description` / `Roles` / `Participants`, `credentialHash(vc)`, `signCredential(vc, signer)`, `verifyCredential(vc, publicClient)`, `registerSchema(shape, signer)`.

## Allowed imports

- `@agenticprimitives/types` — branded types
- `@agenticprimitives/ontology` — IRI constants (T-box reference)
- `viem` — EIP-712 + ERC-1271
- `@noble/hashes` — canonical hashing

## Forbidden imports

- Any other `@agenticprimitives/*` package (vc is a leaf in the dependency graph)
- `apps/*`

## Vocabulary firewall

Per [ADR-0021](../../docs/architecture/decisions/0021-generic-packages-vs-white-label-apps.md): NO faith / health / education / vertical vocabulary. The envelope is generic; consumers compose vertical credential subjects on top. CI: `pnpm check:no-domain-in-packages` + `pnpm check:forbidden-terms`.

## Drift triggers — STOP and route

- "Add a specific credential type definition here" — **STOP.** Lives in the consumer package per the §5.5 composability rule.
- "Hardcode an issuer SA address" — **STOP.** Envelope is issuer-agnostic.
- "Add a fallback verifier path" — **STOP.** [ADR-0013](../../docs/architecture/decisions/0013-no-silent-fallbacks.md) forbids it.
- "Add BBS+/SD-JWT/AnonCreds in W1" — **STOP.** Reserved slot per PD-28; lands in W2.

## Validate

```bash
pnpm --filter @agenticprimitives/verifiable-credentials typecheck
pnpm --filter @agenticprimitives/verifiable-credentials test
pnpm --filter @agenticprimitives/verifiable-credentials build
```
