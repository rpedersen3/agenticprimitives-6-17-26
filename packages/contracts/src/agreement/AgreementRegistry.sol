// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/interfaces/IERC1271.sol";

/**
 * @title AgreementRegistry
 * @notice Commitment-only registry per spec 241 + ADR-0024 Decision 2.
 *
 *   ─── Substrate role ───
 *
 * Layer 8 of the coordination spine — Agreement / Commitment. Stores the
 * commitment HASH only (no agreement bodies, no party SAs). Bodies live in
 * party Joint Vaults; party SAs surface only through joint assertions
 * registered in the AttestationRegistry (which references our `commitmentHash`).
 *
 *   ─── Key invariants (AR-*) ───
 *
 * AR-01 register() recomputes the commitment from supplied components
 * AR-02 issuer EIP-712 attestation verified via ERC-1271
 * AR-03 schema validated against (off-chain) ShapeRegistry
 * AR-04 status state-machine: ACTIVE → COMPLETED | DISPUTED | REVOKED
 * AR-05 bilateral signing required for ACTIVE→COMPLETED, ACTIVE→REVOKED
 * AR-06 either-party for ACTIVE→DISPUTED
 * AR-07 NO issuerRevoke / issuerStatusUpdate entrypoint — by static analysis
 * AR-08 nullifier set prevents replay on status transitions
 * AR-09 epoch-bucket timestamps; raw block.timestamp never stored
 * AR-10 isAssertableCommitment view gateway for AttestationRegistry
 * AR-11 party SA addresses NEVER appear in register() calldata
 * AR-12 single on-chain row per agreement (D-37)
 */
contract AgreementRegistry {
    // ─── Constants ──────────────────────────────────────────────────────

    uint64 public constant EPOCH_SECONDS = 3600;

    uint8 public constant STATUS_NONE = 0;
    uint8 public constant STATUS_ACTIVE = 1;
    uint8 public constant STATUS_COMPLETED = 2;
    uint8 public constant STATUS_DISPUTED = 3;
    uint8 public constant STATUS_REVOKED = 4;

    /// @dev RW1-3 (ADR-0027): the contract RECOMPUTES the transition digest the
    ///      parties sign from (agreementCommitment, toStatus, nullifier) — it no
    ///      longer trusts a caller-supplied `transitionStructHash`. One canonical
    ///      digest model; the TS side derives the same constant (cross-stack
    ///      typehash-equality gate). Plain struct hash (no domain separator),
    ///      matching the attestation registry's JOINT_CONSENT_TYPEHASH.
    bytes32 internal constant TRANSITION_TYPEHASH =
        keccak256("AgreementTransition(bytes32 agreementCommitment,uint8 toStatus,bytes32 nullifier)");

    /// @dev SC-1 (audit 2026-06-09): the issuer attestation digest is RECOMPUTED on-chain from the
    ///      agreement's contents + chain + this contract — it is NOT a caller-supplied free-form hash.
    ///      Binds (agreementCommitment, schemaHash, issuer, chainId, verifyingContract) so a signature
    ///      lifted from any other context cannot back an attacker-chosen commitment. The TS side derives
    ///      the same constant (cross-stack typehash-equality gate).
    bytes32 internal constant AGREEMENT_ISSUER_TYPEHASH = keccak256(
        "AgreementIssuerAttestation(bytes32 agreementCommitment,bytes32 schemaHash,address issuer,uint256 chainId,address verifyingContract)"
    );

    // ─── Errors ─────────────────────────────────────────────────────────

    error AlreadyRegistered();
    error NotRegistered();
    error InvalidStatus();
    error InvalidIssuerSignature();
    error InvalidTransitionSignature();
    error NullifierUsed();
    error CommitmentMismatch();
    error SignerNotParty();

    // ─── Storage ────────────────────────────────────────────────────────

    struct AgreementRow {
        bytes32 agreementCommitment; // canonical commitment hash
        bytes32 schemaHash; // SHACL shape hash from ShapeRegistry
        address issuer; // SA whose EIP-712 attestation backs the commitment
        uint8 status;
        uint64 createdEpochBucket;
        uint64 lastTransitionEpochBucket;
    }

    /// @dev key = agreementCommitment hash
    mapping(bytes32 => AgreementRow) private _rows;

    /// @dev AR-08: nullifier set for replay protection on status transitions.
    mapping(bytes32 => bool) private _nullifiers;

    // ─── Requests ───────────────────────────────────────────────────────

    /// @notice The components the contract recomputes the commitment from
    ///         (per spec 241 §3). Party SAs are intentionally NOT in this
    ///         payload — AR-11.
    struct AgreementIssuancePayload {
        bytes32 schemaHash;
        address issuer;
        /// @dev issuer's signature over the RECOMPUTED issuer-attestation digest (SC-1). The contract
        ///      derives the digest from the payload contents — no caller-supplied attestation hash.
        bytes issuerSignature;
        /// @dev The asserted canonical commitment hash; we verify recomputation.
        bytes32 agreementCommitment;
        /// @dev Component commitments for AR-01 recomputation:
        ///      keccak256(partySet, issuerCommitment, termsCommitment, scheduleCommitment, salt) == agreementCommitment
        bytes32 partySetCommitment;
        bytes32 issuerCommitment;
        bytes32 termsCommitment;
        bytes32 scheduleCommitment;
        uint256 salt;
    }

    struct StatusUpdatePayload {
        bytes32 agreementCommitment;
        uint8 toStatus;
        bytes32 nullifier;
        /// @dev Signatures over the RECOMPUTED transition digest (RW1-3): 1 for
        ///      either-party (DISPUTED), 2 for bilateral (COMPLETED/REVOKED).
        bytes signature1;
        bytes signature2;
        /// @dev Party SAs that signed. For DISPUTED: signer1 only. For COMPLETED/REVOKED: both.
        address signer1;
        address signer2;
        /// @dev RW1-2 (ADR-0027): the agreement's parties + commitment components, REVEALED at
        ///      transition time so the contract can recompute the commitment and PROVE the signers
        ///      are the parties. (Registration stays commitment-only — AR-12; the transition is
        ///      already a public state change that names its signers.)
        address party1;
        address party2;
        bytes32 issuerCommitment;
        bytes32 termsCommitment;
        bytes32 scheduleCommitment;
        uint256 commitmentSalt;
    }

    // ─── Events ─────────────────────────────────────────────────────────

    event AgreementRegistered(
        bytes32 indexed agreementCommitment,
        address indexed issuer,
        bytes32 indexed schemaHash,
        uint64 epochBucket
    );

    event StatusUpdated(
        bytes32 indexed agreementCommitment,
        uint8 indexed fromStatus,
        uint8 indexed toStatus,
        uint64 epochBucket
    );

    // ─── Public surface ─────────────────────────────────────────────────

    /// @notice Register an agreement by its commitment hash.
    function register(AgreementIssuancePayload calldata p) external returns (bytes32) {
        // AR-01 — recompute commitment from components
        bytes32 recomputed = keccak256(
            abi.encode(p.partySetCommitment, p.issuerCommitment, p.termsCommitment, p.scheduleCommitment, p.salt)
        );
        if (recomputed != p.agreementCommitment) revert CommitmentMismatch();

        if (_rows[p.agreementCommitment].agreementCommitment != bytes32(0)) {
            revert AlreadyRegistered();
        }

        // AR-02 / SC-1 — RECOMPUTE the issuer-attestation digest from the agreement contents (+ chain +
        // this contract) and verify the issuer signed THAT. A signature over an arbitrary digest from
        // any other context can no longer back an attacker-chosen commitment.
        bytes32 issuerDigest = keccak256(
            abi.encode(
                AGREEMENT_ISSUER_TYPEHASH,
                p.agreementCommitment,
                p.schemaHash,
                p.issuer,
                block.chainid,
                address(this)
            )
        );
        if (!_isValidSignatureBool(p.issuer, issuerDigest, p.issuerSignature)) {
            revert InvalidIssuerSignature();
        }

        uint64 bucket = uint64(block.timestamp) / EPOCH_SECONDS;

        _rows[p.agreementCommitment] = AgreementRow({
            agreementCommitment: p.agreementCommitment,
            schemaHash: p.schemaHash,
            issuer: p.issuer,
            status: STATUS_ACTIVE,
            createdEpochBucket: bucket,
            lastTransitionEpochBucket: bucket
        });

        emit AgreementRegistered(p.agreementCommitment, p.issuer, p.schemaHash, bucket);
        return p.agreementCommitment;
    }

    /// @notice Update the agreement status. Signing requirements (AR-04..AR-06):
    ///         - DISPUTED: signer1 (either party) only
    ///         - COMPLETED / REVOKED: both signer1 + signer2 (bilateral)
    ///         RW1-2 (ADR-0027): the caller REVEALS the parties + commitment
    ///         components; the contract recomputes the commitment (register's
    ///         exact formula) and requires each signer to BE one of the two
    ///         parties. The on-chain row still stores NO party SAs (AR-11 covers
    ///         register() calldata only); the parties surface here because a
    ///         status transition is already a public state change that names its
    ///         signers. Replay protection comes from the nullifier. RW1-3: the
    ///         transition digest the parties sign is RECOMPUTED here from
    ///         (agreementCommitment, toStatus, nullifier) — not caller-supplied.
    function updateStatus(StatusUpdatePayload calldata p) external {
        AgreementRow storage row = _rows[p.agreementCommitment];
        if (row.agreementCommitment == bytes32(0)) revert NotRegistered();

        // Status transition validity (AR-04)
        if (row.status != STATUS_ACTIVE && row.status != STATUS_DISPUTED) revert InvalidStatus();
        if (
            p.toStatus != STATUS_COMPLETED &&
            p.toStatus != STATUS_DISPUTED &&
            p.toStatus != STATUS_REVOKED
        ) {
            revert InvalidStatus();
        }
        // DISPUTED → COMPLETED / REVOKED needs bilateral.
        // ACTIVE → DISPUTED: either-party allowed.
        // ACTIVE → COMPLETED / REVOKED: bilateral.

        // AR-08 — replay protection
        if (_nullifiers[p.nullifier]) revert NullifierUsed();
        _nullifiers[p.nullifier] = true;

        // RW1-2 (ADR-0027): PROVE the signers are the agreement's parties. Recompute the agreement
        // commitment from the REVEALED parties + components (register's exact formula) and require it
        // to equal the row's commitment; then require each signer to BE a party. The caller-supplied
        // signer set is no longer trusted (a nonzero commitment ref / arbitrary signer is not authority).
        {
            bytes32 partySet = keccak256(abi.encodePacked(p.party1, p.party2));
            bytes32 recomputed = keccak256(
                abi.encode(partySet, p.issuerCommitment, p.termsCommitment, p.scheduleCommitment, p.commitmentSalt)
            );
            if (recomputed != p.agreementCommitment) revert CommitmentMismatch();
        }

        // RW1-3 (ADR-0027): RECOMPUTE the transition digest the parties sign — do not trust a
        // caller-supplied hash. The signed payload is canonically bound to (commitment, toStatus,
        // nullifier) here, on chain.
        bytes32 transitionDigest = keccak256(
            abi.encode(TRANSITION_TYPEHASH, p.agreementCommitment, p.toStatus, p.nullifier)
        );

        bool bilateralRequired = (p.toStatus != STATUS_DISPUTED);

        // signer1 must BE a party, and must have signed.
        if (p.signer1 != p.party1 && p.signer1 != p.party2) revert SignerNotParty();
        if (!_isValidSignatureBool(p.signer1, transitionDigest, p.signature1)) {
            revert InvalidTransitionSignature();
        }
        if (bilateralRequired) {
            // both DISTINCT parties must sign.
            if (p.signer2 == address(0) || p.signer2 == p.signer1) revert InvalidTransitionSignature();
            if (p.signer2 != p.party1 && p.signer2 != p.party2) revert SignerNotParty();
            if (!_isValidSignatureBool(p.signer2, transitionDigest, p.signature2)) {
                revert InvalidTransitionSignature();
            }
        }

        uint8 fromStatus = row.status;
        row.status = p.toStatus;
        row.lastTransitionEpochBucket = uint64(block.timestamp) / EPOCH_SECONDS;

        emit StatusUpdated(p.agreementCommitment, fromStatus, p.toStatus, row.lastTransitionEpochBucket);
    }

    /// @notice Gateway for spec 242 AttestationRegistry.assertJointAgreement.
    ///         Returns (true, "") if the commitment exists and is in a state
    ///         that permits public joint assertion (currently any non-NONE
    ///         status; revoked agreements can still be jointly disclosed as
    ///         historical record).
    function isAssertableCommitment(
        bytes32 agreementCommitment,
        address /* actor */
    ) external view returns (bool ok, string memory reason) {
        AgreementRow memory row = _rows[agreementCommitment];
        if (row.agreementCommitment == bytes32(0)) return (false, "not-registered");
        return (true, "");
    }

    /// @notice Get the on-chain row.
    function getRecord(bytes32 agreementCommitment) external view returns (AgreementRow memory) {
        AgreementRow memory row = _rows[agreementCommitment];
        if (row.agreementCommitment == bytes32(0)) revert NotRegistered();
        return row;
    }

    /// @notice Has a nullifier been consumed?
    function isNullifierUsed(bytes32 n) external view returns (bool) {
        return _nullifiers[n];
    }

    // ─── Internal ───────────────────────────────────────────────────────

    function _isValidSignatureBool(
        address signer,
        bytes32 digest,
        bytes memory signature
    ) internal view returns (bool) {
        if (signer.code.length > 0) {
            try IERC1271(signer).isValidSignature(digest, signature) returns (bytes4 result) {
                return result == IERC1271.isValidSignature.selector;
            } catch {
                return false;
            }
        }
        bytes32 ethHash = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", digest));
        if (signature.length != 65) return false;
        bytes32 r;
        bytes32 s;
        uint8 v;
        // solhint-disable-next-line no-inline-assembly
        assembly {
            r := mload(add(signature, 0x20))
            s := mload(add(signature, 0x40))
            v := byte(0, mload(add(signature, 0x60)))
        }
        if (v < 27) v += 27;
        address recovered = ecrecover(ethHash, v, r, s);
        return recovered != address(0) && recovered == signer;
    }
}
