// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Test.sol";
import {P256Verifier} from "../../src/libraries/P256Verifier.sol";

/**
 * H7-C.2 / CON-P256-001 regression test.
 *
 * The previous library silently fell through to the Daimo verifier at
 * the hardcoded address 0xc2b78104907F722DABAc4C69f826a522B2754De4.
 * We test:
 *   1. Without RIP-7212 mocked, verify returns false (no silent fallback).
 *   2. With RIP-7212 mocked to return success, verify returns true.
 *   3. Even if code is deployed at the legacy Daimo address, verify
 *      still returns false — the address is no longer trusted.
 */

// Mock contract that mimics the Daimo verifier returning success (1).
contract DaimoSuccessMock {
    fallback(bytes calldata) external returns (bytes memory) {
        return abi.encode(uint256(1));
    }
}

contract P256VerifierHarness {
    function verify(bytes32 h, uint256 r, uint256 s, uint256 x, uint256 y) external view returns (bool) {
        return P256Verifier.verify(h, r, s, x, y);
    }
}

contract P256VerifierTest is Test {
    P256VerifierHarness internal lib;
    address internal constant LEGACY_DAIMO = 0xc2b78104907F722DABAc4C69f826a522B2754De4;
    address internal constant RIP7212 = address(0x100);

    function setUp() public {
        lib = new P256VerifierHarness();
    }

    function test_no_silent_fallback_to_legacy_daimo_address() public {
        // Deploy a mock at the legacy Daimo address that ALWAYS returns
        // success. If the library still trusts that address, verify would
        // return true. With H7-C.2 closure, the address is no longer
        // consulted and verify returns false.
        DaimoSuccessMock mock = new DaimoSuccessMock();
        vm.etch(LEGACY_DAIMO, address(mock).code);
        bool ok = lib.verify(bytes32(uint256(1)), 1, 2, 3, 4);
        assertFalse(ok, "library MUST NOT consult the legacy Daimo address after H7-C.2");
    }

    function test_rip7212_success_returns_true() public {
        // Mock the RIP-7212 precompile to return success.
        DaimoSuccessMock mock = new DaimoSuccessMock();
        vm.etch(RIP7212, address(mock).code);
        bool ok = lib.verify(bytes32(uint256(1)), 1, 2, 3, 4);
        assertTrue(ok, "RIP-7212 precompile success must verify");
    }

    function test_no_rip7212_returns_false() public {
        // RIP-7212 precompile call returns empty (the default in tests
        // without etch). Verifier MUST return false — no silent fallback.
        bool ok = lib.verify(bytes32(uint256(1)), 1, 2, 3, 4);
        assertFalse(ok, "without RIP-7212, verify must return false (no silent fallback)");
    }
}
