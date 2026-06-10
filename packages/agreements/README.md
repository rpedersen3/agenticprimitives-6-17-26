# @agenticprimitives/agreements

**Two agents strike a deal. The chain should be able to prove the deal existed and how it ended — without ever learning what it was.** Most on-chain agreement records leak by design: parties, terms, schedules, all readable forever. This package is the SDK for `AgreementRegistry.sol`, a commitment-only registry — the chain stores keccak commitments over the party set, issuer, terms, and schedule, plus a status machine (`ACTIVE → COMPLETED / DISPUTED / REVOKED`). The human-readable agreement is a W3C verifiable credential held off chain by the parties; the chain holds only enough to anchor and adjudicate it.

Status transitions are as strict as registration is private: the contract recomputes the transition digest from the commitment, target status, and nullifier on chain, and requires party signatures over that recomputed value — never a caller-supplied hash, and never an issuer-only revoke.

> Part of [agenticprimitives](../../README.md) — the trust substrate for the agent economy: one canonical Smart Agent identity with custody, delegation, naming, credentials, and audit evidence designed as one system.

## What ships today

The W1 foundational slice — commitment math, typehashes, and payload shapes the contract relies on:

- **Commitment math** — `computeAgreementCommitment(...)` (spec 241 §3), `partySetCommitment(party1, party2)`, `issuerCommitment(issuer)`, `bytesCommitment(value)` for terms/schedule hashes.
- **`STATUS`** — discriminators matching `AgreementRegistry.STATUS_*` (`NONE` / `ACTIVE` / `COMPLETED` / `DISPUTED` / `REVOKED`).
- **`TRANSITION_TYPEHASH` + `transitionDigest(...)`** — the digest parties sign for a status transition. `updateStatus` recomputes it on chain (RW1-3, [ADR-0027](../../docs/architecture/decisions/0027-canonical-authority-binding.md)); `chainId` and the registry address are bound against cross-chain replay (AGR-1).
- **`AGREEMENT_ISSUER_TYPEHASH` + `issuerAttestationDigest(...)`** — the issuer's registration attestation, recomputed and verified on chain (SC-1).
- **`nullifierFor(...)`** — per-transition one-shot nullifier derivation.
- **Payload shapes** — `AgreementIssuancePayload`, `StatusUpdatePayload` (including the RW1-2 revealed-party fields the contract uses to recompute the commitment and check each signer is a party).

Every typehash MUST byte-equal its `AgreementRegistry.sol` constant — enforced by the cross-stack `check:eip712-typehash-equality` CI gate.

Planned for later waves per the [W1 implementation wave plan](../../docs/architecture/w1-implementation-wave-plan.md): the `AgreementCredential` shape (PD-22), `AgreementRegistryClient` read client, and the joint-assertion gateway helper that lets [`attestations`](../attestations) verify an agreement back-pointer before asserting on it.

## How it's different

Against EAS-style attestation registries and e-signature platforms:

1. **Commitment-only on chain.** No party addresses, no terms, no schedule in `register(...)` calldata — a static-analysis regression test enforces it (AR-12). Even timestamps are epoch-bucketed (spec 241 §3.4). Attestation registries publish the claim; this registry publishes only its shadow.
2. **The chain recomputes; it never trusts.** Transition digests and issuer attestations are recomputed on chain from revealed components — a leaked signature cannot be replayed against a different agreement, status, chain, or registry deployment.
3. **No issuer-only exit.** Completion, dispute, and revocation follow the bilateral / either-party matrix of spec 241 §5.4.1. The issuer who notarized the agreement cannot unilaterally kill it (D-18).
4. **Contracts and SDK are one artifact.** Typehash parity is CI-gated, so the client cannot drift from the chain — the failure mode that quietly breaks stitched signing stacks.

## Status

**Foundational (W1) — code shipped; not production enforcement.** The commitment math, typehashes, and payload shapes above are real and gate-checked; the credential shape, read client, and gateway land in Wave 4 per the [wave plan](../../docs/architecture/w1-implementation-wave-plan.md). See [AUDIT.md](./AUDIT.md).

> Testnet/pilot-ready. Production launch is gated on the public checklist in the root README — including third-party contract audit and governance key rotation. Track every security finding live in [`docs/audits/findings.yaml`](../../docs/audits/findings.yaml).

**Owns spine layers:** layer 8.
**Authoritative spec:** [`specs/241-agreement-commitment-registry.md`](../../specs/241-agreement-commitment-registry.md) — see `spec.md` for the symlink. Bounded surface: `CLAUDE.md` + `capability.manifest.json`.

## Build

```bash
pnpm --filter @agenticprimitives/agreements typecheck
pnpm --filter @agenticprimitives/agreements test
pnpm --filter @agenticprimitives/agreements build
```
