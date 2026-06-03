# ADR-0027 — Canonical authority binding: recompute the typed payload, never trust a stored hash

**Status:** Accepted (2026-06-03).
**Drivers:** the 2026-06-03 W1-substrate contract authority review (RW1-1..RW1-4 in
[`docs/architecture/product-readiness-audit.md`](../product-readiness-audit.md)); audit-readiness;
the "a stored nonzero hash is not consent" class of finding.
**Complements:** [ADR-0022](0022-authority-must-be-declarative.md) (authority must be *declared*).
**Enforcement today:** `pnpm check:eip712-typehash-equality` (delegation typehashes, TS ↔ live Solidity).

---

## The rule

> **Every authority-bearing action MUST bind the authorizing signature to a CANONICAL typed payload
> that the verifier RECOMPUTES from calldata + fixed domain constants. A stored hash, a
> caller-supplied digest, or a merely-nonzero reference is NOT authority.**

Corollaries:

1. **Recompute, don't accept.** On-chain verifiers recompute the EIP-712 struct hash (or other
   canonical digest) from the call's components and the contract's own domain/typehash constants.
   A function that accepts a caller-supplied `structHash`/`digest` and verifies a signature over *it*
   has verified nothing about the call — the caller chose the thing being signed.
2. **References must be dereferenced or proven, never just stored.** `refUID`, `schemaId`,
   `bilateralConsentRef`, `partySetCommitment` and the like are pointers/commitments. Storing a
   nonzero value is not verification. Either dereference and check the target, or require a membership
   proof, or move the unprovable transition off-chain.
3. **One canonical digest model across the stack.** The off-chain signer (TS package), the VC proof,
   and the on-chain verifier MUST agree on the exact typed payload. CI asserts the TS typehashes equal
   the Solidity constants (see ADR-0022 + the gate above); the same discipline extends to every
   registry digest.
4. **Delegation authority requires caveat evaluation.** A view that checks chain + signature +
   authority + revocation but NOT the caveats has not authorized a *call*. Authorizing a public claim
   on the strength of a delegation requires evaluating the pinned calldata / target / method / value /
   time caveats for the exact action.
5. **Privacy is not a reason to skip verification.** A commitment-only design (party SAs hidden to
   protect the trust graph) does not license dropping authorization. Use a membership proof against the
   commitment, or keep the authority-bearing transition fully off-chain — do not accept a caller-supplied
   signer set against a commitment that was never opened.

## Why (the failure mode)

If the verifier signs/checks over a value the caller supplied, an actor holding any one valid signature
can re-target it: publish a joint assertion with an arbitrary consent reference, claim a status
transition with signers who are not the parties, or redeem a delegation for a call its caveats forbid.
The signature is real; the *binding to the action* is missing. The defense is structural: the verifier
reconstructs the exact thing that should have been signed and rejects anything else.

## Relationship to ADR-0022

ADR-0022 says authority must be **declared** (a machine-readable manifest entry; CI proves the
implementation matches the declaration). ADR-0027 says authority must be **bound at verification** (the
runtime/on-chain check recomputes the canonical payload and dereferences/proves references). 0022 is the
*declaration is the source of truth*; 0027 is *the verifier is the enforcer, and it trusts nothing it
did not reconstruct*. A capability is only sound when both hold.

## Status against the current substrate

**Holds:**
- Delegation redemption — `DelegationManager` recomputes `DELEGATION_TYPEHASH`/`CAVEAT_TYPEHASH` from
  the struct (`args` excluded), and `check:eip712-typehash-equality` asserts the TS signer matches the
  live Solidity source (`packages/delegation/test/integration/cross-stack-typehashes.test.ts`).
- `AgreementRegistry.register` recomputes the commitment from its components (AR-01).

**Open (tracked as RW1-1..RW1-4 — production gaps, several by-design per ADR-0023's commitment model):**
- **RW1-1** `AttestationRegistry.assertJointAgreement` stores a nonzero `bilateralConsentRef` and
  verifies only the issuer signature — bilateral consent is "the caller's responsibility." → recompute
  or prove the two-party consent on-chain (Corollary 2).
- **RW1-2** `AgreementRegistry.updateStatus` accepts caller-supplied `signer1/signer2` without proving
  membership in `partySetCommitment`. → membership proof or off-chain transition (Corollary 5).
- **RW1-3** registry assertion digests are not all recomputed on-chain. → one canonical digest model
  (Corollary 1, 3).
- **RW1-4** `DelegationManager.verifyAuthorization` (view) does not evaluate caveats. → a
  `verifyAuthorizationForCall(...)` that checks the exact-call caveats (Corollary 4).

## Consequences

- New authority-bearing contract entrypoints recompute their typed payload from calldata + constants;
  PRs that accept a caller-supplied digest as the authority root are rejected in review.
- Each registry that verifies a credential/agreement signature gets a versioned typehash + public domain
  separator view, and a `check:eip712-typehash-equality` entry once both sides exist.
- The RW1 fixes land as the contract-authority hardening wave (the next PR set after this ADR), with
  invariant + negative-path Foundry tests for the consent/refUID/schema/caveat failure paths.
