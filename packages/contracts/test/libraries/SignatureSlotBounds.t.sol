// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Test.sol";
import {SignatureSlotRecovery} from "../../src/libraries/SignatureSlotRecovery.sol";

/**
 * H7-C.3 / CON-SIG-SLOT-001/-002 regression tests.
 *
 * Prior to the bounds checks, a malformed v=0 (ERC-1271) or v=2 (WebAuthn)
 * slot could claim a sigOffset+sigLen that extended past the end of
 * `signatures` — and the assembly load would happily read undefined
 * memory and pass garbage to the downstream verifier. Solidity's behavior
 * is undefined in that path.
 *
 * These tests build a deliberately-malformed slot blob whose s-field
 * points past the array end and assert the library reverts with
 * `SigTailOutOfBounds` rather than silently reading garbage.
 */

contract SignatureSlotHarness {
    function recover(
        bytes32 payloadHash,
        bytes memory signatures,
        uint256 index,
        address approvedHashRegistry
    ) external view returns (address) {
        return SignatureSlotRecovery.recoverFromSlot(payloadHash, signatures, index, approvedHashRegistry);
    }
}

contract SignatureSlotBoundsTest is Test {
    SignatureSlotHarness internal h;

    function setUp() public {
        h = new SignatureSlotHarness();
    }

    /// Build a 65-byte slot with given (r, s, v).
    function _slot(bytes32 r, bytes32 s, uint8 v) internal pure returns (bytes memory out) {
        out = new bytes(65);
        for (uint256 i; i < 32; i++) {
            out[i] = r[i];
            out[32 + i] = s[i];
        }
        out[64] = bytes1(v);
    }

    function test_v0_revert_on_out_of_bounds_sigOffset() public {
        // 1 slot (65 bytes) + 32-byte length word claiming 1000 bytes of tail.
        // The slot's `s` points to offset 65 (where the length word lives).
        // The length says 1000 but only 32 bytes exist after it → out of bounds.
        bytes memory slot = _slot(bytes32(uint256(0xDEAD)), bytes32(uint256(65)), 0);
        bytes memory tailLen = abi.encode(uint256(1000));
        bytes memory packed = bytes.concat(slot, tailLen);

        vm.expectRevert(abi.encodeWithSelector(
            SignatureSlotRecovery.SigTailOutOfBounds.selector,
            uint8(0), uint256(65), uint256(1000), packed.length
        ));
        h.recover(bytes32(uint256(1)), packed, 0, address(0));
    }

    function test_v0_revert_when_length_prefix_itself_out_of_bounds() public {
        // s points past the END of the buffer entirely — even the length
        // word can't be read.
        bytes memory slot = _slot(bytes32(uint256(0xDEAD)), bytes32(uint256(10_000)), 0);

        vm.expectRevert(abi.encodeWithSelector(
            SignatureSlotRecovery.SigTailOutOfBounds.selector,
            uint8(0), uint256(10_000), uint256(0), slot.length
        ));
        h.recover(bytes32(uint256(1)), slot, 0, address(0));
    }

    function test_v2_revert_on_out_of_bounds_sigOffset() public {
        bytes memory slot = _slot(bytes32(uint256(0xBEEF)), bytes32(uint256(65)), 2);
        bytes memory tailLen = abi.encode(uint256(1000));
        bytes memory packed = bytes.concat(slot, tailLen);

        vm.expectRevert(abi.encodeWithSelector(
            SignatureSlotRecovery.SigTailOutOfBounds.selector,
            uint8(2), uint256(65), uint256(1000), packed.length
        ));
        h.recover(bytes32(uint256(1)), packed, 0, address(0));
    }

    function test_v2_revert_when_length_prefix_itself_out_of_bounds() public {
        bytes memory slot = _slot(bytes32(uint256(0xBEEF)), bytes32(uint256(10_000)), 2);

        vm.expectRevert(abi.encodeWithSelector(
            SignatureSlotRecovery.SigTailOutOfBounds.selector,
            uint8(2), uint256(10_000), uint256(0), slot.length
        ));
        h.recover(bytes32(uint256(1)), slot, 0, address(0));
    }
}
