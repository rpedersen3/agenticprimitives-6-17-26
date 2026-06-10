// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "./P256Verifier.sol";

/**
 * @title WebAuthnLib
 * @notice Pure-computation library for verifying a WebAuthn assertion against
 *         an expected challenge hash and a registered P-256 public key.
 *
 *   Reconstructs the signing message:
 *     signingMessage = authenticatorData || sha256(clientDataJSON)
 *     signingHash    = sha256(signingMessage)
 *
 *   Checks (H7-C.1 / CON-WEBAUTHN-001 closure):
 *     - `authData[0..32]` (rpIdHash) EQUALS `expectedRpIdHash`
 *       — kills cross-RP signing-oracle attacks where an attacker controls
 *         a signing oracle at a different RP whose origin happens to be
 *         under their control. WITHOUT this check the on-chain verifier
 *         accepted any P-256 signature over `sha256(authData || sha256(cdj))`
 *         regardless of which RP produced it.
 *     - User-Present bit set (`authData[32] & 0x01 == 0x01`).
 *     - If `requireUv = true`, User-Verified bit set (`authData[32] & 0x04 == 0x04`).
 *     - `clientDataJSON` contains `"type":"webauthn.get"` at `typeIndex`.
 *     - `clientDataJSON` contains `"challenge":"<base64url(expectedHash)>"`
 *       at `challengeIndex`.
 *     - `P256Verifier.verify(signingHash, r, s, x, y)` returns true.
 *
 *   The `clientDataJSON.origin` allowlist is NOT pinned here. Origin
 *   semantics depend on multi-frontend account policy and live in the
 *   account's stored policy if it adopts an allowlist — verifiers that
 *   want origin-pinning supply a pre-hashed origin via the consumer's
 *   own logic.
 *
 *   Used by both AgentAccount (native passkey path) and the standalone
 *   PasskeyValidator (for external 1271-style verification).
 */
library WebAuthnLib {
    /// @dev secp256r1 (P-256) curve order n ÷ 2 — the low-s malleability bound (WA-1).
    ///      RIP-7212 accepts BOTH (r, s) and (r, n−s) for the same message, so without
    ///      this bound a second valid signature always exists. Any path that treats a
    ///      signature as unique (quorum slot recovery, dedup) would be malleable.
    uint256 internal constant P256_N_DIV_2 =
        0x7fffffff800000007fffffffffffffffde737d56d38bcf4279dce5617e3192a8;

    /// @notice A WebAuthn-wrapped P-256 signature bundle.
    struct Assertion {
        bytes   authenticatorData;
        string  clientDataJSON;
        uint256 challengeIndex;
        uint256 typeIndex;
        uint256 r;
        uint256 s;
        bytes32 credentialIdDigest;
    }

    /// @notice Verify that `assertion` is a valid WebAuthn signature over
    ///         `expectedChallengeHash` produced by `(pubX, pubY)`, AND was
    ///         produced for the RP whose ID hashes to `expectedRpIdHash`,
    ///         AND has the User-Present (and optionally User-Verified) bits set.
    ///
    /// @param assertion             The decoded WebAuthn assertion bundle.
    /// @param expectedChallengeHash The 32-byte challenge the assertion must sign.
    /// @param pubX, pubY            The registered P-256 public key (uncompressed).
    /// @param expectedRpIdHash      `sha256(rpId)` of the RP the credential was
    ///                              registered against. Pinning this kills the
    ///                              cross-RP signing-oracle vector.
    /// @param requireUv             Whether the User-Verified bit must be set
    ///                              (the account's policy choice).
    function verify(
        Assertion memory assertion,
        bytes32 expectedChallengeHash,
        uint256 pubX,
        uint256 pubY,
        bytes32 expectedRpIdHash,
        bool requireUv
    ) internal view returns (bool) {
        if (!_checkAuthData(assertion.authenticatorData, expectedRpIdHash, requireUv)) {
            return false;
        }
        if (!_checkClientData(assertion.clientDataJSON, assertion.typeIndex, assertion.challengeIndex, expectedChallengeHash)) {
            return false;
        }
        // WA-1: enforce low-s. RIP-7212 verifies both (r, s) and (r, n−s); rejecting
        // the high-s half makes the assertion signature canonical, closing P-256
        // malleability for every caller (native ERC-1271 + custody-quorum slot recovery).
        if (assertion.s > P256_N_DIV_2) {
            return false;
        }
        bytes32 cdjHash = sha256(bytes(assertion.clientDataJSON));
        bytes32 signingHash = sha256(abi.encodePacked(assertion.authenticatorData, cdjHash));
        return P256Verifier.verify(signingHash, assertion.r, assertion.s, pubX, pubY);
    }

    /// @dev Validates the authenticatorData header per WebAuthn spec §6.1:
    ///      bytes [0..32]  = rpIdHash
    ///      byte  [32]     = flags (bit 0 UP, bit 2 UV, bit 6 AT, bit 7 ED)
    ///      bytes [33..36] = signCount (big-endian u32; informational, not checked here)
    function _checkAuthData(
        bytes memory authData,
        bytes32 expectedRpIdHash,
        bool requireUv
    ) private pure returns (bool) {
        if (authData.length < 37) return false;
        // Compare 32-byte rpIdHash prefix.
        bytes32 actualRpIdHash;
        assembly {
            // authData is `bytes`; first 32 bytes after the length word are the rpIdHash.
            actualRpIdHash := mload(add(authData, 0x20))
        }
        if (actualRpIdHash != expectedRpIdHash) return false;
        uint8 flags = uint8(authData[32]);
        if (flags & 0x01 == 0) return false; // UP not set
        if (requireUv && flags & 0x04 == 0) return false; // UV required but not set
        return true;
    }

    /// @dev Validates the two structural invariants of clientDataJSON:
    ///      (1) starts with `"type":"webauthn.get"` at typeIndex
    ///      (2) has `"challenge":"<base64url(hash)>"` at challengeIndex.
    function _checkClientData(
        string memory cdj,
        uint256 typeIndex,
        uint256 challengeIndex,
        bytes32 hash
    ) private pure returns (bool) {
        bytes memory buf = bytes(cdj);
        bytes memory typeExpected = bytes('"type":"webauthn.get"');
        if (typeIndex + typeExpected.length > buf.length) return false;
        for (uint256 i; i < typeExpected.length; i++) {
            if (buf[typeIndex + i] != typeExpected[i]) return false;
        }
        bytes memory challengePrefix = bytes('"challenge":"');
        if (challengeIndex + challengePrefix.length + 43 + 1 > buf.length) return false;
        for (uint256 i; i < challengePrefix.length; i++) {
            if (buf[challengeIndex + i] != challengePrefix[i]) return false;
        }
        if (buf[challengeIndex + challengePrefix.length + 43] != bytes1('"')) return false;

        // Decode the 43 base64url chars that follow the prefix and compare to `hash`.
        return _base64UrlEqualsHash(buf, challengeIndex + challengePrefix.length, hash);
    }

    /// @dev Read 43 base64url chars starting at `offset` in `buf`, decode, and
    ///      assert the 32 decoded bytes equal `hash`.
    function _base64UrlEqualsHash(bytes memory buf, uint256 offset, bytes32 hash) private pure returns (bool) {
        uint256 acc;
        uint256 bits;
        uint256 outIdx;
        bytes memory decoded = new bytes(32);
        for (uint256 i; i < 43; i++) {
            int256 v = _b64UrlCharVal(buf[offset + i]);
            if (v < 0) return false;
            acc = (acc << 6) | uint256(v);
            bits += 6;
            while (bits >= 8 && outIdx < 32) {
                bits -= 8;
                decoded[outIdx++] = bytes1(uint8((acc >> bits) & 0xff));
            }
        }
        if (outIdx != 32) return false;
        for (uint256 i; i < 32; i++) {
            if (decoded[i] != hash[i]) return false;
        }
        return true;
    }

    function _b64UrlCharVal(bytes1 c) private pure returns (int256) {
        uint8 b = uint8(c);
        if (b >= 0x41 && b <= 0x5a) return int256(uint256(b - 0x41));
        if (b >= 0x61 && b <= 0x7a) return int256(uint256(b - 0x61 + 26));
        if (b >= 0x30 && b <= 0x39) return int256(uint256(b - 0x30 + 52));
        if (b == 0x2d) return 62;
        if (b == 0x5f) return 63;
        return -1;
    }
}
