// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Test.sol";
import {EntryPoint} from "account-abstraction/core/EntryPoint.sol";
import {IEntryPoint} from "account-abstraction/interfaces/IEntryPoint.sol";
import "../src/AgentAccountFactory.sol";
import "../src/AgentAccount.sol";
import "../src/agency/DelegationManager.sol";
import {CustodyPolicy} from "../src/custody/CustodyPolicy.sol";
import {AgentAccountInitParams} from "../src/IAgentAccount.sol";

contract AgentAccountTest is Test {
    function _defaultTimelocks() internal pure returns (uint32[7] memory tl) {}
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
        dm = new DelegationManager(address(0));
        owner = vm.addr(OWNER_PK);
        CustodyPolicy cp = new CustodyPolicy();
        factory = new AgentAccountFactory(
            IEntryPoint(address(ep)),
            address(dm),
            address(cp),
            address(0xBB),
            address(0xCC),
            address(0xDD), address(0)
        );
        address[] memory custodians = new address[](1);
        custodians[0] = owner;
        acct = factory.createAgentAccount(_simpleParams(custodians, bytes32(0), 0, 0), _defaultTimelocks(), 42);
    }

    function _simpleParams(address[] memory custodians, bytes32 cred, uint256 x, uint256 y)
        internal pure returns (AgentAccountInitParams memory)
    {
        return AgentAccountInitParams({
            mode: 0,
            custodians: custodians,
            trustees: new address[](0),
            initialPasskeyCredentialIdDigest: cred,
            initialPasskeyX: x,
            initialPasskeyY: y,

            initialPasskeyRpIdHash: bytes32(uint256(0x7270696468617368))
        });
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
        address[] memory custodians = new address[](1);
        custodians[0] = owner;
        vm.expectRevert();
        acct.initialize(custodians, bytes32(0), 0, 0, bytes32(uint256(0x7270696468617368)), address(dm), address(factory));
    }

    // ─── Passkey-only initializer (phase 6f.4 unified) ────────────────

    bytes32 internal constant TEST_CRED_DIGEST = keccak256("test-cred");
    uint256 internal constant TEST_X = uint256(keccak256("test-x"));
    uint256 internal constant TEST_Y = uint256(keccak256("test-y"));

    function _deployPasskey(uint256 salt) internal returns (AgentAccount) {
        address[] memory empty;
        return factory.createAgentAccount(_simpleParams(empty, TEST_CRED_DIGEST, TEST_X, TEST_Y), _defaultTimelocks(), salt);
    }

    function test_passkeyOnlyInit_registers_credential() public {
        AgentAccount pk = _deployPasskey(100);
        assertTrue(pk.hasPasskey(TEST_CRED_DIGEST));
        (uint256 x, uint256 y) = pk.getPasskey(TEST_CRED_DIGEST);
        assertEq(x, TEST_X);
        assertEq(y, TEST_Y);
        assertEq(pk.passkeyCount(), 1);
    }

    function test_passkeyOnlyInit_registers_pia_as_custodian() public {
        // Phase 6f.4 pivot: the passkey's PIA is a first-class custodian
        // (counted via passkey storage). A passkey-only account reports
        // custodianCount == 1 (the PIA), and isCustodian(pia) returns
        // true; unrelated addresses do not.
        AgentAccount pk = _deployPasskey(101);
        assertEq(pk.custodianCount(), 1);
        address pia = pk.passkeyIdentity(TEST_X, TEST_Y);
        assertTrue(pk.isCustodian(pia));
        assertFalse(pk.isCustodian(address(0xBEEF)));
    }

    function test_passkeyOnlyInit_cannot_be_called_twice() public {
        AgentAccount pk = _deployPasskey(102);
        address[] memory empty;
        vm.expectRevert();
        pk.initialize(empty, TEST_CRED_DIGEST, TEST_X, TEST_Y, bytes32(uint256(0x7270696468617368)), address(dm), address(factory));
    }

    function test_passkey_account_emits_PasskeyAdded_at_init() public {
        // Compute predicted address; bind expectEmit to it before the
        // CREATE2 happens. The factory will subsequently call the
        // initializer which emits PasskeyAdded from the proxy.
        address[] memory empty;
        address predicted = factory.getAddressForAgentAccount(_simpleParams(empty, TEST_CRED_DIGEST, TEST_X, TEST_Y), _defaultTimelocks(), 103);
        vm.expectEmit(true, false, false, true, predicted);
        emit AgentAccount.PasskeyAdded(TEST_CRED_DIGEST, TEST_X, TEST_Y, bytes32(uint256(0x7270696468617368)));
        factory.createAgentAccount(_simpleParams(empty, TEST_CRED_DIGEST, TEST_X, TEST_Y), _defaultTimelocks(), 103);
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
        // After: custodianCount counts both the passkey's PIA (1) and
        // the added EOA owner (1) = 2.
        AgentAccount pk = _deployPasskey(106);
        vm.prank(address(pk));
        pk.addCustodian(address(0xCAFE));
        assertTrue(pk.isCustodian(address(0xCAFE)));
        assertEq(pk.custodianCount(), 2);
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
