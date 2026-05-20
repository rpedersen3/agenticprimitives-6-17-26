// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "../ICaveatEnforcer.sol";
import "../libraries/SignatureSlotRecovery.sol";

/**
 * @title QuorumEnforcer
 * @notice N-of-M signature aggregation over a payload hash. Adopts
 *         Safe's `checkSignatures` packing format verbatim so:
 *           (a) the agenticprimitives multi-sig SDK can interoperate
 *               with Safe-shaped signature blobs from external tooling,
 *           (b) we inherit Safe's battle-tested anti-duplicate scheme
 *               (sorted-ascending signer ordering) without inventing
 *               our own, and
 *           (c) `v` values for the four signature types (ECDSA,
 *               eth_sign, pre-approved hash, ERC-1271) match Safe's
 *               disambiguation so a single quorum verifier supports
 *               every signer category we care about.
 *
 * @dev terms = abi.encode(
 *        address[] signerSet,            // signers bound at delegation-mint time
 *        uint8 threshold,                // minimum valid sigs required
 *        address approvedHashRegistry    // companion contract for v=1 path
 *      )
 *
 *      args = abi.encode(
 *        bytes32 payloadHash,            // what the signers signed (typically the
 *                                        // EIP-712 typed-data hash of the action)
 *        bytes signatures                // packed sig blob, sorted-ascending by signer
 *      )
 *
 *      Sig blob layout per entry (65 bytes per slot in the sorted region):
 *        {32 r/data}{32 s/data}{1 v/type}
 *
 *      v-byte type discrimination:
 *         v == 27 || v == 28  → ECDSA over `payloadHash`
 *         v >  30             → eth_sign ECDSA: signer pre-wrapped payloadHash with
 *                               "\x19Ethereum Signed Message:\n32"; v is passed as
 *                               {31, 32} (subtract 4 to recover).
 *         v == 1              → pre-approved hash; r holds the signer address
 *                               (left-padded); signer must have called
 *                               ApprovedHashRegistry.approveHash(payloadHash).
 *         v == 0              → ERC-1271 contract signature; r holds signer address
 *                               (left-padded), s holds the byte offset into the
 *                               `signatures` blob where the length-prefixed
 *                               dynamic sig tail starts.
 *
 *      v == 2 (RIP-7212 secp256r1 / passkey) is reserved but not
 *      implemented here — passkey-only signers can use the `v == 1`
 *      approveHash escape hatch (call `ApprovedHashRegistry.approveHash`
 *      from the passkey-owned account in the same userOp as the
 *      delegation redemption, batched via `MultiSendCallOnly`).
 *
 *      Sorted-ascending signer ordering is the anti-duplicate
 *      mechanism: every pair of adjacent recovered signers must
 *      satisfy `prev < curr`. This eliminates the need for a separate
 *      "seen" mapping and ensures a malicious caller can't submit the
 *      same signer's signature twice to inflate the threshold count.
 *
 *      Each recovered signer must be in `signerSet`. Membership is the
 *      only authorization check this enforcer does — runtime
 *      eligibility (e.g. "is this signer still an active owner of the
 *      smart account?") is intentionally out of scope so the enforcer
 *      stays composable with whatever upstream authority model the
 *      delegation chain enforces.
 *
 *      Only the first `threshold` slots are checked. Excess entries
 *      beyond the threshold are ignored — callers SHOULD NOT pad blobs
 *      unnecessarily as calldata cost scales linearly.
 */
contract QuorumEnforcer is ICaveatEnforcer {
    error InsufficientQuorum(uint256 supplied, uint8 threshold);
    error UnauthorizedSigner(address signer);
    error DuplicateOrUnsortedSigner(address signer);

    function beforeHook(
        bytes calldata terms,
        bytes calldata args,
        bytes32, // delegationHash
        address, // delegator
        address, // redeemer
        address, // target
        uint256, // value
        bytes calldata // callData
    ) external view override {
        (address[] memory signerSet, uint8 threshold, address approvedHashRegistry) =
            abi.decode(terms, (address[], uint8, address));
        (bytes32 payloadHash, bytes memory signatures) = abi.decode(args, (bytes32, bytes));

        if (signatures.length < uint256(threshold) * 65) {
            revert InsufficientQuorum(signatures.length / 65, threshold);
        }

        address prev;
        for (uint256 i; i < threshold; i++) {
            address signer = SignatureSlotRecovery.recoverFromSlot(
                payloadHash,
                signatures,
                i,
                approvedHashRegistry
            );

            // Sorted-ascending check (also rejects duplicates).
            if (signer <= prev) revert DuplicateOrUnsortedSigner(signer);
            prev = signer;

            // Membership in the signer set bound at delegation time.
            if (!_inSet(signer, signerSet)) revert UnauthorizedSigner(signer);
        }
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
    ) external pure override {}

    function _inSet(address signer, address[] memory set) internal pure returns (bool) {
        for (uint256 i; i < set.length; i++) {
            if (set[i] == signer) return true;
        }
        return false;
    }
}
