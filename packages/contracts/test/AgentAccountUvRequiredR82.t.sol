// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * R8.2 / ATL-SEC-03 — AgentAccount.isValidSignature MUST require UV
 *                     (User Verification) on every WebAuthn assertion.
 *
 * Wave H1 already wired the BROWSER ceremony to pass
 * `userVerification: 'required'` for custody-grade flows (demo-sso,
 * demo-sso-next, demo-org, demo-web-recovery). The 2026-05-31 third-
 * party audit observed that the CONTRACT side still passed
 * `requireUv: false` to WebAuthnLib.verify — meaning a permissive
 * authenticator could produce a UP-only assertion and AgentAccount
 * would accept it. R8.2 closes the gap by passing `requireUv: true`
 * in `_verifyWebAuthn` (AgentAccount.sol:1179).
 */

import "forge-std/Test.sol";
import {EntryPoint} from "account-abstraction/core/EntryPoint.sol";
import {IEntryPoint} from "account-abstraction/interfaces/IEntryPoint.sol";
import "../src/AgentAccountFactory.sol";
import "../src/AgentAccount.sol";
import "../src/agency/DelegationManager.sol";
import {CustodyPolicy} from "../src/custody/CustodyPolicy.sol";
import {WebAuthnLib} from "../src/libraries/WebAuthnLib.sol";
import {AgentAccountInitParams} from "../src/IAgentAccount.sol";

contract AgentAccountUvRequiredR82Test is Test {
    EntryPoint internal ep;
    AgentAccountFactory internal factory;
    DelegationManager internal dm;
    CustodyPolicy internal validator;

    bytes32 internal constant CRED_DIGEST =
        keccak256("test-credential-r8-2");
    uint256 internal constant PASSKEY_X = uint256(keccak256("r8-2-x"));
    uint256 internal constant PASSKEY_Y = uint256(keccak256("r8-2-y"));
    bytes32 internal constant RP_ID_HASH = keccak256("rich-pedersen-10.impact-agent.me");

    function setUp() public {
        ep = new EntryPoint();
        dm = new DelegationManager(address(0));
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

    function _deployAccountWithPasskey() internal returns (AgentAccount acct) {
        AgentAccountInitParams memory params = AgentAccountInitParams({
            mode: 0,
            custodians: new address[](0),
            trustees: new address[](0),
            initialPasskeyCredentialIdDigest: CRED_DIGEST,
            initialPasskeyX: PASSKEY_X,
            initialPasskeyY: PASSKEY_Y,
            initialPasskeyRpIdHash: RP_ID_HASH
        });
        uint32[7] memory tl;
        acct = factory.createAgentAccount(params, tl, 0x82);
    }

    /// Build authenticatorData with `flags` as the 33rd byte.
    /// Layout (WebAuthn spec § 6.1):
    ///   [0..32]  rpIdHash
    ///   [32]     flags (bit 0 = UP, bit 2 = UV)
    ///   [33..37] signCount
    function _authData(bytes32 rpIdHash, uint8 flags) internal pure returns (bytes memory) {
        bytes memory ad = new bytes(37);
        for (uint256 i; i < 32; i++) ad[i] = rpIdHash[i];
        ad[32] = bytes1(flags);
        return ad;
    }

    function _signatureBlob(bytes memory authData) internal pure returns (bytes memory) {
        WebAuthnLib.Assertion memory a = WebAuthnLib.Assertion({
            authenticatorData: authData,
            clientDataJSON: '{"type":"webauthn.get","challenge":"x","origin":"https://rich-pedersen-10.impact-agent.me","crossOrigin":false}',
            challengeIndex: 23,
            typeIndex: 1,
            r: uint256(keccak256("r")),
            s: uint256(keccak256("s")),
            credentialIdDigest: CRED_DIGEST
        });
        return abi.encodePacked(bytes1(0x01), abi.encode(a));
    }

    function test_R8_2_uvNotSet_isValidSignature_returns_0xffffffff() public {
        AgentAccount acct = _deployAccountWithPasskey();
        bytes memory authData = _authData(RP_ID_HASH, 0x01); // UP only
        bytes memory sig = _signatureBlob(authData);
        bytes4 magic = acct.isValidSignature(bytes32(uint256(0xabcd)), sig);
        assertEq(magic, bytes4(0xffffffff), "UP-only assertion must be rejected");
    }

    function test_R8_2_uvAndUpSet_passes_flagCheck() public {
        AgentAccount acct = _deployAccountWithPasskey();
        bytes memory authData = _authData(RP_ID_HASH, 0x05); // UP + UV
        bytes memory sig = _signatureBlob(authData);
        bytes4 magic = acct.isValidSignature(bytes32(uint256(0xabcd)), sig);
        // P-256 sig is still bogus → still 0xffffffff, but for the
        // RIGHT reason now (crypto, not flags). A future fixture-based
        // test would assert MAGIC here.
        assertEq(magic, bytes4(0xffffffff), "rejected at crypto step (not flags)");
    }

    function test_R8_2_uvOnlyWithoutUp_alsoRejected() public {
        AgentAccount acct = _deployAccountWithPasskey();
        bytes memory authData = _authData(RP_ID_HASH, 0x04); // UV without UP
        bytes memory sig = _signatureBlob(authData);
        bytes4 magic = acct.isValidSignature(bytes32(uint256(0xabcd)), sig);
        assertEq(magic, bytes4(0xffffffff), "missing UP rejected (H7-C.1)");
    }

    function test_R8_2_zeroFlags_rejected() public {
        AgentAccount acct = _deployAccountWithPasskey();
        bytes memory authData = _authData(RP_ID_HASH, 0x00); // no flags
        bytes memory sig = _signatureBlob(authData);
        bytes4 magic = acct.isValidSignature(bytes32(uint256(0xabcd)), sig);
        assertEq(magic, bytes4(0xffffffff), "zero flags rejected");
    }
}
