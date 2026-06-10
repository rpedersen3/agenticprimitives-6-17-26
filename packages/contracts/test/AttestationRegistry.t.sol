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

    /// @dev Mirror of AttestationRegistry's recomputed joint-consent digest (RW1-1).
    bytes32 internal constant JOINT_CONSENT_TYPEHASH = keccak256(
        "JointAgreementConsent(address party1,address party2,bytes32 agreementCommitment,bytes32 credentialHash)"
    );

    function _consentDigest(address p1, address p2, bytes32 refUID, bytes32 credHash)
        internal
        pure
        returns (bytes32)
    {
        return keccak256(abi.encode(JOINT_CONSENT_TYPEHASH, p1, p2, refUID, credHash));
    }

    /// @dev Mirrors AttestationRegistry.JOINT_ISSUER_TYPEHASH (ATT-1).
    bytes32 internal constant JOINT_ISSUER_TYPEHASH = keccak256(
        "JointAgreementIssuerAttestation(address party1,address party2,address issuer,bytes32 schemaId,bytes32 credentialType,bytes32 credentialHash,bytes32 agreementCommitment,uint256 chainId,address verifyingContract)"
    );

    function _jointIssuerDigest(AttestationRegistry.JointAgreementAttestationRequest memory req)
        internal
        view
        returns (bytes32)
    {
        return keccak256(
            abi.encode(
                JOINT_ISSUER_TYPEHASH,
                req.party1,
                req.party2,
                req.issuer,
                req.schemaId,
                req.credentialType,
                req.credentialHash,
                req.refUID,
                block.chainid,
                address(reg)
            )
        );
    }

    /// @dev Mirrors AttestationRegistry.ASSOCIATION_ATTESTATION_TYPEHASH (SC-2).
    bytes32 internal constant ASSOCIATION_ATTESTATION_TYPEHASH = keccak256(
        "AssociationAttestation(address subject,address issuer,bytes32 schemaId,bytes32 credentialType,bytes32 credentialHash,uint256 chainId,address verifyingContract)"
    );

    function _associationDigest(AttestationRegistry.AssociationAttestationRequest memory req)
        internal
        view
        returns (bytes32)
    {
        return keccak256(
            abi.encode(
                ASSOCIATION_ATTESTATION_TYPEHASH,
                req.subject,
                req.issuer,
                req.schemaId,
                req.credentialType,
                req.credentialHash,
                block.chainid,
                address(reg)
            )
        );
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
        req.issuerSignature = _sign(_associationDigest(req), ISSUER_PK);
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
        // Tamper signature: correct digest, WRONG signer.
        req.issuerSignature = _sign(_associationDigest(req), SUBJECT_PK);
        vm.expectRevert(AttestationRegistry.InvalidIssuerSignature.selector);
        reg.assertAssociation(req);
    }

    /// @dev SC-2: an issuer signature legitimately produced for one subject cannot be re-anchored
    ///      against a DIFFERENT subject — the on-chain digest binds the subject, so the swap fails.
    function test_assertAssociation_subjectSpoofReverts() public {
        bytes32 ch = keccak256("recognized-cred");
        AttestationRegistry.AssociationAttestationRequest memory req = _associationReq(ch, 0);
        // attacker swaps in a different subject but keeps the issuer's (now-foreign) signature
        req.subject = address(0xBEEF);
        vm.expectRevert(AttestationRegistry.InvalidIssuerSignature.selector);
        reg.assertAssociation(req);
    }

    function test_assertAssociation_shortIssuerSigReverts() public {
        bytes32 ch = keccak256("short-sig");
        AttestationRegistry.AssociationAttestationRequest memory req = _associationReq(ch, 0);
        req.issuerSignature = hex"01";
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
        req.party1 = subject;
        req.party2 = party2;
        req.issuer = issuer;
        req.issuerSignature = _sign(_jointIssuerDigest(req), ISSUER_PK);
        // RW1-1: both parties sign the recomputed consent digest.
        bytes32 cd = _consentDigest(subject, party2, req.refUID, ch);
        req.party1Signature = _sign(cd, SUBJECT_PK);
        req.party2Signature = _sign(cd, PARTY2_PK);

        bytes32 uid = reg.assertJointAgreement(req);
        AttestationRegistry.Attestation memory a = reg.getAttestation(uid);
        assertEq(a.subject, subject);
        assertEq(a.party2, party2);
        assertEq(a.refUID, req.refUID);
        // stored ref is the VERIFIED recomputed digest, not any supplied value.
        assertEq(a.bilateralConsentRef, cd);
    }

    function test_assertJointAgreement_missingPartyConsent_reverts() public {
        bytes32 ch = keccak256("missing-consent");
        AttestationRegistry.JointAgreementAttestationRequest memory req;
        req.credentialHash = ch;
        req.party1 = subject;
        req.party2 = party2;
        req.issuer = issuer;
        req.issuerSignature = _sign(_jointIssuerDigest(req), ISSUER_PK);
        // party1Signature / party2Signature left empty → consent verification fails closed.
        vm.expectRevert(AttestationRegistry.InvalidPartyConsent.selector);
        reg.assertJointAgreement(req);
    }

    function test_assertJointAgreement_wrongPartyConsent_reverts() public {
        bytes32 ch = keccak256("wrong-consent");
        AttestationRegistry.JointAgreementAttestationRequest memory req;
        req.credentialHash = ch;
        req.refUID = keccak256("ag");
        req.party1 = subject;
        req.party2 = party2;
        req.issuer = issuer;
        req.issuerSignature = _sign(_jointIssuerDigest(req), ISSUER_PK);
        bytes32 cd = _consentDigest(subject, party2, req.refUID, ch);
        req.party1Signature = _sign(cd, SUBJECT_PK); // valid
        req.party2Signature = _sign(cd, ISSUER_PK); // WRONG signer (issuer, not party2)
        vm.expectRevert(AttestationRegistry.InvalidPartyConsent.selector);
        reg.assertJointAgreement(req);
    }

    function test_assertJointAgreement_zeroPartyReverts() public {
        bytes32 ch = keccak256("zero-party");
        AttestationRegistry.JointAgreementAttestationRequest memory req;
        req.credentialHash = ch;
        req.party1 = address(0);
        req.party2 = party2;
        req.issuer = issuer;
        req.issuerSignature = _sign(_jointIssuerDigest(req), ISSUER_PK);
        req.bilateralConsentRef = keccak256("consent");
        vm.expectRevert(AttestationRegistry.InvalidParties.selector);
        reg.assertJointAgreement(req);
    }

    function test_assertJointAgreement_samePartyReverts() public {
        bytes32 ch = keccak256("same-party");
        AttestationRegistry.JointAgreementAttestationRequest memory req;
        req.credentialHash = ch;
        req.party1 = subject;
        req.party2 = subject;
        req.issuer = issuer;
        req.issuerSignature = _sign(_jointIssuerDigest(req), ISSUER_PK);
        req.bilateralConsentRef = keccak256("consent");
        vm.expectRevert(AttestationRegistry.InvalidParties.selector);
        reg.assertJointAgreement(req);
    }

    function test_assertJointAgreement_invalidIssuerSigReverts() public {
        bytes32 ch = keccak256("joint-bad-sig");
        AttestationRegistry.JointAgreementAttestationRequest memory req;
        req.credentialHash = ch;
        req.party1 = subject;
        req.party2 = party2;
        req.issuer = issuer;
        // correct digest, WRONG signer key → must revert InvalidIssuerSignature (ATT-1).
        req.issuerSignature = _sign(_jointIssuerDigest(req), SUBJECT_PK);
        req.bilateralConsentRef = keccak256("consent");
        vm.expectRevert(AttestationRegistry.InvalidIssuerSignature.selector);
        reg.assertJointAgreement(req);
    }

    function test_revokeOwnJointAgreement_eitherPartyAllowed() public {
        bytes32 ch = keccak256("joint-revoke");
        AttestationRegistry.JointAgreementAttestationRequest memory req;
        req.credentialHash = ch;
        req.party1 = subject;
        req.party2 = party2;
        req.issuer = issuer;
        req.refUID = keccak256("ag-cmt");
        req.issuerSignature = _sign(_jointIssuerDigest(req), ISSUER_PK);
        bytes32 cd = _consentDigest(subject, party2, req.refUID, ch);
        req.party1Signature = _sign(cd, SUBJECT_PK);
        req.party2Signature = _sign(cd, PARTY2_PK);
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
