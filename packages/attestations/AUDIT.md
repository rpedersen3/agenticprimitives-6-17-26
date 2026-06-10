# @agenticprimitives/attestations — Audit Notes

**Status:** Foundational (W1) — code shipped; not production enforcement.
**Last reviewed:** 2026-06-10 (audit-consolidation round 1).

## Charter
SDK for `AttestationRegistry.sol` (encoder/decoder + read client + ABI mirror) and the credential-type
taxonomy (`AssociationCredential`, `EvidenceCredential`, `OutcomeCredential`, `ValidationCredential`,
`TrustUpdate`) discriminated by `credentialType` (ADR-0023/0024). Bilateral-consent helpers build the
`jointConsentDigest` both parties sign.

## Findings (canonical status: `docs/audits/findings.yaml`)
- **SC-2** (high, **closed**) — the on-chain `AttestationRegistry` (in `packages/contracts`) bound the association
  attestation digest to subject/issuer/schemaId/credentialType/credentialHash/chainId/address(this), closing
  subject-spoofing. This SDK's `JOINT_CONSENT_TYPEHASH` is locked to the contract via `check:eip712-typehash-equality`.
- The contracts audit noted the **joint-agreement** issuer path binds fewer fields than the association path —
  tracked as a contract-side hardening item, not an SDK change.

## Security invariants
- No `issuerRevoke` entrypoint (D-18/AR-10); revocation is holder/either-party/validator-scoped per credential type.
- Typehash equality with `AttestationRegistry.sol` is CI-enforced; a drift fails `check:eip712-typehash-equality`.

## Production readiness
W1-foundational SDK over an audited-pending contract. Needs a per-package threat model + negative tests before
authority use. Canonical invariants: `spec.md` + [`CLAUDE.md`](./CLAUDE.md).
