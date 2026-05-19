// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Test.sol";
import {EntryPoint} from "account-abstraction/core/EntryPoint.sol";
import {IEntryPoint} from "account-abstraction/interfaces/IEntryPoint.sol";
import "../src/AgentAccountFactory.sol";
import "../src/AgentAccount.sol";
import "../src/DelegationManager.sol";

contract AgentAccountTest is Test {
    AgentAccountFactory factory;
    DelegationManager dm;
    AgentAccount acct;

    uint256 internal constant OWNER_PK = 0xA11CE;
    address internal owner;
    address internal nonOwner = address(0xB0B);

    bytes4 internal constant ERC1271_MAGIC = 0x1626ba7e;
    bytes4 internal constant ERC1271_INVALID = 0xffffffff;

    function setUp() public {
        EntryPoint ep = new EntryPoint();
        dm = new DelegationManager();
        owner = vm.addr(OWNER_PK);
        factory = new AgentAccountFactory(
            IEntryPoint(address(ep)),
            address(dm),
            address(0xBB),
            address(0xCC),
            address(0xDD)
        );
        acct = factory.createAccount(owner, 42);
    }

    function _signRaw(uint256 pk, bytes32 hash) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, hash);
        return abi.encodePacked(r, s, v);
    }

    function _signEth(uint256 pk, bytes32 hash) internal pure returns (bytes memory) {
        bytes32 ethHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", hash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, ethHash);
        return abi.encodePacked(r, s, v);
    }

    // ─── ERC-1271 tests ───────────────────────────────────────────────

    function test_isValidSignature_accepts_owner_raw_hash_signature() public view {
        // Phase A signs userOpHash directly (no eth-signed wrap).
        bytes32 hash = keccak256("hello");
        bytes memory sig = _signRaw(OWNER_PK, hash);
        assertEq(acct.isValidSignature(hash, sig), ERC1271_MAGIC);
    }

    function test_isValidSignature_accepts_owner_eth_signed_wrap() public view {
        // Legacy ERC-1271 fallback — eth-signed message hash.
        bytes32 hash = keccak256("legacy");
        bytes memory sig = _signEth(OWNER_PK, hash);
        assertEq(acct.isValidSignature(hash, sig), ERC1271_MAGIC);
    }

    function test_isValidSignature_rejects_non_owner_signature() public view {
        bytes32 hash = keccak256("hello");
        // Sign with a different key
        bytes memory sig = _signRaw(0xBEEF, hash);
        assertEq(acct.isValidSignature(hash, sig), ERC1271_INVALID);
    }

    function test_isValidSignature_rejects_tampered_hash() public view {
        bytes32 hash = keccak256("hello");
        bytes memory sig = _signRaw(OWNER_PK, hash);
        bytes32 tampered = keccak256("hellox");
        assertEq(acct.isValidSignature(tampered, sig), ERC1271_INVALID);
    }

    function test_isValidSignature_rejects_bad_sig_format() public view {
        bytes32 hash = keccak256("hello");
        // Not 65 bytes and not a known type prefix
        bytes memory badSig = hex"00";
        assertEq(acct.isValidSignature(hash, badSig), ERC1271_INVALID);
    }

    function test_isValidSignature_accepts_type_prefixed_ecdsa() public view {
        // 0x00 type prefix + 65-byte sig (matches Phase A type-byte routing).
        bytes32 hash = keccak256("typed");
        bytes memory inner = _signRaw(OWNER_PK, hash);
        bytes memory typed = new bytes(66);
        typed[0] = 0x00;
        for (uint256 i; i < 65; i++) typed[i + 1] = inner[i];
        assertEq(acct.isValidSignature(hash, typed), ERC1271_MAGIC);
    }

    // ─── Wiring tests ─────────────────────────────────────────────────

    function test_account_initialized_with_factory_DM() public view {
        // delegationManager() view returns the DM the factory set at init.
        assertEq(acct.delegationManager(), address(dm));
    }

    function test_account_initialized_with_factory_address() public view {
        assertEq(acct.factory(), address(factory));
    }

    function test_initialize_cannot_be_called_twice() public {
        // The proxy already called initialize during deployment; another
        // call should revert (OpenZeppelin's `initializer` modifier).
        vm.expectRevert();
        acct.initialize(owner, address(dm), address(factory));
    }
}
