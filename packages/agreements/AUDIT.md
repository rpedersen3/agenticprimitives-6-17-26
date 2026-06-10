# @agenticprimitives/agreements — Audit Notes

**Status:** Foundational (W1) — code shipped; not production enforcement.
**Last reviewed:** 2026-06-10 (audit-consolidation round 1).

## Charter
SDK for the commitment-only `AgreementRegistry.sol` (spec 241): canonical commitment math, nullifier
derivation, status-transition encoders, and the `AgreementCredential` off-chain shape + gateway helper
(`isAssertableCommitment`) so `attestations.assertJointAgreement` can verify back-pointer existence.

## Findings (canonical status: `docs/audits/findings.yaml`)
- **SC-1** (critical, **closed**) — the on-chain `AgreementRegistry` (in `packages/contracts`) now recomputes the
  issuer digest over `agreementCommitment, schemaHash, issuer, chainId, address(this)`, so a caller-supplied
  free-form hash is no longer accepted as authority. This SDK's `TRANSITION_TYPEHASH` is locked to the contract
  via `check:eip712-typehash-equality`.
- Contracts audit noted the **transition digest** binds fewer domain fields (chainId/verifyingContract) than the
  issuer digest — tracked as a contract-side hardening item.

## Security invariants
- Commitment-only on chain (no party SA addresses in `register(...)` calldata — AR-12, regression-tested).
- Epoch-bucket timestamps (spec 241 §3.4); either-party joint revoke only (no issuer-only path, D-18/AR-10).

## Production readiness
W1-foundational SDK over an audited-pending contract. Needs a per-package threat model + negative tests.
Canonical invariants: `spec.md` + [`CLAUDE.md`](./CLAUDE.md).
