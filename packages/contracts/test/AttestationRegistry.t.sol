// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Test.sol";
import "../src/attestation/AttestationRegistry.sol";

contract AttestationRegistryTest is Test {
    AttestationRegistry reg;

    uint256 internal constant SUBJECT_PK = 0xA11CE;
    uint256 internal constant ISSUER_PK = 0xB0B;
    uint256 internal constant PARTY2_PK = 0xC0FFEE;
    address internal subject;
    address internal issuer;
    address internal party2;

    function setUp() public {
        reg = new AttestationRegistry();
        subject = vm.addr(SUBJECT_PK);
        issuer = vm.addr(ISSUER_PK);
        party2 = vm.addr(PARTY2_PK);
        // Warp past EPOCH_SECONDS so epochBucket arithmetic distinguishes
        // "not revoked" (0) from "revoked at bucket 0".
        vm.warp(reg.EPOCH_SECONDS() * 100);
    }

    function _sign(bytes32 digest, uint256 pk) internal pure returns (bytes memory) {
        bytes32 ethHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", digest));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, ethHash);
        return abi.encodePacked(r, s, v);
    }

    function _associationReq(
        bytes32 credentialHash,
        uint256 salt
    ) internal view returns (AttestationRegistry.AssociationAttestationRequest memory req) {
        req.schemaId = keccak256("AssociationCredentialSchema:v1");
        req.credentialType = keccak256("AssociationCredential");
        req.credentialHash = credentialHash;
        req.offchainCredentialStatusList = bytes32(0);
        req.subject = subject;
        req.issuer = issuer;
        req.issuerSignature = _sign(credentialHash, ISSUER_PK);
        req.salt = salt;
    }

    // ─── assertAssociation happy paths ──────────────────────────────────

    function test_assertAssociation_happyPath() public {
        bytes32 ch = keccak256("test-credential-1");
        AttestationRegistry.AssociationAttestationRequest memory req = _associationReq(ch, 0);

        bytes32 uid = reg.assertAssociation(req);
        assertTrue(uid != bytes32(0));

        AttestationRegistry.Attestation memory a = reg.getAttestation(uid);
        assertEq(a.subject, subject);
        assertEq(a.party2, address(0));
        assertEq(a.issuer, issuer);
        assertEq(a.credentialHash, ch);
        assertEq(a.revocationEpochBucket, 0);
        assertTrue(reg.isValid(uid));
    }

    function test_assertAssociation_duplicateReverts() public {
        bytes32 ch = keccak256("dup");
        AttestationRegistry.AssociationAttestationRequest memory req = _associationReq(ch, 0);
        reg.assertAssociation(req);
        vm.expectRevert(AttestationRegistry.AttestationAlreadyExists.selector);
        reg.assertAssociation(req);
    }

    function test_assertAssociation_invalidIssuerSigReverts() public {
        bytes32 ch = keccak256("bad-sig");
        AttestationRegistry.AssociationAttestationRequest memory req = _associationReq(ch, 0);
        // Tamper signature
        req.issuerSignature = _sign(ch, SUBJECT_PK); // signed by wrong key
        vm.expectRevert(AttestationRegistry.InvalidIssuerSignature.selector);
        reg.assertAssociation(req);
    }

    function test_assertAssociation_emptyHashReverts() public {
        AttestationRegistry.AssociationAttestationRequest memory req = _associationReq(bytes32(0), 0);
        vm.expectRevert(AttestationRegistry.EmptyCredentialHash.selector);
        reg.assertAssociation(req);
    }

    // ─── Holder-only revocation (AR-05) ─────────────────────────────────

    function test_revokeOwnAssociation_byHolder() public {
        bytes32 ch = keccak256("revoke-me");
        AttestationRegistry.AssociationAttestationRequest memory req = _associationReq(ch, 0);
        bytes32 uid = reg.assertAssociation(req);

        vm.prank(subject);
        reg.revokeOwnAssociation(uid, keccak256("user-changed-mind"));
        assertFalse(reg.isValid(uid));
    }

    function test_revokeOwnAssociation_byNonHolderReverts() public {
        bytes32 ch = keccak256("not-you");
        AttestationRegistry.AssociationAttestationRequest memory req = _associationReq(ch, 0);
        bytes32 uid = reg.assertAssociation(req);

        vm.prank(party2);
        vm.expectRevert(AttestationRegistry.NotSubject.selector);
        reg.revokeOwnAssociation(uid, bytes32(0));
    }

    function test_revokeOwnAssociation_doubleRevokeReverts() public {
        bytes32 ch = keccak256("twice");
        AttestationRegistry.AssociationAttestationRequest memory req = _associationReq(ch, 0);
        bytes32 uid = reg.assertAssociation(req);

        vm.prank(subject);
        reg.revokeOwnAssociation(uid, bytes32(0));

        vm.prank(subject);
        vm.expectRevert(AttestationRegistry.AlreadyRevoked.selector);
        reg.revokeOwnAssociation(uid, bytes32(0));
    }

    // ─── Joint attestation (AR-04..AR-06) ───────────────────────────────

    function test_assertJointAgreement_happyPath() public {
        bytes32 ch = keccak256("joint-cred");
        AttestationRegistry.JointAgreementAttestationRequest memory req;
        req.schemaId = keccak256("AgreementCredentialSchema:v1");
        req.credentialType = keccak256("JointAgreementAttestation");
        req.credentialHash = ch;
        req.refUID = keccak256("agreement-commitment");
        req.bilateralConsentRef = keccak256("bilateral-consent");
        req.party1 = subject;
        req.party2 = party2;
        req.issuer = issuer;
        req.issuerSignature = _sign(ch, ISSUER_PK);

        bytes32 uid = reg.assertJointAgreement(req);
        AttestationRegistry.Attestation memory a = reg.getAttestation(uid);
        assertEq(a.subject, subject);
        assertEq(a.party2, party2);
        assertEq(a.refUID, req.refUID);
        assertEq(a.bilateralConsentRef, req.bilateralConsentRef);
    }

    function test_assertJointAgreement_zeroBilateralRefReverts() public {
        bytes32 ch = keccak256("missing-consent");
        AttestationRegistry.JointAgreementAttestationRequest memory req;
        req.credentialHash = ch;
        req.party1 = subject;
        req.party2 = party2;
        req.issuer = issuer;
        req.issuerSignature = _sign(ch, ISSUER_PK);
        // bilateralConsentRef defaults to bytes32(0)
        vm.expectRevert(AttestationRegistry.InvalidParties.selector);
        reg.assertJointAgreement(req);
    }

    function test_revokeOwnJointAgreement_eitherPartyAllowed() public {
        bytes32 ch = keccak256("joint-revoke");
        AttestationRegistry.JointAgreementAttestationRequest memory req;
        req.credentialHash = ch;
        req.party1 = subject;
        req.party2 = party2;
        req.issuer = issuer;
        req.issuerSignature = _sign(ch, ISSUER_PK);
        req.refUID = keccak256("ag-cmt");
        req.bilateralConsentRef = keccak256("consent");
        bytes32 uid = reg.assertJointAgreement(req);

        // party2 (not party1) revokes
        vm.prank(party2);
        reg.revokeOwnJointAgreement(uid, bytes32(0));
        assertFalse(reg.isValid(uid));
    }

    // ─── AR-06 / AR-07: no issuer-revoke ────────────────────────────────

    function test_AR06_noIssuerRevokeEntrypoint() public {
        // Issuer cannot revoke. The contract has NO issuerRevoke selector.
        bytes32 ch = keccak256("issuer-cannot-revoke");
        AttestationRegistry.AssociationAttestationRequest memory req = _associationReq(ch, 0);
        bytes32 uid = reg.assertAssociation(req);

        vm.prank(issuer);
        vm.expectRevert(AttestationRegistry.NotSubject.selector);
        reg.revokeOwnAssociation(uid, bytes32(0));
        assertTrue(reg.isValid(uid));
    }
}
