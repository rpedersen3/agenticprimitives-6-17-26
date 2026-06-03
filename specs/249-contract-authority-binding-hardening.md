# Spec 249 — Contract authority-binding hardening (ADR-0027 enforcement)

**Status:** draft, 2026-06-03.
**Owner:** `packages/contracts` (agency + attestation + agreement) — architect-of-record for the
RW1-1..RW1-4 contract changes.
**Architecture-of-record:** [ADR-0027](../docs/architecture/decisions/0027-canonical-authority-binding.md)
(canonical authority binding) + [ADR-0023](../docs/architecture/decisions/0023-attestation-registry-eas-aligned-bilateral-consent.md)
(attestation bilateral consent) + [ADR-0022](../docs/architecture/decisions/0022-authority-must-be-declarative.md).
**Findings closed:** RW1-1..RW1-4 in [`docs/architecture/product-readiness-audit.md`](../docs/architecture/product-readiness-audit.md).

This is the contract wave that enforces ADR-0027 ("the verifier recomputes / proves; a stored hash or
caller-supplied digest is not authority") on the W1 substrate registries. It ships as incremental PRs,
each with Foundry invariant + negative-path tests. No redeploy until the full set is green.

## Increments

### RW1-4 (this increment) — `verifyAuthorizationForCall` (view, fail-closed)

`DelegationManager.verifyAuthorization(delegations, sender)` validates chain + signature + authority +
revocation but **does not evaluate caveats** — too weak to authorize a *specific call*. Add:

```solidity
function verifyAuthorizationForCall(
    Delegation[] calldata delegations,
    address sender,
    address target,
    uint256 value,
    bytes calldata data
) external view returns (bool ok, string memory reason);
```

Semantics:
- Validates each delegation in the chain (the existing `_validateDelegationView`).
- For each delegation's caveats, evaluates `beforeHook(terms, args, dHash, delegator, sender, target,
  value, data)` against the **exact call** — via `staticcall` (the hook is `external`/non-view because
  stateful enforcers like Quorum exist).
- **Fail-closed:** returns `true` **only if** every caveat's `beforeHook` succeeds read-only. A caveat
  that reverts (denied) OR cannot be evaluated read-only (a stateful enforcer attempting a write under
  staticcall) yields `false` with `caveat-failed:<i>`. So `true` is a genuine guarantee for that exact
  call; `false` means "use live redemption" (which evaluates stateful caveats properly). This matches
  ADR-0027 corollary 4 (delegation authority requires caveat evaluation) and is the building block
  RW1-1 needs.
- Pure addition — no existing entrypoint changes; `redeemDelegation` behaviour is untouched.

### RW1-1 — `AttestationRegistry.assertJointAgreement` proves consent — **CONTRACT DONE**

Replaced "bilateralConsentRef != 0 + issuer signature, consent is the caller's responsibility" with
verified two-party consent (option a): the contract **recomputes** the canonical consent digest
(`JOINT_CONSENT_TYPEHASH` over party1, party2, the agreement commitment, and the credential hash) and
requires BOTH parties' signatures over it (`_isValidSignatureBool` → ERC-1271 / ECDSA). The supplied
`bilateralConsentRef` is now ignored (deprecated field); the stored ref is the recomputed, verified
digest. Storing a nonzero ref is no longer consent (ADR-0027 corollary 2). New error
`InvalidPartyConsent`. Foundry: happy-path now signs as both parties; new
`missingPartyConsent`/`wrongPartyConsent` reverts; full suite 726 green.

**Deferred to the wave redeploy** (no redeploy until the wave is green): the TS encoder
(`encodeAssertJointAgreement`) + the demo-jp caller (`submitJointAssertionOnChain`) must add the two
party-consent signatures and drop the supplied ref. Until redeploy the live demo runs on the OLD
deployed registry + OLD encoder, unaffected. Option (b) (verifyAuthorizationForCall exact-call
sub-delegation, using RW1-4 + the RW1-4b CallDataHashEnforcer) remains available for a future
delegation-based consent variant.

### RW1-2 — `AgreementRegistry.updateStatus` proves the signers are the parties — **CONTRACT DONE**

`updateStatus` previously took a caller-supplied `signer1`/`signer2` set and verified only their
signatures over an off-chain `transitionStructHash` — the contract conceded (in its own docstring) that
it "DOES NOT enforce identity of signer1/signer2 against the on-chain row." A nonzero, well-signed
payload from *any* keypair could transition an agreement (ADR-0027: a caller-supplied signer set is not
authority).

Now the caller **reveals** the two parties + the commitment components (`party1`, `party2`,
`issuerCommitment`, `termsCommitment`, `scheduleCommitment`, `commitmentSalt`) on the `StatusUpdatePayload`;
`updateStatus` **recomputes** the agreement commitment with register's exact formula
(`keccak256(abi.encode(keccak256(party1‖party2), issuerCommitment, termsCommitment, scheduleCommitment,
salt))`) and reverts `CommitmentMismatch` unless it equals the row's commitment — so the revealed parties
are provably the agreement's parties. Then each signer must BE one of those two parties (new error
`SignerNotParty`); bilateral transitions require the two signers be distinct parties. The on-chain row
still stores NO party SAs — **AR-11 governs `register()` calldata only**; a status transition is already
a public state change that names its signers, so revealing the parties here leaks nothing new.

Foundry: the four existing transition tests now thread the registered salt + reveal; new
`signerNotParty` / `secondSignerNotParty` / `revealedComponentMismatch` reverts. AgreementRegistry suite
11 green; full forge suite green (the one unrelated failure is a concurrent half-applied
`DeployAuthorityResolution` edit, not this wave).

**Deferred to the wave redeploy:** the TS `agreements` status-transition encoder + any demo-jp caller
must populate the revealed party/component fields (they already hold them to build the commitment). Live
demo runs on the OLD deployed registry until the wave redeploys.

### RW1-3 (later) — canonical transition digest recompute

`updateStatus` still accepts a caller-supplied `transitionStructHash` that the parties signed (RW1-2 binds
*who* signs; RW1-3 binds *what* they sign). Recompute the EIP-712 transition digest on-chain from
`(agreementCommitment, toStatus, nullifier)` + domain constants rather than trusting the supplied hash,
giving one canonical digest model across the registries — gate-checked by `check:eip712-typehash-equality`
once the TS side lands (add a `TRANSITION_TYPEHASH` + the RW1-1 `JOINT_CONSENT_TYPEHASH` to the gate).

### RW1-4b (optional, with RW1-1) — port `CallDataHashEnforcer`

For true exact-calldata pinning (not just target+method), port smart-agent's `CallDataHashEnforcer`
(keccak256 of the call's calldata as a caveat) so a consent sub-delegation can pin the precise
`assertJointAgreement` calldata, not merely its selector + target.

## Reference: smart-agent patterns to port

From `/home/barb/smart-agent` (branch `003-intent-marketplace-proposal`):

- **PORT — `packages/contracts/src/enforcers/CallDataHashEnforcer.sol`:** exact-call sub-delegation
  binding via `keccak256(calldata)`. Our enforcer set has target/method/value/timestamp/quorum but no
  calldata-hash pin; this is the missing primitive for RW1-1's exact-call consent.
- **PORT — the "P4: sensitive ops require exact-call sub-delegation" doctrine** (`specs/005-pledge-honor/threat-model.md`):
  sensitive entrypoints are reachable only through a sub-delegation pinned to target + calldata hash +
  short timestamp window. Our RW1-1 makes `assertJointAgreement` such a sensitive op.
- **DELIBERATELY DIVERGE:** smart-agent enforces exact-call only at *live redemption* (the
  enforcer `beforeHook` reverts in the redeem tx). We ADD a **view** `verifyAuthorizationForCall` so a
  registry (`assertJointAgreement`) can check the authorization *inside its own call* without a separate
  redeem tx — via `staticcall` of the same hooks, fail-closed. Why: the consent check must happen in the
  registry's transaction, not a prior one, to bind consent to the exact assertion being stored.

## Out of scope

N1 governance-key rotation (ADR-0028, production wave); the off-chain recognition / vault model (spec
247/248); intent-spine packages (RW1-5, separate maturity work).
