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

### RW1-1 (next) — `AttestationRegistry.assertJointAgreement` proves consent

Replace "bilateralConsentRef != 0 + issuer signature, consent is the caller's responsibility" with a
verified two-party consent: either (a) both party signatures over the canonical joint-agreement digest,
or (b) a `DelegationManager.verifyAuthorizationForCall(...)` authorization for the exact
`assertJointAgreement` call (an exact-call sub-delegation from each party). Storing a nonzero ref is not
consent (ADR-0027 corollary 2).

### RW1-2 / RW1-3 (later) — Agreement status party-binding + canonical digest recompute

`updateStatus` proves the signers are members of the party commitment (reveal or membership proof), and
every registry recomputes the EIP-712 digest from calldata + domain constants rather than accepting a
caller-supplied `attestationStructHash` (one canonical digest model; gate-checked by
`check:eip712-typehash-equality` once both sides exist).

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
