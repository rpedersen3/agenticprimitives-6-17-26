/**
 * @agenticprimitives/attestations — AttestationRegistry SDK + credential types
 * (Layers 12–15 of the spine).
 *
 * Authoritative spec: specs/242-trust-credentials-and-public-assertions.md
 * Architecture-of-record: ADR-0023
 */

import { keccak_256 } from '@noble/hashes/sha3.js';
import { utf8ToBytes } from '@noble/hashes/utils.js';
import type { Address, Hex } from '@agenticprimitives/types';

export const PACKAGE_NAME = '@agenticprimitives/attestations';
export const PACKAGE_STATUS = 'w1-foundational' as const;
export const SPEC_REF = 'specs/242-trust-credentials-and-public-assertions.md';

export type Hex32 = `0x${string}`;

function hashName(name: string): Hex32 {
  const digest = keccak_256(utf8ToBytes(name));
  let hex = '0x';
  for (const v of digest) hex += v.toString(16).padStart(2, '0');
  return hex as Hex32;
}

/** ADR-0024 Decision 2 — substrate credential-type discriminators. */
export const CREDENTIAL_TYPE = {
  Association: hashName('AssociationCredential'),
  Evidence: hashName('EvidenceCredential'),
  Outcome: hashName('OutcomeCredential'),
  Validation: hashName('ValidationCredential'),
  TrustUpdate: hashName('TrustUpdate'),
  JointAgreement: hashName('JointAgreementAttestation'),
  PaymentReceipt: hashName('PaymentReceipt'),
} as const;

/** Recomputes the on-chain UID per AttestationRegistry._computeUid. */
export function computeAttestationUid(args: {
  subject: Address;
  party2: Address; // address(0) for unilateral
  issuer: Address;
  credentialType: Hex32;
  credentialHash: Hex32;
  refUID: Hex32; // bytes32(0) for unilateral
  salt: bigint;
}): Hex32 {
  const buf = new Uint8Array(7 * 32);
  writeAddress(buf, 0, args.subject);
  writeAddress(buf, 32, args.party2);
  writeAddress(buf, 64, args.issuer);
  writeHex32(buf, 96, args.credentialType);
  writeHex32(buf, 128, args.credentialHash);
  writeHex32(buf, 160, args.refUID);
  writeUint256(buf, 192, args.salt);
  const digest = keccak_256(buf);
  let hex = '0x';
  for (const v of digest) hex += v.toString(16).padStart(2, '0');
  return hex as Hex32;
}

/**
 * RW1-1 (ADR-0027) — canonical joint-agreement consent typehash. MUST byte-equal
 * `AttestationRegistry.JOINT_CONSENT_TYPEHASH`; enforced by the cross-stack
 * typehash-equality gate (`check:eip712-typehash-equality`).
 */
export const JOINT_CONSENT_TYPEHASH: Hex32 = hashName(
  'JointAgreementConsent(address party1,address party2,bytes32 agreementCommitment,bytes32 credentialHash)',
);

/**
 * Recompute the consent digest each party signs to consent to a joint agreement
 * (RW1-1). Equals the contract's `keccak256(abi.encode(JOINT_CONSENT_TYPEHASH,
 * party1, party2, agreementCommitment, credentialHash))`. `assertJointAgreement`
 * recomputes the same digest on-chain and verifies BOTH party signatures (ERC-1271
 * / ECDSA) against it — a stored or supplied consent reference is not consent.
 */
export function jointConsentDigest(args: {
  party1: Address;
  party2: Address;
  agreementCommitment: Hex32;
  credentialHash: Hex32;
}): Hex32 {
  const buf = new Uint8Array(5 * 32);
  writeHex32(buf, 0, JOINT_CONSENT_TYPEHASH);
  writeAddress(buf, 32, args.party1);
  writeAddress(buf, 64, args.party2);
  writeHex32(buf, 96, args.agreementCommitment);
  writeHex32(buf, 128, args.credentialHash);
  const digest = keccak_256(buf);
  let hex = '0x';
  for (const v of digest) hex += v.toString(16).padStart(2, '0');
  return hex as Hex32;
}

/**
 * SC-2 (audit 2026-06-09) — canonical issuer-attestation typehash for a unilateral association.
 * MUST byte-equal `AttestationRegistry.ASSOCIATION_ATTESTATION_TYPEHASH`; locked by the cross-stack
 * typehash-equality gate.
 */
export const ASSOCIATION_ATTESTATION_TYPEHASH: Hex32 = hashName(
  'AssociationAttestation(address subject,address issuer,bytes32 schemaId,bytes32 credentialType,bytes32 credentialHash,uint256 chainId,address verifyingContract)',
);

/**
 * Recompute the digest the issuer signs for a unilateral association (SC-2). Equals the contract's
 * `keccak256(abi.encode(ASSOCIATION_ATTESTATION_TYPEHASH, subject, issuer, schemaId, credentialType,
 * credentialHash, chainId, verifyingContract))`. `assertAssociation` recomputes the same digest on
 * chain — binding the SUBJECT so a known credentialHash can't be anchored against a different subject.
 */
export function associationAttestationDigest(args: {
  subject: Address;
  issuer: Address;
  schemaId: Hex32;
  credentialType: Hex32;
  credentialHash: Hex32;
  chainId: bigint;
  verifyingContract: Address;
}): Hex32 {
  const buf = new Uint8Array(8 * 32);
  writeHex32(buf, 0, ASSOCIATION_ATTESTATION_TYPEHASH);
  writeAddress(buf, 32, args.subject);
  writeAddress(buf, 64, args.issuer);
  writeHex32(buf, 96, args.schemaId);
  writeHex32(buf, 128, args.credentialType);
  writeHex32(buf, 160, args.credentialHash);
  writeUint256(buf, 192, args.chainId);
  writeAddress(buf, 224, args.verifyingContract);
  const digest = keccak_256(buf);
  let hex = '0x';
  for (const v of digest) hex += v.toString(16).padStart(2, '0');
  return hex as Hex32;
}

function writeAddress(buf: Uint8Array, offset: number, addr: Address): void {
  const clean = addr.toLowerCase().replace(/^0x/, '');
  if (clean.length !== 40) throw new Error(`bad address length: ${addr}`);
  for (let i = 0; i < 20; i++) {
    buf[offset + 12 + i] = parseInt(clean.substring(i * 2, i * 2 + 2), 16);
  }
}

function writeHex32(buf: Uint8Array, offset: number, h: Hex32): void {
  const clean = h.toLowerCase().replace(/^0x/, '').padStart(64, '0');
  for (let i = 0; i < 32; i++) {
    buf[offset + i] = parseInt(clean.substring(i * 2, i * 2 + 2), 16);
  }
}

function writeUint256(buf: Uint8Array, offset: number, n: bigint): void {
  let value = n;
  for (let i = 31; i >= 0; i--) {
    buf[offset + i] = Number(value & 0xffn);
    value = value >> 8n;
  }
}

/** Payload shape for `AttestationRegistry.assertAssociation(...)`. */
export interface AssociationAttestationRequest {
  schemaId: Hex32;
  credentialType: Hex32;
  credentialHash: Hex32;
  offchainCredentialStatusList: Hex32;
  subject: Address;
  issuer: Address;
  issuerSignature: Hex;
  salt: bigint;
}

/** Payload shape for `AttestationRegistry.assertJointAgreement(...)`.
 *  RW1-1 (ADR-0027): consent is VERIFIED on-chain from two party signatures over
 *  the recomputed {@link jointConsentDigest}; `bilateralConsentRef` is ignored by
 *  the contract (kept in the ABI tuple — pass `bytes32(0)`). */
export interface JointAgreementAttestationRequest {
  schemaId: Hex32;
  credentialType: Hex32;
  credentialHash: Hex32;
  refUID: Hex32;
  offchainCredentialStatusList: Hex32;
  party1: Address;
  party2: Address;
  issuer: Address;
  issuerSignature: Hex;
  /** party1's consent signature over {@link jointConsentDigest} (ERC-1271 / ECDSA). */
  party1Signature: Hex;
  /** party2's consent signature over {@link jointConsentDigest} (ERC-1271 / ECDSA). */
  party2Signature: Hex;
  salt: bigint;
}
