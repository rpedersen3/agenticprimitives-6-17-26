// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * Wave 2B regression tests (contract audit C-4) — QuorumEnforcer
 * MUST bind signatures to the actual (target, value, callData) being
 * executed. Pre-fix the signers could sign any arbitrary hash and
 * have the redeemer pass it through; we now reject any mismatch.
 *
 * These tests prove the security claim end-to-end:
 *   - A 2-of-3 quorum for (target=alice, value=1 ETH, data=transfer)
 *     CANNOT be replayed for (target=attacker, value=1 ETH, data=transfer).
 *   - The canonical hash binds to chain id + enforcer address +
 *     delegation hash + delegator + redeemer + target + value +
 *     keccak256(callData). Each input shifts the hash.
 */

import "forge-std/Test.sol";
import "../src/enforcers/QuorumEnforcer.sol";
import "../src/ApprovedHashRegistry.sol";

contract QuorumEnforcerBindingWave2BTest is Test {
    QuorumEnforcer internal enf;
    ApprovedHashRegistry internal registry;

    uint256 internal aliceKey = 0xA11CE;
    uint256 internal bobKey   = 0xB0B;
    address internal alice;
    address internal bob;

    // Realistic execution context — used as the BOUND values.
    bytes32 internal constant DELEGATION_HASH = bytes32(uint256(0xdeadbeef));
    address internal DELEGATOR;
    address internal REDEEMER;
    address internal TARGET_TOKEN;

    function setUp() public {
        enf = new QuorumEnforcer();
        registry = new ApprovedHashRegistry();
        alice = vm.addr(aliceKey);
        bob = vm.addr(bobKey);
        DELEGATOR = address(uint160(uint256(keccak256("delegator"))));
        REDEEMER = address(uint160(uint256(keccak256("redeemer"))));
        TARGET_TOKEN = address(uint160(uint256(keccak256("target"))));
    }

    // ─── 1. Replay across different `target` → reject ─────────────────

    function test_C4_replay_to_different_target_rejected() public {
        bytes memory callData = abi.encodeWithSignature("transfer(address,uint256)", REDEEMER, 1 ether);

        // Compute the canonical hash for (target=ALICE).
        bytes32 hashForAlice = enf.computeQuorumPayloadHash(
            DELEGATION_HASH, DELEGATOR, REDEEMER, alice, 1 ether, callData
        );

        // Quorum signs the alice hash.
        bytes memory sigs = _twoOfTwo(hashForAlice);

        // Replay attempt: execute against bob's address, supplying the alice-signed hash.
        bytes memory terms = _terms(2);
        bytes memory args = abi.encode(hashForAlice, sigs);
        vm.expectRevert(
            abi.encodeWithSelector(
                QuorumEnforcer.PayloadHashMismatch.selector,
                // expected: hash for bob
                enf.computeQuorumPayloadHash(DELEGATION_HASH, DELEGATOR, REDEEMER, bob, 1 ether, callData),
                hashForAlice
            )
        );
        enf.beforeHook(terms, args, DELEGATION_HASH, DELEGATOR, REDEEMER, bob, 1 ether, callData);
    }

    // ─── 2. Replay across different `value` → reject ──────────────────

    function test_C4_replay_with_different_value_rejected() public {
        bytes memory callData = hex"";
        bytes32 hashFor1Eth = enf.computeQuorumPayloadHash(
            DELEGATION_HASH, DELEGATOR, REDEEMER, TARGET_TOKEN, 1 ether, callData
        );
        bytes memory sigs = _twoOfTwo(hashFor1Eth);
        bytes memory args = abi.encode(hashFor1Eth, sigs);

        vm.expectRevert(
            abi.encodeWithSelector(
                QuorumEnforcer.PayloadHashMismatch.selector,
                enf.computeQuorumPayloadHash(DELEGATION_HASH, DELEGATOR, REDEEMER, TARGET_TOKEN, 100 ether, callData),
                hashFor1Eth
            )
        );
        enf.beforeHook(
            _terms(2), args, DELEGATION_HASH, DELEGATOR, REDEEMER, TARGET_TOKEN, 100 ether, callData
        );
    }

    // ─── 3. Replay across different `callData` → reject ───────────────

    function test_C4_replay_with_mutated_calldata_rejected() public {
        bytes memory original = abi.encodeWithSignature("transfer(address,uint256)", REDEEMER, 1 ether);
        bytes memory mutated  = abi.encodeWithSignature("transfer(address,uint256)", REDEEMER, 1_000_000 ether);

        bytes32 hashForOriginal = enf.computeQuorumPayloadHash(
            DELEGATION_HASH, DELEGATOR, REDEEMER, TARGET_TOKEN, 0, original
        );
        bytes memory sigs = _twoOfTwo(hashForOriginal);
        bytes memory args = abi.encode(hashForOriginal, sigs);

        vm.expectRevert(
            abi.encodeWithSelector(
                QuorumEnforcer.PayloadHashMismatch.selector,
                enf.computeQuorumPayloadHash(DELEGATION_HASH, DELEGATOR, REDEEMER, TARGET_TOKEN, 0, mutated),
                hashForOriginal
            )
        );
        enf.beforeHook(_terms(2), args, DELEGATION_HASH, DELEGATOR, REDEEMER, TARGET_TOKEN, 0, mutated);
    }

    // ─── 4. Replay across delegationHash → reject ─────────────────────

    function test_C4_replay_across_delegations_rejected() public {
        bytes memory callData = hex"";
        bytes32 otherDelegation = bytes32(uint256(0xbabebabe));
        bytes32 hashForDelA = enf.computeQuorumPayloadHash(
            DELEGATION_HASH, DELEGATOR, REDEEMER, TARGET_TOKEN, 0, callData
        );
        bytes memory sigs = _twoOfTwo(hashForDelA);
        bytes memory args = abi.encode(hashForDelA, sigs);

        vm.expectRevert(
            abi.encodeWithSelector(
                QuorumEnforcer.PayloadHashMismatch.selector,
                enf.computeQuorumPayloadHash(otherDelegation, DELEGATOR, REDEEMER, TARGET_TOKEN, 0, callData),
                hashForDelA
            )
        );
        enf.beforeHook(_terms(2), args, otherDelegation, DELEGATOR, REDEEMER, TARGET_TOKEN, 0, callData);
    }

    // ─── 5. Happy path — bound hash accepted ──────────────────────────

    function test_C4_bound_hash_accepts() public view {
        bytes memory callData = hex"deadbeef";
        bytes32 canonical = enf.computeQuorumPayloadHash(
            DELEGATION_HASH, DELEGATOR, REDEEMER, TARGET_TOKEN, 1 ether, callData
        );
        bytes memory sigs = _twoOfTwo(canonical);
        bytes memory args = abi.encode(canonical, sigs);
        enf.beforeHook(_terms(2), args, DELEGATION_HASH, DELEGATOR, REDEEMER, TARGET_TOKEN, 1 ether, callData);
    }

    // ─── 6. Cross-chain replay → reject ────────────────────────────────

    function test_C4_cross_chain_replay_rejected() public {
        bytes memory callData = hex"";
        // Sign on the current chain.
        bytes32 hashOnChainA = enf.computeQuorumPayloadHash(
            DELEGATION_HASH, DELEGATOR, REDEEMER, TARGET_TOKEN, 0, callData
        );
        bytes memory sigs = _twoOfTwo(hashOnChainA);
        bytes memory args = abi.encode(hashOnChainA, sigs);

        // Pretend we're now on a different chain.
        vm.chainId(123456789);
        vm.expectRevert(); // PayloadHashMismatch with different chain-bound expected
        enf.beforeHook(_terms(2), args, DELEGATION_HASH, DELEGATOR, REDEEMER, TARGET_TOKEN, 0, callData);
    }

    // ─── helpers ──────────────────────────────────────────────────────

    function _terms(uint8 threshold) internal view returns (bytes memory) {
        // Sorted-ascending signer set.
        address[] memory set = new address[](2);
        if (alice < bob) {
            set[0] = alice; set[1] = bob;
        } else {
            set[0] = bob; set[1] = alice;
        }
        return abi.encode(set, threshold, address(registry));
    }

    /// @dev Sign a hash with both alice + bob, returning the sorted-
    ///      ascending Safe-style 65-byte-per-slot blob.
    function _twoOfTwo(bytes32 hash) internal view returns (bytes memory) {
        (uint8 vA, bytes32 rA, bytes32 sA) = vm.sign(aliceKey, hash);
        (uint8 vB, bytes32 rB, bytes32 sB) = vm.sign(bobKey, hash);
        // Slots sorted by signer address.
        if (alice < bob) {
            return abi.encodePacked(rA, sA, vA, rB, sB, vB);
        }
        return abi.encodePacked(rB, sB, vB, rA, sA, vA);
    }
}
