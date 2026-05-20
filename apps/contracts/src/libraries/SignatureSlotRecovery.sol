// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "../ApprovedHashRegistry.sol";
import {IERC1271} from "@openzeppelin/contracts/interfaces/IERC1271.sol";

/**
 * @title SignatureSlotRecovery
 * @notice Safe-compatible 65-byte signature-slot recovery, factored out
 *         of `QuorumEnforcer` so both the caveat path (via
 *         `QuorumEnforcer.beforeHook`) and the account-direct path
 *         (`AgentAccount.proposeAdmin` / `executeAdmin` / `cancelAdmin`)
 *         can verify quorum signatures without duplicating ~40 lines
 *         of ECDSA / ERC-1271 / approve-hash branching.
 *
 * @dev Per-slot layout (65 bytes):
 *        {32 r/data}{32 s/data}{1 v/type}
 *
 *      v-byte type discrimination (Safe-compatible):
 *         v == 27 || v == 28 → ECDSA over `payloadHash`
 *         v >  30            → eth_sign ECDSA (EIP-191 wrapped); v - 4 = recovery
 *         v == 1             → pre-approved hash via `approvedHashRegistry`;
 *                              r holds signer (left-padded), s unused
 *         v == 0             → ERC-1271 contract sig; r holds signer
 *                              (left-padded), s holds the byte offset into
 *                              `signatures` to a length-prefixed sig tail
 *
 *      Library is `internal` so the bodies inline into each calling contract
 *      (no DELEGATECALL hop, no proxy address juggling, no extra storage
 *      lookup). Both callers pay the gas for one copy each but the
 *      maintenance burden of "two diverging recovers" is eliminated.
 */
library SignatureSlotRecovery {
    error InvalidSignature(uint8 v);
    error ApprovedHashRequired(address signer);
    error ContractSigInvalid(address signer);

    bytes4 internal constant ERC1271_MAGIC = 0x1626ba7e;

    /**
     * @notice Recover the signer for the i-th 65-byte slot in
     *         `signatures`. Reverts with one of the library errors on
     *         malformed input or failed sub-checks; returns the signer
     *         address on success.
     *
     * @param payloadHash             The hash the signer signed.
     * @param signatures              Packed sig blob (n * 65 bytes + optional
     *                                ERC-1271 sig tails appended after).
     * @param index                   Zero-based slot index to recover.
     * @param approvedHashRegistry    Address of the v=1 path's companion
     *                                registry. Pass `address(0)` if the
     *                                caller does not want to allow v=1 sigs
     *                                (e.g. quorum-of-owners admin paths
     *                                that don't accept pre-approved hashes).
     */
    function recoverFromSlot(
        bytes32 payloadHash,
        bytes memory signatures,
        uint256 index,
        address approvedHashRegistry
    ) internal view returns (address signer) {
        bytes32 r;
        bytes32 s;
        uint8 v;
        uint256 offset = index * 65;
        assembly {
            let pos := add(signatures, add(0x20, offset))
            r := mload(pos)
            s := mload(add(pos, 0x20))
            v := byte(0, mload(add(pos, 0x40)))
        }

        if (v == 0) {
            // ERC-1271 contract signature. r holds the signer
            // (left-padded); s holds the offset into `signatures` to a
            // (length, blob) tail.
            signer = address(uint160(uint256(r)));
            uint256 sigOffset = uint256(s);
            uint256 sigLen;
            assembly {
                sigLen := mload(add(signatures, add(0x20, sigOffset)))
            }
            bytes memory dyn = new bytes(sigLen);
            assembly {
                let src := add(signatures, add(0x40, sigOffset))
                let dst := add(dyn, 0x20)
                for { let j := 0 } lt(j, sigLen) { j := add(j, 0x20) } {
                    mstore(add(dst, j), mload(add(src, j)))
                }
            }
            try IERC1271(signer).isValidSignature(payloadHash, dyn) returns (bytes4 magic) {
                if (magic != ERC1271_MAGIC) revert ContractSigInvalid(signer);
            } catch {
                revert ContractSigInvalid(signer);
            }
        } else if (v == 1) {
            // Pre-approved hash.
            if (approvedHashRegistry == address(0)) revert InvalidSignature(v);
            signer = address(uint160(uint256(r)));
            if (!ApprovedHashRegistry(approvedHashRegistry).isApproved(signer, payloadHash)) {
                revert ApprovedHashRequired(signer);
            }
        } else if (v == 27 || v == 28) {
            signer = ecrecover(payloadHash, v, r, s);
            if (signer == address(0)) revert InvalidSignature(v);
        } else if (v > 30) {
            // eth_sign-wrapped: signer prefixed with the "Ethereum Signed Message"
            // wrapper before signing. Subtract 4 from v to recover the original
            // recovery byte.
            bytes32 wrapped =
                keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", payloadHash));
            signer = ecrecover(wrapped, v - 4, r, s);
            if (signer == address(0)) revert InvalidSignature(v);
        } else {
            revert InvalidSignature(v);
        }
    }
}
