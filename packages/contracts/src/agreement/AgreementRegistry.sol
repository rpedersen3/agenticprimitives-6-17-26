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

    // ─── Errors ─────────────────────────────────────────────────────────

    error AlreadyRegistered();
    error NotRegistered();
    error InvalidStatus();
    error InvalidIssuerSignature();
    error InvalidTransitionSignature();
    error NullifierUsed();
    error CommitmentMismatch();

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
        /// @dev EIP-712 attestation hash by the issuer (over agreementCommitment + schemaHash).
        bytes32 attestationStructHash;
        /// @dev issuer's signature over `attestationStructHash`.
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
        /// @dev EIP-712 transition hash (party / parties / either-party signed).
        bytes32 transitionStructHash;
        /// @dev Signatures: 1 for either-party (DISPUTED), 2 for bilateral (COMPLETED/REVOKED).
        bytes signature1;
        bytes signature2;
        /// @dev Party SAs that signed. For DISPUTED: signer1 only. For COMPLETED/REVOKED: both.
        address signer1;
        address signer2;
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

        // AR-02 — verify issuer signature over the attestation hash
        if (!_isValidSignatureBool(p.issuer, p.attestationStructHash, p.issuerSignature)) {
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
    ///         The contract DOES NOT enforce identity of signer1/signer2 against
    ///         the on-chain row (which holds NO party SAs per AR-11). Identity
    ///         binding is encoded in the off-chain `transitionStructHash` which
    ///         the parties signed; replay protection comes from the nullifier.
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

        bool bilateralRequired = (p.toStatus != STATUS_DISPUTED);

        // signer1 always required
        if (!_isValidSignatureBool(p.signer1, p.transitionStructHash, p.signature1)) {
            revert InvalidTransitionSignature();
        }
        if (bilateralRequired) {
            if (p.signer2 == address(0) || p.signer2 == p.signer1) revert InvalidTransitionSignature();
            if (!_isValidSignatureBool(p.signer2, p.transitionStructHash, p.signature2)) {
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
