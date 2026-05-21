# `QuorumEnforcer` — Security & Architecture Audit

**Status:** shipped
**Last refreshed:** 2026-05-21
**Owners:** delegation package CODEOWNERS + agent-account CODEOWNERS
**Registry entry:** [`docs/architecture/enforcer-registry/enforcers.json`](../../../../docs/architecture/enforcer-registry/enforcers.json) (entry: `QuorumEnforcer`)
**Live address (Base Sepolia):** `0x3418A5297C75989000985802B8ab01229CDDDD24`
**Spec:** [`specs/207-smart-account-threshold-policy.md`](../../../../specs/207-smart-account-threshold-policy.md)

## 1. Charter

n-of-m Safe-compatible signature aggregation as a caveat. The delegation's `args` carries packed sorted-ascending owner signatures; the enforcer verifies `threshold` of them recover to addresses in the bound `signers` set, then permits the redemption.

This is the **agenticprimitives-only** enforcer — DTK does not have an equivalent because DTK frames multi-sig as account-shaped. We make it caveat-shaped (see [doctrine](../../../../specs/207-smart-account-threshold-policy.md) § 12) so threshold-policy threads through delegations.

## 2. Security invariants

- Signatures are sorted-ascending by recovered address (anti-duplicate scheme; matches Safe convention).
- Recovery uses `SignatureSlotRecovery` library — shared with the `ThresholdValidator` admin path so signature shapes are uniform.
- Four signature paths supported:
  - v=27/28 → ECDSA over the payload hash directly
  - v>30 → eth_sign EIP-191 wrapped (v - 4 = recovery)
  - v=1 → pre-approved hash via `ApprovedHashRegistry` (passkey-only or hardware-wallet signers participating in quorum without producing ECDSA)
  - v=0 → ERC-1271 contract sig (signer is a smart account)
- Bound `signers` set is set at delegation creation; redeemer cannot widen.
- `threshold ≤ signers.length` (caveat-builder enforces; redundant on-chain check).
- `threshold ≤ 255` (uint8 packing).

## 3. Threat model

| Threat | Likelihood | Impact | Mitigation | Status |
| --- | --- | --- | --- | --- |
| Duplicate signer (sig replay within quorum) | High by design | High | Sorted-ascending invariant; `signer <= prev` reverts | Covered |
| Signer not in bound set | Medium | High | `_inSet` per-signer check | Covered |
| Stale ApprovedHashRegistry approval | Medium | Medium | Per-signer + per-hash approval; spam-resistant by construction (only approvals from signers in the bound set count) | Covered |
| ERC-1271 sig from compromised smart-account signer | Low | High | Outside the enforcer's scope — the signer contract's own auth gate is the trust root | Documented |
| Signature malleability | Low | Low | ECDSA uses canonical s-value (ecrecover handles); v variants don't change recovered address | Covered |

## 4. DTK / smart-agent parity

**DTK:** NONE. Multi-sig in DTK is account-shape (gnosis-safe-style), not caveat-shape. This is a deliberate divergence — see [dtk-alignment-audit.md § 5.4](../../../../docs/architecture/dtk-alignment-audit.md). DTK's `ExecuteByMultipleEnforcer` provides multi-redeemer support but is not equivalent.

**smart-agent:** `QuorumEnforcer.sol` — same shape; agenticprimitives ports the contract + SignatureSlotRecovery helper.

## 5. Test posture

Forge tests: `apps/contracts/test/QuorumEnforcer.t.sol` covers:
- single-sig (threshold=1)
- multi-sig threshold=2 of 3
- unsorted sig rejection
- duplicate signer rejection
- non-member signer rejection
- v=1 approved-hash path (with ApprovedHashRegistry)
- v=0 ERC-1271 path
- 8 tests total. Counts toward the 172 workspace total.

Property tests: none yet. Phase 7 should add fuzz over signer permutations.

## 6. Open findings

| ID | Severity | Finding | Status |
| --- | --- | --- | --- |
| QE-1 | P2 | Add property fuzz over signer permutations to catch off-by-one in sorted-asc invariant. | Open (phase 7) |
| QE-2 | P3 | SDK helper to compute the canonical payload hash for off-chain signing isn't yet documented for the v=0 ERC-1271 case (smart-account signers). | Open |

## 7. Cross-references

- [Registry entry](../../../../docs/architecture/enforcer-registry/enforcers.json)
- [`specs/207-smart-account-threshold-policy.md`](../../../../specs/207-smart-account-threshold-policy.md) — the doctrine motivating this enforcer's existence.
- Shared library: `apps/contracts/src/libraries/SignatureSlotRecovery.sol` — used by both this enforcer AND `ThresholdValidator`'s admin-action `_verifyQuorum`. Audit changes here affect both.
- Companion contract: [`ApprovedHashRegistry`](../ApprovedHashRegistry.sol) — required for the v=1 path.
