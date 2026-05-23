// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Test.sol";
import {EntryPoint} from "account-abstraction/core/EntryPoint.sol";
import {IEntryPoint} from "account-abstraction/interfaces/IEntryPoint.sol";
import "../src/AgentAccountFactory.sol";
import "../src/AgentAccount.sol";
import "../src/agency/DelegationManager.sol";
import {CustodyPolicy} from "../src/custody/CustodyPolicy.sol";
import {SignatureSlotRecovery} from "../src/libraries/SignatureSlotRecovery.sol";
import {WebAuthnLib} from "../src/libraries/WebAuthnLib.sol";
import {AgentAccountInitParams} from "../src/IAgentAccount.sol";

/// @dev Phase 6f.4 — passkey-direct custody pivot. Covers:
///       (a) PIA derivation matches the documented formula
///       (b) Passkey-only init registers the PIA as a first-class custodian
///       (c) addPasskey / removePasskey keep `isCustodian(pia)` in lockstep
///       (d) `SignatureSlotRecovery.recoverFromSlot` v=2 path:
///           - decodes (x, y, assertion) from the tail
///           - reverts `PasskeyPubKeyMismatch` when r != derived(x,y)
///           - reaches `WebAuthnLib.verify` for a well-shaped slot
///             (the verify itself fails on synthetic data; what we care
///              about is the slot decoder, NOT the P-256 crypto path
///              which is covered by existing WebAuthn fixtures).
contract PasskeyDirectCustodyTest is Test {
    function _defaultTimelocks() internal pure returns (uint32[7] memory tl) {}
    AgentAccountFactory factory;
    DelegationManager   dm;
    CustodyPolicy       validator;

    bytes32 internal constant CRED_DIGEST =
        keccak256("test-credential-direct-custody");
    uint256 internal constant PASSKEY_X = uint256(keccak256("direct-x"));
    uint256 internal constant PASSKEY_Y = uint256(keccak256("direct-y"));

    function setUp() public {
        EntryPoint ep = new EntryPoint();
        dm = new DelegationManager();
        validator = new CustodyPolicy();
        factory = new AgentAccountFactory(
            IEntryPoint(address(ep)),
            address(dm),
            address(validator),
            address(0xBB),
            address(0xCC),
            address(0xDD)
        );
    }

    function _pia(uint256 x, uint256 y) internal pure returns (address) {
        return address(uint160(uint256(keccak256(abi.encode(x, y)))));
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
            initialPasskeyY: y
        });
    }

    function _emptyArr() internal pure returns (address[] memory r) {
        r = new address[](0);
    }

    // ─── (a) PIA derivation ────────────────────────────────────────────

    function test_passkeyIdentity_matches_documented_formula() public {
        AgentAccount acct = factory.createAgentAccount(_simpleParams(_emptyArr(), CRED_DIGEST, PASSKEY_X, PASSKEY_Y), _defaultTimelocks(), 1);
        address expected = _pia(PASSKEY_X, PASSKEY_Y);
        assertEq(acct.passkeyIdentity(PASSKEY_X, PASSKEY_Y), expected);
    }

    function test_passkeyIdentity_differs_for_different_pubkeys() public {
        AgentAccount acct = factory.createAgentAccount(_simpleParams(_emptyArr(), CRED_DIGEST, PASSKEY_X, PASSKEY_Y), _defaultTimelocks(), 2);
        address a = acct.passkeyIdentity(PASSKEY_X, PASSKEY_Y);
        address b = acct.passkeyIdentity(PASSKEY_X + 1, PASSKEY_Y);
        assertTrue(a != b);
    }

    // ─── (b) Passkey-only init: PIA is a first-class custodian ─────────

    function test_initWithPasskey_registers_pia_as_custodian() public {
        AgentAccount acct = factory.createAgentAccount(_simpleParams(_emptyArr(), CRED_DIGEST, PASSKEY_X, PASSKEY_Y), _defaultTimelocks(), 3);
        address pia = _pia(PASSKEY_X, PASSKEY_Y);
        assertTrue(acct.isCustodian(pia));
        assertEq(acct.custodianCount(), 1);
        assertEq(acct.passkeyCount(), 1);
    }

    // ─── (c) addPasskey adds PIA; removePasskey clears it ──────────────

    function test_addPasskey_registers_new_pia_as_custodian() public {
        AgentAccount acct = factory.createAgentAccount(_simpleParams(_emptyArr(), CRED_DIGEST, PASSKEY_X, PASSKEY_Y), _defaultTimelocks(), 4);
        bytes32 cred2 = keccak256("second-credential");
        uint256 x2 = uint256(keccak256("second-x"));
        uint256 y2 = uint256(keccak256("second-y"));
        address pia2 = _pia(x2, y2);

        // addPasskey is onlySelf; simulate the userOp via vm.prank.
        vm.prank(address(acct));
        acct.addPasskey(cred2, x2, y2);

        assertTrue(acct.isCustodian(pia2));
        assertEq(acct.custodianCount(), 2);
        assertEq(acct.passkeyCount(), 2);
    }

    function test_removePasskey_clears_pia_custodian() public {
        AgentAccount acct = factory.createAgentAccount(_simpleParams(_emptyArr(), CRED_DIGEST, PASSKEY_X, PASSKEY_Y), _defaultTimelocks(), 5);
        bytes32 cred2 = keccak256("removable-credential");
        uint256 x2 = uint256(keccak256("removable-x"));
        uint256 y2 = uint256(keccak256("removable-y"));
        address pia2 = _pia(x2, y2);

        vm.startPrank(address(acct));
        acct.addPasskey(cred2, x2, y2);
        assertTrue(acct.isCustodian(pia2));
        acct.removePasskey(cred2);
        vm.stopPrank();

        assertFalse(acct.isCustodian(pia2));
        assertEq(acct.custodianCount(), 1); // original PIA still there
        assertEq(acct.passkeyCount(), 1);
    }

    function test_addPasskey_rejects_duplicate_pia_under_different_credId() public {
        AgentAccount acct = factory.createAgentAccount(_simpleParams(_emptyArr(), CRED_DIGEST, PASSKEY_X, PASSKEY_Y), _defaultTimelocks(), 6);
        // Different credentialIdDigest, SAME (x, y) — would re-add the
        // same PIA. The piaToCredentialId mapping check catches this.
        vm.prank(address(acct));
        vm.expectRevert(); // PasskeyAlreadyRegistered
        acct.addPasskey(keccak256("alias-credential"), PASSKEY_X, PASSKEY_Y);
    }

    // ─── (d) v=2 slot decoding via a harness contract ──────────────────
    //
    // SignatureSlotRecovery is `internal`, so we wrap it in a harness
    // and call from there.

    function test_v2_slot_reverts_on_pia_mismatch() public {
        SlotHarness h = new SlotHarness();

        // Build a slot where r = some PIA but the tail has (x', y') such
        // that derived(x', y') != r.
        address claimedPia = address(0xDEADBEEF);
        WebAuthnLib.Assertion memory dummyAssertion;
        bytes memory tail = abi.encode(PASSKEY_X, PASSKEY_Y, dummyAssertion);
        bytes memory sigs = _buildOneSlotSigs(claimedPia, tail, /*v=*/ 2);

        address derived = _pia(PASSKEY_X, PASSKEY_Y);
        vm.expectRevert(abi.encodeWithSelector(
            SignatureSlotRecovery.PasskeyPubKeyMismatch.selector,
            claimedPia, derived
        ));
        h.recover(keccak256("payload"), sigs, 0, address(0));
    }

    function test_v2_slot_passes_pia_check_then_fails_webauthn() public {
        SlotHarness h = new SlotHarness();
        // r matches derived(x, y), but the assertion is empty — WebAuthn
        // verify will fail on _checkClientData / authenticatorData. We
        // expect `PasskeySigInvalid`, which proves the slot decoder ran
        // past the PIA check and reached WebAuthn.verify.
        address pia = _pia(PASSKEY_X, PASSKEY_Y);
        WebAuthnLib.Assertion memory emptyAssertion;
        bytes memory tail = abi.encode(PASSKEY_X, PASSKEY_Y, emptyAssertion);
        bytes memory sigs = _buildOneSlotSigs(pia, tail, /*v=*/ 2);

        vm.expectRevert(abi.encodeWithSelector(
            SignatureSlotRecovery.PasskeySigInvalid.selector, pia
        ));
        h.recover(keccak256("payload"), sigs, 0, address(0));
    }

    // ─── Helpers ───────────────────────────────────────────────────────

    /// @dev Build a single-slot packed-sigs blob with a dynamic tail.
    ///      Layout: [r (32) || s (32) || v (1)] [len (32) || tail].
    function _buildOneSlotSigs(
        address claimedSigner,
        bytes memory tail,
        uint8 v
    ) internal pure returns (bytes memory) {
        // Tail offset within `signatures`: 65 (one slot).
        bytes32 r = bytes32(uint256(uint160(claimedSigner)));
        bytes32 s = bytes32(uint256(65));
        bytes memory slot = abi.encodePacked(r, s, v);
        bytes memory tailWithLen = abi.encodePacked(uint256(tail.length), tail);
        return abi.encodePacked(slot, tailWithLen);
    }
}

/// @dev Thin harness exposing the `internal` library function for tests.
contract SlotHarness {
    function recover(
        bytes32 payloadHash,
        bytes memory signatures,
        uint256 index,
        address approvedHashRegistry
    ) external view returns (address) {
        return SignatureSlotRecovery.recoverFromSlot(
            payloadHash, signatures, index, approvedHashRegistry
        );
    }
}
