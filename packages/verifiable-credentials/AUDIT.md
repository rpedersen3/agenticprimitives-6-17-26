# @agenticprimitives/verifiable-credentials — Audit Notes

**Status:** Implemented — security-load-bearing. Pre–external-audit.
**Last reviewed:** 2026-06-10 (audit-consolidation round 1).

## Charter
W3C VC 2.0 envelope + the `Eip712Signature2026` proof type + RFC 8785 canonical `credentialHash` + the
credential **verifier** (`src/verifier.ts`). `verifyCredential()` performs the ERC-1271 issuer round-trip
and fails closed; `credentialHash` is mandatory; the EIP-712 digest pins `verifyingContract` to the issuer
SA and binds `chainId`. Downstream packages compose vertical credential subjects on top.

## Findings (canonical status: `docs/audits/findings.yaml`)
- **VC-1** (high, **closed**) — verifier was fail-open with no issuer-signature check → `verifyCredential()` now does the ERC-1271 round-trip.
- **VC-2** (high, **closed**) — digest trusted attacker-supplied `verifyingContract`/`chainId` → now pinned to the issuer SA + chain-bound.

## Security invariants
- `verifyCredential` MUST fail closed (no/unknown issuer signature → reject); no fallback verifier (ADR-0013).
- `credentialHash` required; digest binds issuer + chainId + verifyingContract (= issuer SA).
- SHACL/runtime shapes here are vocabulary, not authority; T-box class definitions live in `@agenticprimitives/ontology`.

## Test posture
Unit tests cover verifier accept/reject. Not a substitute for an external review of the credential digest + proof type.

## Production readiness
Verifier is production-grade in shape (VC-1/VC-2 closed); the package is pre–external-audit. Alternative proof
types (BBS+/SD-JWT/AnonCreds) are a reserved W2 slot. Canonical invariants: `spec.md` + [`CLAUDE.md`](./CLAUDE.md).
