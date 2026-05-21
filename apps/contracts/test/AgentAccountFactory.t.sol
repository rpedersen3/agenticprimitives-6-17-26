// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Test.sol";
import {EntryPoint} from "account-abstraction/core/EntryPoint.sol";
import {IEntryPoint} from "account-abstraction/interfaces/IEntryPoint.sol";
import "../src/AgentAccountFactory.sol";
import "../src/AgentAccount.sol";
import "../src/agency/DelegationManager.sol";

contract AgentAccountFactoryTest is Test {
    AgentAccountFactory factory;
    DelegationManager dm;

    address internal owner = address(0xAA);
    address internal bundlerSigner = address(0xBB);
    address internal sessionIssuer = address(0xCC);
    address internal governance = address(0xDD);

    function setUp() public {
        EntryPoint ep = new EntryPoint();
        dm = new DelegationManager();
        factory = new AgentAccountFactory(
            IEntryPoint(address(ep)),
            address(dm),
            bundlerSigner,
            sessionIssuer,
            governance
        );
    }

    function test_getAddress_is_deterministic_pure_function() public view {
        address a1 = factory.getAddress(owner, 0);
        address a2 = factory.getAddress(owner, 0);
        assertEq(a1, a2);
    }

    function test_getAddress_changes_with_salt() public view {
        address a1 = factory.getAddress(owner, 0);
        address a2 = factory.getAddress(owner, 1);
        assertTrue(a1 != a2);
    }

    function test_getAddress_changes_with_owner() public view {
        address a1 = factory.getAddress(owner, 0);
        address a2 = factory.getAddress(address(0x99), 0);
        assertTrue(a1 != a2);
    }

    function test_createAccount_deploys_at_predicted_address() public {
        address predicted = factory.getAddress(owner, 7);
        assertEq(predicted.code.length, 0, "should not be deployed yet");
        AgentAccount acct = factory.createAccount(owner, 7);
        assertEq(address(acct), predicted, "deployed address must match prediction");
        assertGt(predicted.code.length, 0, "should now have code");
    }

    function test_createAccount_is_idempotent() public {
        AgentAccount a1 = factory.createAccount(owner, 8);
        AgentAccount a2 = factory.createAccount(owner, 8);
        assertEq(address(a1), address(a2), "second call returns same instance");
    }

    function test_createAccount_emits_event() public {
        address predicted = factory.getAddress(owner, 9);
        vm.expectEmit(true, true, false, true);
        emit AgentAccountFactory.AgentAccountCreated(predicted, owner, 9);
        factory.createAccount(owner, 9);
    }

    function test_factory_exposes_capability_roles() public view {
        assertEq(factory.bundlerSigner(), bundlerSigner);
        assertEq(factory.sessionIssuer(), sessionIssuer);
        assertEq(factory.delegationManager(), address(dm));
    }

    function test_setBundlerSigner_requires_governance() public {
        vm.expectRevert();
        factory.setBundlerSigner(address(0xFF));
    }

    function test_setBundlerSigner_succeeds_under_governance() public {
        vm.prank(governance);
        factory.setBundlerSigner(address(0xFF));
        assertEq(factory.bundlerSigner(), address(0xFF));
    }

    function test_setSessionIssuer_requires_governance() public {
        vm.expectRevert();
        factory.setSessionIssuer(address(0xEE));
    }

    function test_setSessionIssuer_succeeds_under_governance() public {
        vm.prank(governance);
        factory.setSessionIssuer(address(0xEE));
        assertEq(factory.sessionIssuer(), address(0xEE));
    }

    function test_setBundlerSigner_emits_event() public {
        vm.expectEmit(true, true, false, false);
        emit AgentAccountFactory.BundlerSignerChanged(bundlerSigner, address(0xFF));
        vm.prank(governance);
        factory.setBundlerSigner(address(0xFF));
    }

    // ─── Passkey-owned accounts (spec 130) ───────────────────────────

    // Use fixed but non-zero test values. These are NOT a real P-256 key
    // — the contract only validates x != 0 && y != 0 at this layer.
    // Signature verification happens later via the WebAuthn validator.
    bytes32 internal constant TEST_CRED_DIGEST =
        keccak256("test-credential-id");
    uint256 internal constant TEST_PASSKEY_X =
        uint256(keccak256("test-x"));
    uint256 internal constant TEST_PASSKEY_Y =
        uint256(keccak256("test-y"));

    function test_getAddressForPasskey_is_deterministic_pure_function() public view {
        address a1 = factory.getAddressForPasskey(TEST_CRED_DIGEST, TEST_PASSKEY_X, TEST_PASSKEY_Y, 0);
        address a2 = factory.getAddressForPasskey(TEST_CRED_DIGEST, TEST_PASSKEY_X, TEST_PASSKEY_Y, 0);
        assertEq(a1, a2);
    }

    function test_getAddressForPasskey_changes_with_salt() public view {
        address a1 = factory.getAddressForPasskey(TEST_CRED_DIGEST, TEST_PASSKEY_X, TEST_PASSKEY_Y, 0);
        address a2 = factory.getAddressForPasskey(TEST_CRED_DIGEST, TEST_PASSKEY_X, TEST_PASSKEY_Y, 1);
        assertTrue(a1 != a2);
    }

    function test_getAddressForPasskey_changes_with_credentialIdDigest() public view {
        address a1 = factory.getAddressForPasskey(TEST_CRED_DIGEST, TEST_PASSKEY_X, TEST_PASSKEY_Y, 0);
        address a2 = factory.getAddressForPasskey(keccak256("other-cred"), TEST_PASSKEY_X, TEST_PASSKEY_Y, 0);
        assertTrue(a1 != a2);
    }

    function test_getAddressForPasskey_changes_with_pubkey() public view {
        address a1 = factory.getAddressForPasskey(TEST_CRED_DIGEST, TEST_PASSKEY_X, TEST_PASSKEY_Y, 0);
        address a2 = factory.getAddressForPasskey(TEST_CRED_DIGEST, TEST_PASSKEY_X + 1, TEST_PASSKEY_Y, 0);
        assertTrue(a1 != a2);
    }

    function test_getAddressForPasskey_differs_from_getAddress() public view {
        // A passkey-owned account at salt 0 must NOT collide with an
        // EOA-owned account at salt 0 even for the same numeric inputs.
        address eoaAddr = factory.getAddress(address(uint160(TEST_PASSKEY_X)), 0);
        address pkAddr  = factory.getAddressForPasskey(TEST_CRED_DIGEST, TEST_PASSKEY_X, TEST_PASSKEY_Y, 0);
        assertTrue(eoaAddr != pkAddr);
    }

    function test_createAccountWithPasskey_deploys_at_predicted_address() public {
        address predicted = factory.getAddressForPasskey(TEST_CRED_DIGEST, TEST_PASSKEY_X, TEST_PASSKEY_Y, 0);
        assertEq(predicted.code.length, 0, "should not be deployed yet");
        AgentAccount acct = factory.createAccountWithPasskey(
            TEST_CRED_DIGEST, TEST_PASSKEY_X, TEST_PASSKEY_Y, 0
        );
        assertEq(address(acct), predicted);
        assertGt(predicted.code.length, 0);
    }

    function test_createAccountWithPasskey_is_idempotent() public {
        AgentAccount a1 = factory.createAccountWithPasskey(
            TEST_CRED_DIGEST, TEST_PASSKEY_X, TEST_PASSKEY_Y, 11
        );
        AgentAccount a2 = factory.createAccountWithPasskey(
            TEST_CRED_DIGEST, TEST_PASSKEY_X, TEST_PASSKEY_Y, 11
        );
        assertEq(address(a1), address(a2));
    }

    function test_createAccountWithPasskey_emits_event() public {
        address predicted = factory.getAddressForPasskey(TEST_CRED_DIGEST, TEST_PASSKEY_X, TEST_PASSKEY_Y, 12);
        vm.expectEmit(true, true, false, true);
        emit AgentAccountFactory.AgentAccountCreatedWithPasskey(predicted, TEST_CRED_DIGEST, 12);
        factory.createAccountWithPasskey(TEST_CRED_DIGEST, TEST_PASSKEY_X, TEST_PASSKEY_Y, 12);
    }

    function test_passkey_account_has_passkey_registered_and_no_owners() public {
        AgentAccount acct = factory.createAccountWithPasskey(
            TEST_CRED_DIGEST, TEST_PASSKEY_X, TEST_PASSKEY_Y, 13
        );
        assertTrue(acct.hasPasskey(TEST_CRED_DIGEST));
        (uint256 gx, uint256 gy) = acct.getPasskey(TEST_CRED_DIGEST);
        assertEq(gx, TEST_PASSKEY_X);
        assertEq(gy, TEST_PASSKEY_Y);
        assertEq(acct.passkeyCount(), 1);
        assertEq(acct.custodianCount(), 0, "passkey-only account must have 0 EOA owners");
    }

    function test_passkey_account_carries_factory_and_dm() public {
        AgentAccount acct = factory.createAccountWithPasskey(
            TEST_CRED_DIGEST, TEST_PASSKEY_X, TEST_PASSKEY_Y, 14
        );
        assertEq(acct.factory(), address(factory));
        assertEq(acct.delegationManager(), address(dm));
        assertEq(acct.bundlerSigner(), bundlerSigner);
        assertEq(acct.sessionIssuer(), sessionIssuer);
    }

    function test_createAccountWithPasskey_rejects_zero_x() public {
        vm.expectRevert();
        factory.createAccountWithPasskey(TEST_CRED_DIGEST, 0, TEST_PASSKEY_Y, 0);
    }

    function test_createAccountWithPasskey_rejects_zero_y() public {
        vm.expectRevert();
        factory.createAccountWithPasskey(TEST_CRED_DIGEST, TEST_PASSKEY_X, 0, 0);
    }
}
