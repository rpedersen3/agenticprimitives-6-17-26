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

    // ─── Passkey-only initializer (spec 130) ─────────────────────────

    bytes32 internal constant TEST_CRED_DIGEST = keccak256("test-cred");
    uint256 internal constant TEST_X = uint256(keccak256("test-x"));
    uint256 internal constant TEST_Y = uint256(keccak256("test-y"));

    function _deployPasskey(uint256 salt) internal returns (AgentAccount) {
        return factory.createAccountWithPasskey(TEST_CRED_DIGEST, TEST_X, TEST_Y, salt);
    }

    function test_initializeWithPasskey_registers_credential() public {
        AgentAccount pk = _deployPasskey(100);
        assertTrue(pk.hasPasskey(TEST_CRED_DIGEST));
        (uint256 x, uint256 y) = pk.getPasskey(TEST_CRED_DIGEST);
        assertEq(x, TEST_X);
        assertEq(y, TEST_Y);
        assertEq(pk.passkeyCount(), 1);
    }

    function test_initializeWithPasskey_leaves_zero_eoa_owners() public {
        AgentAccount pk = _deployPasskey(101);
        assertEq(pk.ownerCount(), 0);
        assertFalse(pk.isOwner(address(0xBEEF)));
    }

    function test_initializeWithPasskey_cannot_be_called_twice() public {
        AgentAccount pk = _deployPasskey(102);
        vm.expectRevert();
        pk.initializeWithPasskey(
            TEST_CRED_DIGEST, TEST_X, TEST_Y, address(dm), address(factory)
        );
    }

    function test_passkey_account_emits_PasskeyAdded_at_init() public {
        // Compute predicted address; bind expectEmit to it before the
        // CREATE2 happens. The factory will subsequently call the
        // initializer which emits PasskeyAdded from the proxy.
        address predicted = factory.getAddressForPasskey(TEST_CRED_DIGEST, TEST_X, TEST_Y, 103);
        vm.expectEmit(true, false, false, true, predicted);
        emit AgentAccount.PasskeyAdded(TEST_CRED_DIGEST, TEST_X, TEST_Y);
        factory.createAccountWithPasskey(TEST_CRED_DIGEST, TEST_X, TEST_Y, 103);
    }

    function test_passkey_account_ecdsa_signature_rejected() public {
        // No EOA owner means ECDSA-recovered signatures from any address
        // must fail isValidSignature. (No owner to recover to.)
        AgentAccount pk = _deployPasskey(104);
        bytes32 hash = keccak256("hello");
        bytes memory sig = _signRaw(OWNER_PK, hash);
        assertEq(pk.isValidSignature(hash, sig), ERC1271_INVALID);
    }

    function test_passkey_account_cannot_remove_only_passkey_via_self_call() public {
        // The CannotRemoveLastSigner invariant must protect a passkey-only
        // account from being bricked. removePasskey is onlySelf, so we
        // simulate the userOp by pranking the account itself.
        AgentAccount pk = _deployPasskey(105);
        vm.prank(address(pk));
        vm.expectRevert(AgentAccount.CannotRemoveLastSigner.selector);
        pk.removePasskey(TEST_CRED_DIGEST);
    }

    function test_passkey_account_can_add_eoa_owner_via_self_call() public {
        // Verify the passkey-only account can be upgraded to multi-sig
        // by adding an EOA owner via a self-call (post-init UserOp path).
        AgentAccount pk = _deployPasskey(106);
        vm.prank(address(pk));
        pk.addOwner(address(0xCAFE));
        assertTrue(pk.isOwner(address(0xCAFE)));
        assertEq(pk.ownerCount(), 1);
        assertEq(pk.passkeyCount(), 1);
    }

    // ─── Spec § 9 row 10: acceptSessionDelegation emits ──────────────

    function test_acceptSessionDelegation_emits_event() public {
        bytes32 hash = keccak256("test-session-delegation-hash");
        vm.expectEmit(true, false, false, false, address(acct));
        emit AgentAccount.SessionDelegationAccepted(hash);
        // onlySelf: prank as the account itself (simulating the userOp path).
        vm.prank(address(acct));
        acct.acceptSessionDelegation(hash);
        assertTrue(acct.hasAcceptedSessionDelegation(hash));
    }

    function test_acceptSessionDelegation_idempotent_reverts_on_repeat() public {
        bytes32 hash = keccak256("test-session-delegation-hash");
        vm.startPrank(address(acct));
        acct.acceptSessionDelegation(hash);
        vm.expectRevert(
            abi.encodeWithSelector(AgentAccount.SessionDelegationAlreadyAccepted.selector, hash)
        );
        acct.acceptSessionDelegation(hash);
        vm.stopPrank();
    }

    function test_acceptSessionDelegation_onlySelf_rejects_external_caller() public {
        bytes32 hash = keccak256("test-session-delegation-hash");
        vm.prank(owner);
        vm.expectRevert(AgentAccount.NotFromSelf.selector);
        acct.acceptSessionDelegation(hash);
    }
}
