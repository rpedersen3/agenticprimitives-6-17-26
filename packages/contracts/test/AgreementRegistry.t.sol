// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "forge-std/Test.sol";
import "../src/agreement/AgreementRegistry.sol";

contract AgreementRegistryTest is Test {
    AgreementRegistry reg;

    uint256 internal constant ISSUER_PK = 0xA11CE;
    uint256 internal constant P1_PK = 0xB0B;
    uint256 internal constant P2_PK = 0xC0FFEE;
    address internal issuer;
    address internal p1;
    address internal p2;

    function setUp() public {
        reg = new AgreementRegistry();
        issuer = vm.addr(ISSUER_PK);
        p1 = vm.addr(P1_PK);
        p2 = vm.addr(P2_PK);
    }

    /// @dev Mirrors AgreementRegistry.TRANSITION_TYPEHASH (RW1-3).
    bytes32 internal constant TRANSITION_TYPEHASH =
        keccak256("AgreementTransition(bytes32 agreementCommitment,uint8 toStatus,bytes32 nullifier)");

    /// @dev Mirrors AgreementRegistry.AGREEMENT_ISSUER_TYPEHASH (SC-1).
    bytes32 internal constant AGREEMENT_ISSUER_TYPEHASH = keccak256(
        "AgreementIssuerAttestation(bytes32 agreementCommitment,bytes32 schemaHash,address issuer,uint256 chainId,address verifyingContract)"
    );

    function _issuerDigest(bytes32 commitment, bytes32 schemaHash) internal view returns (bytes32) {
        return keccak256(
            abi.encode(AGREEMENT_ISSUER_TYPEHASH, commitment, schemaHash, issuer, block.chainid, address(reg))
        );
    }

    function _sign(bytes32 digest, uint256 pk) internal pure returns (bytes memory) {
        bytes32 ethHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", digest));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, ethHash);
        return abi.encodePacked(r, s, v);
    }

    /// @dev The canonical transition digest the contract recomputes (RW1-3).
    function _transitionDigest(
        bytes32 commitment,
        uint8 toStatus,
        bytes32 nullifier
    ) internal pure returns (bytes32) {
        return keccak256(abi.encode(TRANSITION_TYPEHASH, commitment, toStatus, nullifier));
    }

    function _buildPayload(
        bytes32 schemaHash,
        uint256 salt
    ) internal view returns (AgreementRegistry.AgreementIssuancePayload memory p) {
        bytes32 partySetCommitment = keccak256(abi.encodePacked(p1, p2));
        bytes32 issuerCommitment = keccak256(abi.encodePacked(issuer));
        bytes32 termsCommitment = keccak256("terms");
        bytes32 scheduleCommitment = keccak256("schedule");
        bytes32 commitment = keccak256(
            abi.encode(partySetCommitment, issuerCommitment, termsCommitment, scheduleCommitment, salt)
        );
        p = AgreementRegistry.AgreementIssuancePayload({
            schemaHash: schemaHash,
            issuer: issuer,
            issuerSignature: _sign(_issuerDigest(commitment, schemaHash), ISSUER_PK),
            agreementCommitment: commitment,
            partySetCommitment: partySetCommitment,
            issuerCommitment: issuerCommitment,
            termsCommitment: termsCommitment,
            scheduleCommitment: scheduleCommitment,
            salt: salt
        });
    }

    // ─── register() happy + negative ────────────────────────────────────

    function test_register_happyPath() public {
        AgreementRegistry.AgreementIssuancePayload memory p = _buildPayload(keccak256("schema-v1"), 0);
        bytes32 cmt = reg.register(p);
        assertEq(cmt, p.agreementCommitment);

        AgreementRegistry.AgreementRow memory r = reg.getRecord(cmt);
        assertEq(r.issuer, issuer);
        assertEq(uint8(r.status), uint8(reg.STATUS_ACTIVE()));
    }

    function test_register_commitmentMismatchReverts() public {
        AgreementRegistry.AgreementIssuancePayload memory p = _buildPayload(keccak256("schema-v1"), 0);
        p.agreementCommitment = keccak256("tampered");
        vm.expectRevert(AgreementRegistry.CommitmentMismatch.selector);
        reg.register(p);
    }

    function test_register_duplicateReverts() public {
        AgreementRegistry.AgreementIssuancePayload memory p = _buildPayload(keccak256("schema-v1"), 1);
        reg.register(p);
        vm.expectRevert(AgreementRegistry.AlreadyRegistered.selector);
        reg.register(p);
    }

    function test_register_badIssuerSigReverts() public {
        AgreementRegistry.AgreementIssuancePayload memory p = _buildPayload(keccak256("schema-v1"), 2);
        p.issuerSignature = _sign(_issuerDigest(p.agreementCommitment, p.schemaHash), P1_PK); // wrong signer
        vm.expectRevert(AgreementRegistry.InvalidIssuerSignature.selector);
        reg.register(p);
    }

    /// @dev SC-1: a valid issuer signature lifted from ANOTHER context (an arbitrary digest, e.g. a
    ///      different agreement or a foreign contract) cannot back this commitment — the digest is
    ///      recomputed on-chain from the actual contents, so the foreign signature fails to verify.
    function test_register_foreignIssuerSigReverts() public {
        AgreementRegistry.AgreementIssuancePayload memory p = _buildPayload(keccak256("schema-v1"), 3);
        // issuer DID sign something — but over an attacker-chosen digest X, not the recomputed one.
        bytes32 foreignDigest = keccak256("some-other-context");
        p.issuerSignature = _sign(foreignDigest, ISSUER_PK);
        vm.expectRevert(AgreementRegistry.InvalidIssuerSignature.selector);
        reg.register(p);
    }

    // ─── Status transitions (AR-04..AR-06 + AR-08 nullifier) ────────────

    /// @dev `salt` must match the salt the agreement was registered with so the
    ///      RW1-2 recompute (partySet + components + salt) equals `commitment`.
    function _updatePayload(
        bytes32 commitment,
        uint8 toStatus,
        bytes32 nullifier,
        uint256 signer1pk,
        uint256 signer2pk,
        uint256 salt
    ) internal view returns (AgreementRegistry.StatusUpdatePayload memory p) {
        bytes32 transitionDigest = _transitionDigest(commitment, toStatus, nullifier);
        p = AgreementRegistry.StatusUpdatePayload({
            agreementCommitment: commitment,
            toStatus: toStatus,
            nullifier: nullifier,
            signature1: _sign(transitionDigest, signer1pk),
            signature2: signer2pk == 0 ? bytes("") : _sign(transitionDigest, signer2pk),
            signer1: vm.addr(signer1pk),
            signer2: signer2pk == 0 ? address(0) : vm.addr(signer2pk),
            party1: p1,
            party2: p2,
            issuerCommitment: keccak256(abi.encodePacked(issuer)),
            termsCommitment: keccak256("terms"),
            scheduleCommitment: keccak256("schedule"),
            commitmentSalt: salt
        });
    }

    function test_updateStatus_disputedEitherParty() public {
        AgreementRegistry.AgreementIssuancePayload memory ip = _buildPayload(keccak256("schema-v1"), 3);
        bytes32 cmt = reg.register(ip);

        AgreementRegistry.StatusUpdatePayload memory up = _updatePayload(
            cmt,
            reg.STATUS_DISPUTED(),
            keccak256("nullifier-1"),
            P1_PK,
            0,
            3
        );
        reg.updateStatus(up);

        AgreementRegistry.AgreementRow memory r = reg.getRecord(cmt);
        assertEq(uint8(r.status), uint8(reg.STATUS_DISPUTED()));
    }

    function test_updateStatus_completedRequiresBilateral() public {
        AgreementRegistry.AgreementIssuancePayload memory ip = _buildPayload(keccak256("schema-v1"), 4);
        bytes32 cmt = reg.register(ip);

        // Single signature should fail
        AgreementRegistry.StatusUpdatePayload memory up = _updatePayload(
            cmt,
            reg.STATUS_COMPLETED(),
            keccak256("nullifier-2"),
            P1_PK,
            0, // no second signer
            4
        );
        vm.expectRevert(AgreementRegistry.InvalidTransitionSignature.selector);
        reg.updateStatus(up);

        // Bilateral works
        AgreementRegistry.StatusUpdatePayload memory up2 = _updatePayload(
            cmt,
            reg.STATUS_COMPLETED(),
            keccak256("nullifier-3"),
            P1_PK,
            P2_PK,
            4
        );
        reg.updateStatus(up2);
        AgreementRegistry.AgreementRow memory r = reg.getRecord(cmt);
        assertEq(uint8(r.status), uint8(reg.STATUS_COMPLETED()));
    }

    function test_updateStatus_nullifierReplayReverts() public {
        AgreementRegistry.AgreementIssuancePayload memory ip = _buildPayload(keccak256("schema-v1"), 5);
        bytes32 cmt = reg.register(ip);

        AgreementRegistry.StatusUpdatePayload memory up = _updatePayload(
            cmt,
            reg.STATUS_DISPUTED(),
            keccak256("nullifier-4"),
            P1_PK,
            0,
            5
        );
        reg.updateStatus(up);

        // Replay with same nullifier
        AgreementRegistry.StatusUpdatePayload memory up2 = _updatePayload(
            cmt,
            reg.STATUS_COMPLETED(),
            keccak256("nullifier-4"),
            P1_PK,
            P2_PK,
            5
        );
        vm.expectRevert(AgreementRegistry.NullifierUsed.selector);
        reg.updateStatus(up2);
    }

    // ─── RW1-2 (ADR-0027) — signers must BE the agreement's parties ─────

    uint256 internal constant STRANGER_PK = 0xBEEF;

    function test_updateStatus_signerNotPartyReverts() public {
        AgreementRegistry.AgreementIssuancePayload memory ip = _buildPayload(keccak256("schema-v1"), 7);
        bytes32 cmt = reg.register(ip);

        // A non-party signs (and the signature is genuine) — still rejected, because
        // the signer is not one of the two parties the commitment recomputes to.
        AgreementRegistry.StatusUpdatePayload memory up = _updatePayload(
            cmt,
            reg.STATUS_DISPUTED(),
            keccak256("nullifier-stranger"),
            STRANGER_PK,
            0,
            7
        );
        vm.expectRevert(AgreementRegistry.SignerNotParty.selector);
        reg.updateStatus(up);
    }

    function test_updateStatus_secondSignerNotPartyReverts() public {
        AgreementRegistry.AgreementIssuancePayload memory ip = _buildPayload(keccak256("schema-v1"), 8);
        bytes32 cmt = reg.register(ip);

        // signer1 is a party, signer2 is a stranger → bilateral fails on the party check.
        AgreementRegistry.StatusUpdatePayload memory up = _updatePayload(
            cmt,
            reg.STATUS_COMPLETED(),
            keccak256("nullifier-stranger2"),
            P1_PK,
            STRANGER_PK,
            8
        );
        vm.expectRevert(AgreementRegistry.SignerNotParty.selector);
        reg.updateStatus(up);
    }

    function test_updateStatus_revealedComponentMismatchReverts() public {
        AgreementRegistry.AgreementIssuancePayload memory ip = _buildPayload(keccak256("schema-v1"), 9);
        bytes32 cmt = reg.register(ip);

        // Tamper a revealed component so the recompute no longer equals the row's commitment.
        AgreementRegistry.StatusUpdatePayload memory up = _updatePayload(
            cmt,
            reg.STATUS_DISPUTED(),
            keccak256("nullifier-mismatch"),
            P1_PK,
            0,
            9
        );
        up.termsCommitment = keccak256("tampered-terms");
        vm.expectRevert(AgreementRegistry.CommitmentMismatch.selector);
        reg.updateStatus(up);
    }

    function test_isAssertableCommitment_gateway() public {
        AgreementRegistry.AgreementIssuancePayload memory ip = _buildPayload(keccak256("schema-v1"), 6);
        bytes32 cmt = reg.register(ip);
        (bool ok, ) = reg.isAssertableCommitment(cmt, p1);
        assertTrue(ok);

        (bool ok2, string memory reason) = reg.isAssertableCommitment(keccak256("nope"), p1);
        assertFalse(ok2);
        assertEq(reason, "not-registered");
    }
}
