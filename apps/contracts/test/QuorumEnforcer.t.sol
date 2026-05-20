// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Test.sol";
import "../src/enforcers/QuorumEnforcer.sol";
import "../src/ApprovedHashRegistry.sol";

/// Mock ERC-1271 wallet that returns the magic value when its stored
/// `expectedHash` matches the queried hash. Anything else returns
/// `0xffffffff` so QuorumEnforcer's catch-all maps to
/// `ContractSigInvalid`. `setRevert(true)` flips it to a throwing
/// implementation so we cover the try/catch path too.
contract MockERC1271Wallet {
    bytes4 internal constant MAGIC = 0x1626ba7e;
    bytes32 public expectedHash;
    bool public revertOnCall;

    function setExpectedHash(bytes32 h) external { expectedHash = h; }
    function setRevert(bool r) external { revertOnCall = r; }

    function isValidSignature(bytes32 hash, bytes memory) external view returns (bytes4) {
        if (revertOnCall) revert("erc1271 revert");
        return hash == expectedHash ? MAGIC : bytes4(0xffffffff);
    }
}

contract QuorumEnforcerTest is Test {
    QuorumEnforcer internal enf;
    ApprovedHashRegistry internal approvedHashRegistry;

    uint256 internal alicePk = 0xA11CE;
    uint256 internal bobPk = 0xB0B;
    uint256 internal carolPk = 0xCA401;
    address internal alice;
    address internal bob;
    address internal carol;

    bytes32 internal payloadHash = keccak256("agenticprimitives.quorum.test.payload");

    function setUp() public {
        enf = new QuorumEnforcer();
        approvedHashRegistry = new ApprovedHashRegistry();
        alice = vm.addr(alicePk);
        bob = vm.addr(bobPk);
        carol = vm.addr(carolPk);
    }

    function _terms(uint8 threshold) internal view returns (bytes memory) {
        address[] memory set = new address[](3);
        set[0] = alice;
        set[1] = bob;
        set[2] = carol;
        return abi.encode(set, threshold, address(approvedHashRegistry));
    }

    function _termsWithSet(address[] memory set, uint8 threshold) internal view returns (bytes memory) {
        return abi.encode(set, threshold, address(approvedHashRegistry));
    }

    /// Pack ECDSA signatures for the given private keys, in caller-provided
    /// order. Each entry is (r, s, v) packed as 65 bytes.
    function _packEcdsa(uint256[] memory pks, bytes32 hash)
        internal
        pure
        returns (address[] memory signers, bytes memory packed)
    {
        signers = new address[](pks.length);
        packed = new bytes(pks.length * 65);
        for (uint256 i; i < pks.length; i++) {
            signers[i] = vm.addr(pks[i]);
            (uint8 v, bytes32 r, bytes32 s) = vm.sign(pks[i], hash);
            uint256 off = i * 65;
            assembly {
                let dst := add(packed, add(0x20, off))
                mstore(dst, r)
                mstore(add(dst, 0x20), s)
                mstore8(add(dst, 0x40), v)
            }
        }
    }

    // ─── Happy path ──────────────────────────────────────────────────

    function test_two_of_three_ecdsa_passes() public view {
        // alice + bob signatures, packed in ascending-by-address order.
        uint256[] memory pks = new uint256[](2);
        if (alice < bob) {
            pks[0] = alicePk;
            pks[1] = bobPk;
        } else {
            pks[0] = bobPk;
            pks[1] = alicePk;
        }
        ( , bytes memory packed) = _packEcdsa(pks, payloadHash);
        bytes memory args = abi.encode(payloadHash, packed);
        enf.beforeHook(_terms(2), args, bytes32(0), address(0), address(0), address(0), 0, "");
    }

    function test_three_of_three_ecdsa_passes() public view {
        // All three signers, ascending.
        uint256[] memory pks = new uint256[](3);
        address[3] memory addrs = [alice, bob, carol];
        uint256[3] memory ks = [alicePk, bobPk, carolPk];
        // Simple sort.
        for (uint256 i; i < 3; i++) {
            for (uint256 j = i + 1; j < 3; j++) {
                if (addrs[j] < addrs[i]) {
                    (addrs[i], addrs[j]) = (addrs[j], addrs[i]);
                    (ks[i], ks[j]) = (ks[j], ks[i]);
                }
            }
        }
        for (uint256 i; i < 3; i++) pks[i] = ks[i];
        ( , bytes memory packed) = _packEcdsa(pks, payloadHash);
        bytes memory args = abi.encode(payloadHash, packed);
        enf.beforeHook(_terms(3), args, bytes32(0), address(0), address(0), address(0), 0, "");
    }

    // ─── Threshold gating ────────────────────────────────────────────

    function test_under_threshold_reverts() public {
        uint256[] memory pks = new uint256[](1);
        pks[0] = alicePk;
        ( , bytes memory packed) = _packEcdsa(pks, payloadHash);
        bytes memory args = abi.encode(payloadHash, packed);
        vm.expectRevert(abi.encodeWithSelector(QuorumEnforcer.InsufficientQuorum.selector, 1, 2));
        enf.beforeHook(_terms(2), args, bytes32(0), address(0), address(0), address(0), 0, "");
    }

    function test_excess_signers_ignored_beyond_threshold() public view {
        // Three valid signatures supplied but threshold is 2 — the extra is
        // not checked. Validates the gas/perf invariant in the contract
        // NatSpec ("only the first `threshold` slots are checked").
        uint256[] memory pks = new uint256[](3);
        address[3] memory addrs = [alice, bob, carol];
        uint256[3] memory ks = [alicePk, bobPk, carolPk];
        for (uint256 i; i < 3; i++) {
            for (uint256 j = i + 1; j < 3; j++) {
                if (addrs[j] < addrs[i]) {
                    (addrs[i], addrs[j]) = (addrs[j], addrs[i]);
                    (ks[i], ks[j]) = (ks[j], ks[i]);
                }
            }
        }
        for (uint256 i; i < 3; i++) pks[i] = ks[i];
        ( , bytes memory packed) = _packEcdsa(pks, payloadHash);
        bytes memory args = abi.encode(payloadHash, packed);
        // threshold=2: only the first two slots are checked.
        enf.beforeHook(_terms(2), args, bytes32(0), address(0), address(0), address(0), 0, "");
    }

    // ─── Sort + duplicate enforcement ────────────────────────────────

    function test_unsorted_signers_revert_as_duplicate() public {
        uint256[] memory pks = new uint256[](2);
        if (alice < bob) {
            pks[0] = bobPk;
            pks[1] = alicePk;
        } else {
            pks[0] = alicePk;
            pks[1] = bobPk;
        }
        ( , bytes memory packed) = _packEcdsa(pks, payloadHash);
        bytes memory args = abi.encode(payloadHash, packed);
        vm.expectRevert(); // DuplicateOrUnsortedSigner — sort failure
        enf.beforeHook(_terms(2), args, bytes32(0), address(0), address(0), address(0), 0, "");
    }

    function test_duplicate_same_signer_reverts() public {
        uint256[] memory pks = new uint256[](2);
        pks[0] = alicePk;
        pks[1] = alicePk;
        ( , bytes memory packed) = _packEcdsa(pks, payloadHash);
        bytes memory args = abi.encode(payloadHash, packed);
        vm.expectRevert(abi.encodeWithSelector(QuorumEnforcer.DuplicateOrUnsortedSigner.selector, alice));
        enf.beforeHook(_terms(2), args, bytes32(0), address(0), address(0), address(0), 0, "");
    }

    // ─── Signer-set membership ───────────────────────────────────────

    function test_unauthorized_signer_reverts() public {
        uint256 randomPk = 0xBADBEEF;
        address randomAddr = vm.addr(randomPk);
        uint256[] memory pks = new uint256[](2);
        if (alice < randomAddr) {
            pks[0] = alicePk;
            pks[1] = randomPk;
        } else {
            pks[0] = randomPk;
            pks[1] = alicePk;
        }
        ( , bytes memory packed) = _packEcdsa(pks, payloadHash);
        bytes memory args = abi.encode(payloadHash, packed);
        vm.expectRevert(abi.encodeWithSelector(QuorumEnforcer.UnauthorizedSigner.selector, randomAddr));
        enf.beforeHook(_terms(2), args, bytes32(0), address(0), address(0), address(0), 0, "");
    }

    // ─── v=1 pre-approved hash path ──────────────────────────────────

    function test_v1_pre_approved_hash_path() public {
        vm.prank(bob);
        approvedHashRegistry.approveHash(payloadHash);

        bytes memory packed = _interleaveEcdsaAndV1(alice, alicePk, bob);
        bytes memory args = abi.encode(payloadHash, packed);
        enf.beforeHook(_terms(2), args, bytes32(0), address(0), address(0), address(0), 0, "");
    }

    function test_v1_unapproved_hash_reverts() public {
        bytes memory packed = _interleaveEcdsaAndV1(alice, alicePk, bob);
        bytes memory args = abi.encode(payloadHash, packed);
        vm.expectRevert(abi.encodeWithSelector(QuorumEnforcer.ApprovedHashRequired.selector, bob));
        enf.beforeHook(_terms(2), args, bytes32(0), address(0), address(0), address(0), 0, "");
    }

    function test_v1_revoke_reverts() public {
        vm.startPrank(bob);
        approvedHashRegistry.approveHash(payloadHash);
        approvedHashRegistry.revokeHash(payloadHash);
        vm.stopPrank();

        bytes memory packed = _interleaveEcdsaAndV1(alice, alicePk, bob);
        bytes memory args = abi.encode(payloadHash, packed);
        vm.expectRevert(abi.encodeWithSelector(QuorumEnforcer.ApprovedHashRequired.selector, bob));
        enf.beforeHook(_terms(2), args, bytes32(0), address(0), address(0), address(0), 0, "");
    }

    // ─── eth_sign (v > 30) path ──────────────────────────────────────

    function test_eth_sign_path_passes() public view {
        // alice signs eth_signed (EIP-191 wrapped) payloadHash; bob signs
        // raw ECDSA. Both must be present and sorted ascending.
        bytes32 wrapped = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", payloadHash));
        (uint8 v_eth, bytes32 r_eth, bytes32 s_eth) = vm.sign(alicePk, wrapped);
        (uint8 v_bob, bytes32 r_bob, bytes32 s_bob) = vm.sign(bobPk, payloadHash);

        // eth_sign v lives in {31, 32}; we shift by +4 from the recovered
        // {27, 28} to signal the eth_sign wrapper to the verifier.
        uint8 vAlice = v_eth + 4;

        bytes memory packed = new bytes(2 * 65);
        bool aliceFirst = alice < bob;
        uint256 slotA = aliceFirst ? 0 : 65;
        uint256 slotB = aliceFirst ? 65 : 0;
        assembly {
            let dst := add(packed, 0x20)
            let pa := add(dst, slotA)
            mstore(pa, r_eth)
            mstore(add(pa, 0x20), s_eth)
            mstore8(add(pa, 0x40), vAlice)
            let pb := add(dst, slotB)
            mstore(pb, r_bob)
            mstore(add(pb, 0x20), s_bob)
            mstore8(add(pb, 0x40), v_bob)
        }
        bytes memory args = abi.encode(payloadHash, packed);
        enf.beforeHook(_terms(2), args, bytes32(0), address(0), address(0), address(0), 0, "");
    }

    // ─── v=0 ERC-1271 contract signature path ────────────────────────

    function test_v0_erc1271_contract_sig_path() public {
        // Replace bob in the signer set with a mock ERC-1271 wallet. Alice
        // signs ECDSA; the wallet's address appears as a v=0 entry where r
        // is the wallet address (left-padded) and s is the offset into the
        // signatures blob to a length-prefixed dynamic tail.
        MockERC1271Wallet wallet = new MockERC1271Wallet();
        wallet.setExpectedHash(payloadHash);
        address walletAddr = address(wallet);

        address[] memory set = new address[](2);
        set[0] = alice;
        set[1] = walletAddr;

        (uint8 av, bytes32 ar, bytes32 as_) = vm.sign(alicePk, payloadHash);

        // Layout the packed blob: 2 slots * 65 = 130, then the dynamic
        // ERC-1271 sig tail at offset 130. Tail = 32-byte length || N bytes.
        bytes memory dyn = hex"deadbeef"; // arbitrary; wallet ignores
        uint256 tailOffset = 2 * 65;

        bytes memory packed = new bytes(tailOffset + 32 + ((dyn.length + 31) / 32) * 32);

        bool aliceFirst = alice < walletAddr;
        uint256 slotA = aliceFirst ? 0 : 65;
        uint256 slotW = aliceFirst ? 65 : 0;
        bytes32 wr = bytes32(uint256(uint160(walletAddr)));
        bytes32 ws = bytes32(tailOffset);
        uint8 wv = 0;

        assembly {
            let dst := add(packed, 0x20)
            let pa := add(dst, slotA)
            mstore(pa, ar)
            mstore(add(pa, 0x20), as_)
            mstore8(add(pa, 0x40), av)
            let pw := add(dst, slotW)
            mstore(pw, wr)
            mstore(add(pw, 0x20), ws)
            mstore8(add(pw, 0x40), wv)
        }
        // Write the dynamic tail (length + body) at tailOffset.
        uint256 dynLen = dyn.length;
        assembly {
            let dst := add(packed, add(0x20, tailOffset))
            mstore(dst, dynLen)
            let src := add(dyn, 0x20)
            for { let j := 0 } lt(j, dynLen) { j := add(j, 0x20) } {
                mstore(add(add(dst, 0x20), j), mload(add(src, j)))
            }
        }

        bytes memory args = abi.encode(payloadHash, packed);
        enf.beforeHook(_termsWithSet(set, 2), args, bytes32(0), address(0), address(0), address(0), 0, "");
    }

    function test_v0_erc1271_wrong_hash_reverts() public {
        MockERC1271Wallet wallet = new MockERC1271Wallet();
        wallet.setExpectedHash(keccak256("a-different-hash")); // mismatch
        address walletAddr = address(wallet);

        address[] memory set = new address[](2);
        set[0] = alice;
        set[1] = walletAddr;

        (uint8 av, bytes32 ar, bytes32 as_) = vm.sign(alicePk, payloadHash);
        bytes memory dyn = hex"deadbeef";
        uint256 tailOffset = 2 * 65;

        bytes memory packed = new bytes(tailOffset + 32 + ((dyn.length + 31) / 32) * 32);

        bool aliceFirst = alice < walletAddr;
        uint256 slotA = aliceFirst ? 0 : 65;
        uint256 slotW = aliceFirst ? 65 : 0;
        bytes32 wr = bytes32(uint256(uint160(walletAddr)));
        bytes32 ws = bytes32(tailOffset);

        assembly {
            let dst := add(packed, 0x20)
            let pa := add(dst, slotA)
            mstore(pa, ar)
            mstore(add(pa, 0x20), as_)
            mstore8(add(pa, 0x40), av)
            let pw := add(dst, slotW)
            mstore(pw, wr)
            mstore(add(pw, 0x20), ws)
            mstore8(add(pw, 0x40), 0)
        }
        uint256 dynLen = dyn.length;
        assembly {
            let dst := add(packed, add(0x20, tailOffset))
            mstore(dst, dynLen)
            let src := add(dyn, 0x20)
            for { let j := 0 } lt(j, dynLen) { j := add(j, 0x20) } {
                mstore(add(add(dst, 0x20), j), mload(add(src, j)))
            }
        }

        bytes memory args = abi.encode(payloadHash, packed);
        vm.expectRevert(abi.encodeWithSelector(QuorumEnforcer.ContractSigInvalid.selector, walletAddr));
        enf.beforeHook(_termsWithSet(set, 2), args, bytes32(0), address(0), address(0), address(0), 0, "");
    }

    // ─── Helpers ─────────────────────────────────────────────────────

    /// Build a 2-slot packed blob with ECDSA from `ecdsaSigner` and a
    /// v=1 pre-approved-hash entry for `approvedSigner`. Ascending by
    /// address.
    function _interleaveEcdsaAndV1(address ecdsaSigner, uint256 ecdsaPk, address approvedSigner)
        internal
        view
        returns (bytes memory packed)
    {
        packed = new bytes(2 * 65);
        bool ecdsaFirst = ecdsaSigner < approvedSigner;
        (uint8 av, bytes32 ar, bytes32 as_) = vm.sign(ecdsaPk, payloadHash);
        bytes32 vr = bytes32(uint256(uint160(approvedSigner)));
        bytes32 vs = bytes32(0);

        uint256 slotE = ecdsaFirst ? 0 : 65;
        uint256 slotV = ecdsaFirst ? 65 : 0;
        assembly {
            let dst := add(packed, 0x20)
            let pe := add(dst, slotE)
            mstore(pe, ar)
            mstore(add(pe, 0x20), as_)
            mstore8(add(pe, 0x40), av)
            let pv := add(dst, slotV)
            mstore(pv, vr)
            mstore(add(pv, 0x20), vs)
            mstore8(add(pv, 0x40), 1)
        }
    }
}
