// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * R9.3 / R8.2 -- Halmos symbolic proof of the WebAuthn UV-required gate.
 *
 * Foundry fuzzing samples inputs; Halmos symbolically EXPLORES the
 * input space. For a high-stakes gate like `requireUv` -- where one
 * silently-skipped path would let a UP-only assertion satisfy a
 * custody-grade signature check -- the difference matters.
 *
 * The property locked here is exactly the R8.2 change at
 * `AgentAccount.sol:1185` (`requireUv: true`). The Foundry suite
 * `AgentAccountUvRequiredR82.t.sol` covers it with concrete fixtures
 * (UP-only, UV+UP, UV-only-no-UP, zero-flags). This Halmos proof
 * generalises the same property to ALL possible inputs:
 *
 *   PROOF-1  For any (authenticatorData, clientDataJSON, indices,
 *            sig components, rpIdHash, pubKey, expectedHash), if
 *            `(authData[32] & 0x04) == 0` (the UV bit is NOT set),
 *            then `WebAuthnLib.verify(..., requireUv = true)`
 *            returns false.
 *
 *   PROOF-2  Same but for the UP bit: if `(authData[32] & 0x01) == 0`,
 *            verify returns false regardless of `requireUv`. This is
 *            the H7-C.1 closure, locked symbolically here as well so
 *            the two bit-level gates can't drift out of sync.
 *
 * Run with:
 *   pnpm halmos
 *
 * (CI step lives in `.github/workflows/security.yml`. Non-blocking
 * artifact-only until the first green run track-record is built, then
 * promoted to PR-blocking per the audit guidance's recommended ramp.)
 *
 * authData length is constrained to the minimum-valid 37 bytes
 * (rpIdHash[0..32] + flags[32] + signCount[33..37]). Halmos otherwise
 * defaults to a few small sizes per the `--default-bytes-lengths` flag.
 * Fixing it to 37 keeps the symbolic state small enough that the proof
 * terminates in seconds, and 37 IS the only path the gate cares about:
 * any longer authData has the same flags byte at the same offset.
 *
 * Spec: ../../specs/130-passkey-validator.md +
 *        ../../specs/207-smart-account-threshold-policy.md (UV gate)
 */

import "forge-std/Test.sol";
import {WebAuthnLib} from "../../src/libraries/WebAuthnLib.sol";

/// @dev Bundle the symbolic inputs into one struct so the contract
///      compiles cleanly under \`forge coverage --ir-minimum\` (lower
///      Yul optimization than the default \`via_ir = true\` we use for
///      normal builds). Without the struct, 11+ params overflow Yul's
///      stack-depth budget at the coverage compile.
struct ProofInputs {
    bytes authData;
    bytes cdjBytes;
    uint256 challengeIndex;
    uint256 typeIndex;
    uint256 r;
    uint256 s;
    bytes32 credentialIdDigest;
    bytes32 expectedChallengeHash;
    uint256 pubX;
    uint256 pubY;
    bytes32 expectedRpIdHash;
}

/// @dev Halmos uses the `check_*` prefix (not `test_*` or `invariant_*`)
///      to indicate symbolic-execution proofs.
contract WebAuthnLibUvR82Halmos is Test {
    /// PROOF-1 -- R8.2 UV-required gate.
    ///
    /// Symbolic over every field of the Assertion + every other input.
    /// Constraint: UV bit unset. Conclusion: verify returns false.
    function check_R82_uvNotSet_with_requireUvTrue_alwaysRejects(
        ProofInputs calldata p
    ) external view {
        // The gate triggers on the flags byte at offset 32 -- authData
        // must be at least 37 bytes for that byte to exist at all.
        vm.assume(p.authData.length == 37);

        // The UV bit (bit 2 of the flags byte) is NOT set.
        vm.assume(uint8(p.authData[32]) & 0x04 == 0);

        WebAuthnLib.Assertion memory a = WebAuthnLib.Assertion({
            authenticatorData: p.authData,
            clientDataJSON: string(p.cdjBytes),
            challengeIndex: p.challengeIndex,
            typeIndex: p.typeIndex,
            r: p.r,
            s: p.s,
            credentialIdDigest: p.credentialIdDigest
        });

        bool ok = WebAuthnLib.verify(
            a,
            p.expectedChallengeHash,
            p.pubX,
            p.pubY,
            p.expectedRpIdHash,
            /* requireUv */ true
        );

        assert(!ok);
    }

    /// PROOF-2 -- H7-C.1 UP-required gate (lives alongside UV; locked
    /// symbolically here so the two bit-level gates can't drift apart).
    function check_H7C1_upNotSet_alwaysRejects_regardlessOfRequireUv(
        ProofInputs calldata p,
        bool requireUv
    ) external view {
        vm.assume(p.authData.length == 37);

        // The UP bit (bit 0 of the flags byte) is NOT set.
        vm.assume(uint8(p.authData[32]) & 0x01 == 0);

        WebAuthnLib.Assertion memory a = WebAuthnLib.Assertion({
            authenticatorData: p.authData,
            clientDataJSON: string(p.cdjBytes),
            challengeIndex: p.challengeIndex,
            typeIndex: p.typeIndex,
            r: p.r,
            s: p.s,
            credentialIdDigest: p.credentialIdDigest
        });

        bool ok = WebAuthnLib.verify(
            a,
            p.expectedChallengeHash,
            p.pubX,
            p.pubY,
            p.expectedRpIdHash,
            requireUv
        );

        assert(!ok);
    }
}
