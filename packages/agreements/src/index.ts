/**
 * @agenticprimitives/agreements — Commitment-only AgreementRegistry SDK +
 * AgreementCredential shape (PD-22).
 *
 * Authoritative spec: specs/241-agreement-commitment-registry.md
 */

import { keccak_256 } from '@noble/hashes/sha3';
import { utf8ToBytes } from '@noble/hashes/utils';
import type { Address, Hex } from '@agenticprimitives/types';

export const PACKAGE_NAME = '@agenticprimitives/agreements';
export const PACKAGE_STATUS = 'w1-foundational' as const;
export const SPEC_REF = 'specs/241-agreement-commitment-registry.md';

export type Hex32 = `0x${string}`;

/** Status discriminators matching `AgreementRegistry.STATUS_*`. */
export const STATUS = {
  NONE: 0,
  ACTIVE: 1,
  COMPLETED: 2,
  DISPUTED: 3,
  REVOKED: 4,
} as const;
export type AgreementStatus = (typeof STATUS)[keyof typeof STATUS];

/**
 * RW1-3 (ADR-0027) — canonical transition typehash. MUST byte-equal
 * `AgreementRegistry.TRANSITION_TYPEHASH`; enforced by the cross-stack
 * typehash-equality gate (`check:eip712-typehash-equality`).
 */
export const TRANSITION_TYPEHASH: Hex32 = toHex32(
  keccak_256(
    utf8ToBytes('AgreementTransition(bytes32 agreementCommitment,uint8 toStatus,bytes32 nullifier)'),
  ),
);

/**
 * Recompute the transition digest the parties sign (RW1-3). Equals the
 * contract's `keccak256(abi.encode(TRANSITION_TYPEHASH, agreementCommitment,
 * toStatus, nullifier))` — the on-chain `updateStatus` recomputes the same
 * digest and verifies the party signatures against it.
 */
export function transitionDigest(args: {
  agreementCommitment: Hex32;
  toStatus: AgreementStatus;
  nullifier: Hex32;
}): Hex32 {
  const buf = new Uint8Array(4 * 32);
  writeHex32(buf, 0, TRANSITION_TYPEHASH);
  writeHex32(buf, 32, args.agreementCommitment);
  // uint8 toStatus, abi-encoded as a left-padded 32-byte word.
  buf[95] = args.toStatus & 0xff;
  writeHex32(buf, 96, args.nullifier);
  return toHex32(keccak_256(buf));
}

/** Recompute the commitment per spec 241 §3 (AR-01). */
export function computeAgreementCommitment(args: {
  partySetCommitment: Hex32;
  issuerCommitment: Hex32;
  termsCommitment: Hex32;
  scheduleCommitment: Hex32;
  salt: bigint;
}): Hex32 {
  const buf = new Uint8Array(5 * 32);
  writeHex32(buf, 0, args.partySetCommitment);
  writeHex32(buf, 32, args.issuerCommitment);
  writeHex32(buf, 64, args.termsCommitment);
  writeHex32(buf, 96, args.scheduleCommitment);
  writeUint256(buf, 128, args.salt);
  return toHex32(keccak_256(buf));
}

/** Canonical party commitment: keccak256(abi.encodePacked(party1, party2)) — order-sensitive. */
export function partySetCommitment(party1: Address, party2: Address): Hex32 {
  const buf = new Uint8Array(40);
  writeAddressTight(buf, 0, party1);
  writeAddressTight(buf, 20, party2);
  return toHex32(keccak_256(buf));
}

/** Issuer commitment: keccak256(abi.encodePacked(issuer)). */
export function issuerCommitment(issuer: Address): Hex32 {
  const buf = new Uint8Array(20);
  writeAddressTight(buf, 0, issuer);
  return toHex32(keccak_256(buf));
}

/** Canonical hash of an arbitrary string for terms / schedule commitments. */
export function bytesCommitment(value: string): Hex32 {
  return toHex32(keccak_256(utf8ToBytes(value)));
}

/** Nullifier derivation helper (per-mandate one-shot). */
export function nullifierFor(args: {
  agreementCommitment: Hex32;
  toStatus: AgreementStatus;
  party: Address;
  secret: Hex32;
}): Hex32 {
  const buf = new Uint8Array(32 + 1 + 32 + 32);
  writeHex32(buf, 0, args.agreementCommitment);
  buf[32] = args.toStatus;
  writeAddressLeftPadded(buf, 33, args.party);
  writeHex32(buf, 65, args.secret);
  return toHex32(keccak_256(buf));
}

export interface AgreementIssuancePayload {
  schemaHash: Hex32;
  issuer: Address;
  attestationStructHash: Hex32;
  issuerSignature: Hex;
  agreementCommitment: Hex32;
  partySetCommitment: Hex32;
  issuerCommitment: Hex32;
  termsCommitment: Hex32;
  scheduleCommitment: Hex32;
  salt: bigint;
}

export interface StatusUpdatePayload {
  agreementCommitment: Hex32;
  toStatus: AgreementStatus;
  nullifier: Hex32;
  /** Signatures over the recomputed {@link transitionDigest} (RW1-3) — the
   *  contract no longer accepts a caller-supplied `transitionStructHash`. */
  signature1: Hex;
  signature2: Hex;
  signer1: Address;
  signer2: Address;
  /** RW1-2 (ADR-0027): the revealed parties + commitment components. The
   *  contract recomputes the agreement commitment from these and requires each
   *  signer to be one of the two parties. */
  party1: Address;
  party2: Address;
  issuerCommitment: Hex32;
  termsCommitment: Hex32;
  scheduleCommitment: Hex32;
  commitmentSalt: bigint;
}

// ─── Helpers ──────────────────────────────────────────────────────────

function toHex32(b: Uint8Array): Hex32 {
  let hex = '0x';
  for (const v of b) hex += v.toString(16).padStart(2, '0');
  return hex as Hex32;
}

function writeAddressTight(buf: Uint8Array, offset: number, addr: Address): void {
  const clean = addr.toLowerCase().replace(/^0x/, '');
  for (let i = 0; i < 20; i++) {
    buf[offset + i] = parseInt(clean.substring(i * 2, i * 2 + 2), 16);
  }
}

function writeAddressLeftPadded(buf: Uint8Array, offset: number, addr: Address): void {
  const clean = addr.toLowerCase().replace(/^0x/, '');
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
  let v = n;
  for (let i = 31; i >= 0; i--) {
    buf[offset + i] = Number(v & 0xffn);
    v = v >> 8n;
  }
}
