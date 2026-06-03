// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "../agency/ICaveatEnforcer.sol";

/**
 * @title CallDataHashEnforcer
 * @notice Pins a delegation to EXACTLY one calldata payload — the exact-call
 *         binding ADR-0027 / spec 249 (RW1-4b) needs for sensitive ops.
 * @dev terms = abi.encode(bytes32 expectedHash), where
 *      `expectedHash == keccak256(callData)` for the single call this
 *      delegation authorizes. `beforeHook` recomputes `keccak256(callData)`
 *      and reverts on mismatch.
 *
 *      Ported from smart-agent's `CallDataHashEnforcer` (the "P4 — sensitive
 *      ops require exact-call sub-delegation" doctrine). Combined with
 *      `AllowedTargetsEnforcer` (target) + a tight `TimestampEnforcer`
 *      window + `ValueEnforcer`, a consent sub-delegation can pin the precise
 *      call — not merely its selector — so a registry that checks
 *      `DelegationManager.verifyAuthorizationForCall(...)` binds consent to the
 *      exact assertion being stored (RW1-1).
 *
 *      R6.7 — Stateless validator: hooks are `pure`, the contract has zero
 *      storage, so no `whenNotPaused` is needed; the DM-side pause check in
 *      `DelegationManager.redeemDelegation` gates all reachable enforcer
 *      dispatch, and the read-only `verifyAuthorizationForCall` evaluates it
 *      via `staticcall`.
 */
contract CallDataHashEnforcer is ICaveatEnforcer {
    error BadTermsLength();
    error CallDataMismatch(bytes32 expected, bytes32 actual);

    function beforeHook(
        bytes calldata terms,
        bytes calldata,
        bytes32,
        address,
        address,
        address,
        uint256,
        bytes calldata callData
    ) external pure override {
        if (terms.length != 32) revert BadTermsLength();
        bytes32 expected = abi.decode(terms, (bytes32));
        bytes32 actual = keccak256(callData);
        if (expected != actual) revert CallDataMismatch(expected, actual);
    }

    function afterHook(
        bytes calldata,
        bytes calldata,
        bytes32,
        address,
        address,
        address,
        uint256,
        bytes calldata
    ) external pure override {
        // No post-execution check needed.
    }
}
