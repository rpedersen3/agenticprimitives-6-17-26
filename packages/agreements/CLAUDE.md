# @agenticprimitives/agreements — Claude guide

> **Status:** Foundational (W1) — code shipped; not production enforcement. See [AUDIT.md](./AUDIT.md).

## What this package owns

- **`AgreementRegistry.sol` SDK** — encoder/decoder + read client + ABI mirror for the commitment-only registry specified in [spec 241](../../specs/241-agreement-commitment-registry.md).
- **`AgreementCredential` shape** (per PD-22) — the off-chain VC describing a two-party agreement; DOLCE+DnS Situation pattern.
- **Commitment math** — canonical hash per spec 241 §3 + IA §10. Cross-stack typehash equality with the Solidity side.
- **Nullifier derivation** + state tracking helpers.
- **Gateway helper** — `isAssertableCommitment(agreementCommitment, actor)` payload builder so `attestations.assertJointAgreement` can verify back-pointer existence.
- **Status transition encoders** — ACTIVE → COMPLETED/DISPUTED/REVOKED per spec 241 §5.4.1 matrix (bilateral / either-party / never-issuer-only signing requirements).

## What this package does NOT own

- **Joint-agreement assertion logic** — lives in `attestations` (spec 242 §6). This package only provides the back-pointer + gateway helper.
- **The VC envelope itself** — that's `verifiable-credentials`.
- **Intent → Commitment generation** — that's `intent-marketplace`. The Commitment is the bridge between Layer 7 and Layer 8; this package consumes it.

## Read these first

1. [`spec.md`](./spec.md) → [`specs/241-agreement-commitment-registry.md`](../../specs/241-agreement-commitment-registry.md)
2. [ADR-0023](../../docs/architecture/decisions/0023-attestation-registry-eas-aligned-bilateral-consent.md) (downstream `attestations` registry)
3. [ADR-0024](../../docs/architecture/decisions/0024-intent-coordination-substrate.md) Layer 8
4. [`coordination-substrate.md`](../../docs/architecture/coordination-substrate.md) §4 Layer 8

## Stable public exports (planned)

`buildAgreementIssuancePayload`, `signIssuerAttestation`, `hashAgreement`, `computeAgreementCommitment`, `partyCommitment`, `issuerCommitment`, `partySetCommitment`, `nullifierFor`, `TRANSITION_TYPEHASH`, `transitionDigest`, `AgreementRegistryClient.getRecord`, `AgreementRegistryClient.isAssertableCommitment`, `gateway.buildJointAssertionPayload`, `AgreementCredential` (type).

> RW1-3 (ADR-0027): `updateStatus` RECOMPUTES the transition digest from
> `(agreementCommitment, toStatus, nullifier)` on chain — it does not trust a
> caller-supplied `transitionStructHash`. `transitionDigest()` here derives the
> byte-identical value; the cross-stack `check:eip712-typehash-equality` gate
> locks `TRANSITION_TYPEHASH` to `AgreementRegistry.sol`.

## Allowed imports

- `@agenticprimitives/types`, `@agenticprimitives/verifiable-credentials` (type-only — for AgreementCredential envelope), `@agenticprimitives/ontology` (IRI constants)
- `viem`

## Forbidden imports

- Runtime call into `attestations` (the contracts back-reference each other; SDKs use gateway helper + payload builders only — never direct call)
- Runtime call into `intent-marketplace` (Commitment is passed by hash, not by typed import)
- `apps/*`
- Vertical vocabulary

## Drift triggers — STOP and route

- "Put `AgreementCredential` in `verifiable-credentials`" — **STOP.** PD-22 locks it here next to the registry that consumes it.
- "Add party SA addresses to the on-chain `register(...)` calldata" — **STOP.** AR-12; static-analysis regression test; commitment-only on chain.
- "Use raw `block.timestamp` for a transition record" — **STOP.** Epoch-bucket timestamps only (spec 241 §3.4).
- "Add an `issuerCanRevoke(...)` path" — **STOP.** D-18 + AR-10. Either-party joint revoke only.

## Validate

```bash
pnpm --filter @agenticprimitives/agreements typecheck
pnpm --filter @agenticprimitives/agreements test
```
