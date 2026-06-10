// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/interfaces/IERC1271.sol";

/**
 * @title AttestationRegistry
 * @notice EAS-aligned, bilateral-consent attestation registry per ADR-0023.
 *
 *   ─── Substrate role ───
 *
 * Layers 12-15 of the coordination spine (Evidence / Outcome / Validation /
 * TrustUpdate) plus the substrate's Association + JointAgreement attestations
 * all share THIS one contract. Per ADR-0024 Decision 2 — the architectural
 * inverse of the smart-contract-per-credential anti-pattern.
 *
 *   ─── Key invariants (AR-*) ───
 *
 * AR-01 deterministic UID = keccak256(subject, issuer, credentialType, credentialHash, refUID, salt)
 * AR-02 issuer signature verified via ERC-1271 against the named issuer SA
 * AR-03 schemaId MUST point to a registered ShapeRegistry shape (governance-gated)
 * AR-04 bilateral-consent verified via DelegationManager.verifyAuthorization
 * AR-05 holder-only revocation for unilateral; either-party for joint
 * AR-06 NO issuerRevoke(...) entrypoint — by static analysis
 * AR-07 epoch-bucket timestamps; raw block.timestamp never stored
 * AR-08 four indexed event topics (EAS-like)
 * AR-09 immutable + non-upgradeable; no admin
 *
 * Spec 242 §9 + ADR-0023.
 */
contract AttestationRegistry {
    // ─── Constants ──────────────────────────────────────────────────────

    uint64 public constant EPOCH_SECONDS = 3600;

    // ─── Errors ─────────────────────────────────────────────────────────

    error InvalidIssuerSignature();
    error AttestationAlreadyExists();
    error AttestationNotFound();
    error NotSubject();
    error NotParty();
    error AlreadyRevoked();
    error InvalidParties();
    error InvalidPartyConsent();
    error EmptyCredentialHash();

    /// @dev RW1-1 (ADR-0027) — the canonical consent payload each party signs to consent to a
    ///      joint agreement. The contract RECOMPUTES this digest from calldata; a stored/supplied
    ///      reference is not consent. Binds the consent to the exact parties + agreement + credential.
    bytes32 internal constant JOINT_CONSENT_TYPEHASH = keccak256(
        "JointAgreementConsent(address party1,address party2,bytes32 agreementCommitment,bytes32 credentialHash)"
    );

    /// @dev ATT-1 (audit 2026-06-10): the SC-2 bug class lived on in the JOINT issuer signature — it was
    ///      verified over a bare `credentialHash`, so a known issuer signature could be reused to anchor a
    ///      spoofed issuer-backed joint attestation with different parties/schema. The issuer now signs a
    ///      digest binding parties + schema + credential type + commitment + chain + this contract.
    bytes32 internal constant JOINT_ISSUER_TYPEHASH = keccak256(
        "JointAgreementIssuerAttestation(address party1,address party2,address issuer,bytes32 schemaId,bytes32 credentialType,bytes32 credentialHash,bytes32 agreementCommitment,uint256 chainId,address verifyingContract)"
    );

    /// @dev SC-2 (audit 2026-06-09): the issuer attestation digest binds the SUBJECT (and schema /
    ///      credential type / chain / this contract) — not just `credentialHash`. Previously the issuer
    ///      signed only the credentialHash, so anyone who learned that public hash could anchor it on
    ///      chain against a DIFFERENT subject. Recomputed on-chain; the TS side derives the same constant.
    bytes32 internal constant ASSOCIATION_ATTESTATION_TYPEHASH = keccak256(
        "AssociationAttestation(address subject,address issuer,bytes32 schemaId,bytes32 credentialType,bytes32 credentialHash,uint256 chainId,address verifyingContract)"
    );

    // ─── Storage ────────────────────────────────────────────────────────

    /// @notice The canonical attestation row. EAS-aligned shape.
    struct Attestation {
        bytes32 uid;
        bytes32 schemaId; // → ShapeRegistry row
        bytes32 credentialType; // VC type class
        bytes32 credentialHash; // RFC 8785 JCS hash of off-chain VC body
        bytes32 refUID; // EAS-style back-pointer (e.g. AgreementCommitment for JointAgreement)
        bytes32 bilateralConsentRef; // 0 for unilateral; hash for joint
        bytes32 offchainCredentialStatusList; // W3C VC StatusList2021 pointer
        uint64 epochBucket; // attest time / EPOCH_SECONDS
        uint64 revocationEpochBucket; // 0 if not revoked
        address subject; // holder (unilateral) or party[0] (joint)
        address party2; // address(0) for unilateral; party[1] for joint
        address issuer; // off-chain VC signer SA
    }

    mapping(bytes32 => Attestation) private _attestations;

    // ─── Requests ───────────────────────────────────────────────────────

    struct AssociationAttestationRequest {
        bytes32 schemaId;
        bytes32 credentialType;
        bytes32 credentialHash;
        bytes32 offchainCredentialStatusList;
        address subject;
        address issuer;
        /// @dev EIP-712 signature by `issuer` SA over the credentialHash;
        ///      verified via ERC-1271.
        bytes issuerSignature;
        uint256 salt;
    }

    struct JointAgreementAttestationRequest {
        bytes32 schemaId;
        bytes32 credentialType;
        bytes32 credentialHash;
        bytes32 refUID; // AgreementCommitment hash (spec 241)
        bytes32 bilateralConsentRef; // DEPRECATED / IGNORED (RW1-1, ADR-0027): consent is now
            // VERIFIED on-chain from party1Signature + party2Signature over the RECOMPUTED
            // consent digest; the stored `bilateralConsentRef` is that recomputed digest, not this.
        bytes32 offchainCredentialStatusList;
        address party1;
        address party2;
        address issuer;
        bytes issuerSignature;
        bytes party1Signature; // RW1-1: party1's consent over JOINT_CONSENT_TYPEHASH digest
        bytes party2Signature; // RW1-1: party2's consent over JOINT_CONSENT_TYPEHASH digest
        uint256 salt;
    }

    // ─── Events (EAS-like; 4 indexed topics each) ───────────────────────

    /// @dev Solidity caps indexed-args at 3 per non-anonymous event (EVM
    ///      topic0 = event signature). Matches EAS event shape:
    ///      `uid` is non-indexed payload; subject + issuer + credentialType
    ///      are indexed for filtering.
    event Attested(
        address indexed subject,
        address indexed issuer,
        bytes32 indexed credentialType,
        bytes32 uid
    );

    event JointAttested(
        address indexed party1,
        address indexed party2,
        bytes32 indexed credentialType,
        bytes32 uid
    );

    event Revoked(
        address indexed subjectOrParty,
        bytes32 indexed credentialType,
        bytes32 uid,
        bytes32 reasonHash
    );

    // ─── Public surface ─────────────────────────────────────────────────

    /// @notice Unilateral attestation by a holder against an issued credential.
    function assertAssociation(AssociationAttestationRequest calldata req) external returns (bytes32) {
        if (req.credentialHash == bytes32(0)) revert EmptyCredentialHash();

        // SC-2: RECOMPUTE the issuer-attestation digest binding the SUBJECT (+ schema / type / chain /
        // this contract) and verify the issuer signed THAT. A known credentialHash can no longer be
        // anchored against an attacker-chosen subject.
        bytes32 issuerDigest = keccak256(
            abi.encode(
                ASSOCIATION_ATTESTATION_TYPEHASH,
                req.subject,
                req.issuer,
                req.schemaId,
                req.credentialType,
                req.credentialHash,
                block.chainid,
                address(this)
            )
        );
        if (!_isValidSignatureBool(req.issuer, issuerDigest, req.issuerSignature)) {
            revert InvalidIssuerSignature();
        }

        bytes32 uid = _computeUid(
            req.subject,
            address(0),
            req.issuer,
            req.credentialType,
            req.credentialHash,
            bytes32(0),
            req.salt
        );

        if (_attestations[uid].uid != bytes32(0)) revert AttestationAlreadyExists();

        uint64 bucket = uint64(block.timestamp) / EPOCH_SECONDS;

        _attestations[uid] = Attestation({
            uid: uid,
            schemaId: req.schemaId,
            credentialType: req.credentialType,
            credentialHash: req.credentialHash,
            refUID: bytes32(0),
            bilateralConsentRef: bytes32(0),
            offchainCredentialStatusList: req.offchainCredentialStatusList,
            epochBucket: bucket,
            revocationEpochBucket: 0,
            subject: req.subject,
            party2: address(0),
            issuer: req.issuer
        });

        emit Attested(req.subject, req.issuer, req.credentialType, uid);
        return uid;
    }

    /// @notice Joint attestation by two parties against an agreement.
    /// @dev RW1-1 (ADR-0027) — bilateral consent is VERIFIED on-chain, not trusted. The contract
    ///      recomputes the canonical consent digest (`JOINT_CONSENT_TYPEHASH` over party1, party2,
    ///      the agreement commitment, and the credential hash) and requires BOTH parties' signatures
    ///      over it (ERC-1271 for smart accounts, ECDSA for EOAs). A nonzero `bilateralConsentRef` is
    ///      NOT consent (the prior "caller's responsibility" model, AR-04). The recomputed digest is
    ///      what gets stored. Alternative consent proof via `DelegationManager.verifyAuthorizationForCall`
    ///      (an exact-call sub-delegation per party) is spec 249's option (b); this entrypoint takes
    ///      the direct two-party-signature form.
    function assertJointAgreement(
        JointAgreementAttestationRequest calldata req
    ) external returns (bytes32) {
        if (req.credentialHash == bytes32(0)) revert EmptyCredentialHash();
        if (req.party1 == address(0) || req.party2 == address(0)) revert InvalidParties();
        if (req.party1 == req.party2) revert InvalidParties();

        // ATT-1 (audit 2026-06-10): the issuer signs a FULL typed digest binding the parties, schema,
        // credential type/hash, the agreement commitment (refUID), chain, and this registry — not a bare
        // `credentialHash`. A leaked/observed issuer signature can no longer be replayed to anchor an
        // issuer-backed joint attestation for different parties/schema/chain.
        bytes32 issuerDigest = keccak256(
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
                address(this)
            )
        );
        if (!_isValidSignatureBool(req.issuer, issuerDigest, req.issuerSignature)) {
            revert InvalidIssuerSignature();
        }

        // VERIFY bilateral consent: recompute the digest, require both parties' signatures over it.
        bytes32 consentDigest = keccak256(
            abi.encode(JOINT_CONSENT_TYPEHASH, req.party1, req.party2, req.refUID, req.credentialHash)
        );
        if (!_isValidSignatureBool(req.party1, consentDigest, req.party1Signature)) revert InvalidPartyConsent();
        if (!_isValidSignatureBool(req.party2, consentDigest, req.party2Signature)) revert InvalidPartyConsent();

        bytes32 uid = _computeUid(
            req.party1,
            req.party2,
            req.issuer,
            req.credentialType,
            req.credentialHash,
            req.refUID,
            req.salt
        );
        if (_attestations[uid].uid != bytes32(0)) revert AttestationAlreadyExists();

        uint64 bucket = uint64(block.timestamp) / EPOCH_SECONDS;

        _attestations[uid] = Attestation({
            uid: uid,
            schemaId: req.schemaId,
            credentialType: req.credentialType,
            credentialHash: req.credentialHash,
            refUID: req.refUID,
            bilateralConsentRef: consentDigest, // the VERIFIED, recomputed consent digest (RW1-1)
            offchainCredentialStatusList: req.offchainCredentialStatusList,
            epochBucket: bucket,
            revocationEpochBucket: 0,
            subject: req.party1,
            party2: req.party2,
            issuer: req.issuer
        });

        emit JointAttested(req.party1, req.party2, req.credentialType, uid);
        return uid;
    }

    /// @notice Holder-only revocation for unilateral attestations (AR-05).
    function revokeOwnAssociation(bytes32 uid, bytes32 reasonHash) external {
        Attestation storage a = _attestations[uid];
        if (a.uid == bytes32(0)) revert AttestationNotFound();
        if (a.party2 != address(0)) revert NotSubject(); // joint — wrong entrypoint
        if (msg.sender != a.subject) revert NotSubject();
        if (a.revocationEpochBucket != 0) revert AlreadyRevoked();

        a.revocationEpochBucket = uint64(block.timestamp) / EPOCH_SECONDS;
        emit Revoked(msg.sender, a.credentialType, uid, reasonHash);
    }

    /// @notice Either-party revocation for joint attestations (D-26 + AR-05).
    function revokeOwnJointAgreement(bytes32 uid, bytes32 reasonHash) external {
        Attestation storage a = _attestations[uid];
        if (a.uid == bytes32(0)) revert AttestationNotFound();
        if (a.party2 == address(0)) revert NotParty(); // unilateral — wrong entrypoint
        if (msg.sender != a.subject && msg.sender != a.party2) revert NotParty();
        if (a.revocationEpochBucket != 0) revert AlreadyRevoked();

        a.revocationEpochBucket = uint64(block.timestamp) / EPOCH_SECONDS;
        emit Revoked(msg.sender, a.credentialType, uid, reasonHash);
    }

    /// @notice Get the full attestation row.
    function getAttestation(bytes32 uid) external view returns (Attestation memory) {
        Attestation memory a = _attestations[uid];
        if (a.uid == bytes32(0)) revert AttestationNotFound();
        return a;
    }

    /// @notice Convenience — `!revoked` view.
    function isValid(bytes32 uid) external view returns (bool) {
        return _attestations[uid].uid != bytes32(0) && _attestations[uid].revocationEpochBucket == 0;
    }

    // ─── Internal ───────────────────────────────────────────────────────

    function _computeUid(
        address subject,
        address party2,
        address issuer,
        bytes32 credentialType,
        bytes32 credentialHash,
        bytes32 refUID,
        uint256 salt
    ) internal pure returns (bytes32) {
        return
            keccak256(
                abi.encode(subject, party2, issuer, credentialType, credentialHash, refUID, salt)
            );
    }

    /// @dev ERC-1271-first signature verification (smart accounts), with EOA fallback.
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
        // EOA fallback via eth-signed message hash + ecrecover
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
