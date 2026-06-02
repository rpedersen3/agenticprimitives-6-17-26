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

    function _sign(bytes32 digest, uint256 pk) internal pure returns (bytes memory) {
        bytes32 ethHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", digest));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, ethHash);
        return abi.encodePacked(r, s, v);
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
        bytes32 attestationHash = keccak256(abi.encodePacked(commitment, schemaHash));
        p = AgreementRegistry.AgreementIssuancePayload({
            schemaHash: schemaHash,
            issuer: issuer,
            attestationStructHash: attestationHash,
            issuerSignature: _sign(attestationHash, ISSUER_PK),
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
        p.issuerSignature = _sign(p.attestationStructHash, P1_PK); // wrong signer
        vm.expectRevert(AgreementRegistry.InvalidIssuerSignature.selector);
        reg.register(p);
    }

    // ─── Status transitions (AR-04..AR-06 + AR-08 nullifier) ────────────

    function _updatePayload(
        bytes32 commitment,
        uint8 toStatus,
        bytes32 nullifier,
        uint256 signer1pk,
        uint256 signer2pk
    ) internal view returns (AgreementRegistry.StatusUpdatePayload memory p) {
        bytes32 transitionHash = keccak256(abi.encodePacked(commitment, toStatus, nullifier));
        p = AgreementRegistry.StatusUpdatePayload({
            agreementCommitment: commitment,
            toStatus: toStatus,
            nullifier: nullifier,
            transitionStructHash: transitionHash,
            signature1: _sign(transitionHash, signer1pk),
            signature2: signer2pk == 0 ? bytes("") : _sign(transitionHash, signer2pk),
            signer1: vm.addr(signer1pk),
            signer2: signer2pk == 0 ? address(0) : vm.addr(signer2pk)
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
            0
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
            0 // no second signer
        );
        vm.expectRevert(AgreementRegistry.InvalidTransitionSignature.selector);
        reg.updateStatus(up);

        // Bilateral works
        AgreementRegistry.StatusUpdatePayload memory up2 = _updatePayload(
            cmt,
            reg.STATUS_COMPLETED(),
            keccak256("nullifier-3"),
            P1_PK,
            P2_PK
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
            0
        );
        reg.updateStatus(up);

        // Replay with same nullifier
        AgreementRegistry.StatusUpdatePayload memory up2 = _updatePayload(
            cmt,
            reg.STATUS_COMPLETED(),
            keccak256("nullifier-4"),
            P1_PK,
            P2_PK
        );
        vm.expectRevert(AgreementRegistry.NullifierUsed.selector);
        reg.updateStatus(up2);
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
