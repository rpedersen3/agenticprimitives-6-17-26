/**
 * @agenticprimitives/geo-features — off-chain geo CLAIM credentials + on-chain
 * GeoFeatureRegistry helpers (spec 251).
 *
 * Geo features are PUBLIC, versioned, on-chain anchors (GeoFeatureRegistry; geometry
 * hash + roots + coarse bbox, exact GeoJSON off chain). A geo claim — a Smart Agent's
 * relation to a feature — is a PRIVATE verifiable credential in that agent's vault,
 * pointing to an on-chain `(featureId, version)`. The agent↔feature ASSOCIATION is
 * NEVER on chain (it would leak operational data). There is no on-chain skill↔geo
 * mapping — this package is fully independent of `@agenticprimitives/agent-skills`.
 *
 * NEUTRAL public geography only — NO operational/sensitivity/domain vocabulary (spec 251).
 */

import { keccak_256 } from '@noble/hashes/sha3.js';
import { utf8ToBytes } from '@noble/hashes/utils.js';
import type { Address, Hex } from '@agenticprimitives/types';
import { credentialHash, VC_CONTEXT_V2 } from '@agenticprimitives/verifiable-credentials';

export const PACKAGE_NAME = '@agenticprimitives/geo-features';
export const PACKAGE_STATUS = 'w1-foundational' as const;
export const SPEC_REF = 'specs/251-skills-and-geo-features.md';

export type Uri = string;
export type Hex32 = `0x${string}`;

const NS = 'https://agenticprimitives.dev/ns/geo#';

// ─── C-box codelists (keccak of the ns/geo# concept URIs) ──────────────────
// Kind values are LOCKSTEP with GeoFeatureRegistry.KIND_* (ADR-0009).

/** On-chain-bound geo feature kinds. `GEO_KIND.Region === GeoFeatureRegistry.KIND_REGION`. */
export const GEO_KIND = {
  Planet: hashUri(`${NS}Planet`),
  Region: hashUri(`${NS}Region`),
  Country: hashUri(`${NS}Country`),
  AdminArea: hashUri(`${NS}AdminArea`),
  Custom: hashUri(`${NS}Custom`),
} as const;
export const GEO_KIND_URI = {
  Planet: `${NS}Planet`, Region: `${NS}Region`, Country: `${NS}Country`, AdminArea: `${NS}AdminArea`, Custom: `${NS}Custom`,
} as const;

/** Claim relations (C-box `apg:geoRelation`). Off-chain only (in the credential). */
export const GEO_RELATION = {
  servesWithin: hashUri(`${NS}servesWithin`),
  operatesIn: hashUri(`${NS}operatesIn`),
  licensedIn: hashUri(`${NS}licensedIn`),
  residentOf: hashUri(`${NS}residentOf`),
  originIn: hashUri(`${NS}originIn`),
} as const;

export type GeoVisibility = 'public' | 'public-coarse' | 'private-commitment' | 'private-zk' | 'offchain-only';

// ─── Features (the on-chain anchor) ────────────────────────────────────────

/** Compute a stable featureId from a canonical id key (keccak). */
export function computeFeatureId(canonicalKey: string): Hex32 {
  return hashUri(canonicalKey);
}

/** keccak of the canonical GeoJSON string (the geometry that lives off chain). */
export function geometryHash(canonicalGeoJson: string): Hex32 {
  return hashUri(canonicalGeoJson);
}

/** Payload a steward submits to `GeoFeatureRegistry.publish(...)`. Coordinates are degrees × 1e7. */
export interface GeoFeaturePublishInput {
  featureId: Hex32;
  featureKind: Hex32;
  stewardAccount: Address;
  geometryHash: Hex32;
  coverageRoot: Hex32;
  sourceSetRoot: Hex32;
  metadataURI: string;
  centroidLat: bigint;
  centroidLon: bigint;
  bboxMinLat: bigint;
  bboxMinLon: bigint;
  bboxMaxLat: bigint;
  bboxMaxLon: bigint;
  validAfter: bigint;
  validUntil: bigint;
}

/** A reference to an on-chain geo feature version — what a claim points to. */
export interface GeoFeatureRef {
  featureId: Hex32;
  version: number;
}

// ─── Claims (off-chain vault credentials) ──────────────────────────────────

export interface GeoClaimSubject {
  /** The Smart Agent the claim is about. */
  subject: Address;
  /** The on-chain feature version this claim references. */
  feature: GeoFeatureRef;
  /** A GEO_RELATION value. */
  relation: Hex32;
  visibility: GeoVisibility;
  /** keccak commitment / merkle root (ZK-targetable). NEVER a URI; preimage in the vault. */
  evidenceCommit?: Hex32;
  validAfter?: number;
  validUntil?: number;
  nonce: Hex32;
  claimId: Hex32;
}

/** The vault-resident geo claim credential (a VC). */
export interface GeoClaimCredential {
  '@context': string[];
  type: ['VerifiableCredential', 'GeoClaimCredential'];
  /** CAIP-10 of the issuer Smart Agent. */
  issuer: string;
  validFrom?: string;
  validUntil?: string;
  credentialSubject: GeoClaimSubject;
}

/** Deterministic claim id = keccak(abi.encode(subject, featureId, relation, nonce)). */
export function geoClaimId(args: { subject: Address; featureId: Hex32; relation: Hex32; nonce: Hex32 }): Hex32 {
  const buf = new Uint8Array(4 * 32);
  writeAddress(buf, 0, args.subject);
  writeHex32(buf, 32, args.featureId);
  writeHex32(buf, 64, args.relation);
  writeHex32(buf, 96, args.nonce);
  return toHex32(keccak_256(buf));
}

/** Typehash for the cross-issued endorsement (issuer signs; verified via ERC-1271). */
export const GEO_ENDORSEMENT_TYPEHASH: Hex32 = hashUri(
  'GeoEndorsement(address subjectAgent,bytes32 featureId,uint64 featureVersion,bytes32 relation,uint64 validAfter,uint64 validUntil,bytes32 nonce)',
);

/** The digest an issuer signs to endorse a cross-issued claim (ERC-1271-verifiable). */
export function geoEndorsementDigest(args: {
  subject: Address;
  featureId: Hex32;
  featureVersion: number;
  relation: Hex32;
  validAfter: number;
  validUntil: number;
  nonce: Hex32;
}): Hex32 {
  const buf = new Uint8Array(8 * 32);
  writeHex32(buf, 0, GEO_ENDORSEMENT_TYPEHASH);
  writeAddress(buf, 32, args.subject);
  writeHex32(buf, 64, args.featureId);
  writeUint(buf, 96, BigInt(args.featureVersion));
  writeHex32(buf, 128, args.relation);
  writeUint(buf, 160, BigInt(args.validAfter));
  writeUint(buf, 192, BigInt(args.validUntil));
  writeHex32(buf, 224, args.nonce);
  return toHex32(keccak_256(buf));
}

function caip10(chainId: number, addr: Address): string {
  return `eip155:${chainId}:${addr}`;
}

function buildSubject(args: {
  subject: Address;
  feature: GeoFeatureRef;
  relation: Hex32;
  visibility: GeoVisibility;
  evidenceCommit?: Hex32;
  validAfter?: number;
  validUntil?: number;
  nonce: Hex32;
}): GeoClaimSubject {
  return {
    subject: args.subject,
    feature: args.feature,
    relation: args.relation,
    visibility: args.visibility,
    evidenceCommit: args.evidenceCommit,
    validAfter: args.validAfter,
    validUntil: args.validUntil,
    nonce: args.nonce,
    claimId: geoClaimId({ subject: args.subject, featureId: args.feature.featureId, relation: args.relation, nonce: args.nonce }),
  };
}

/** Build a SELF geo claim (subject == issuer). */
export function buildSelfGeoClaim(args: {
  chainId: number;
  subject: Address;
  feature: GeoFeatureRef;
  relation: Hex32;
  visibility?: GeoVisibility;
  evidenceCommit?: Hex32;
  validAfter?: number;
  validUntil?: number;
  nonce: Hex32;
}): GeoClaimCredential {
  return {
    '@context': [VC_CONTEXT_V2],
    type: ['VerifiableCredential', 'GeoClaimCredential'],
    issuer: caip10(args.chainId, args.subject),
    credentialSubject: buildSubject({ ...args, visibility: args.visibility ?? 'private-commitment' }),
  };
}

/** Build an ENDORSED geo claim + the digest the issuer must sign (cross-issued; subject != issuer). */
export function buildEndorsedGeoClaim(args: {
  chainId: number;
  subject: Address;
  issuer: Address;
  feature: GeoFeatureRef;
  relation: Hex32;
  visibility?: GeoVisibility;
  evidenceCommit?: Hex32;
  validAfter?: number;
  validUntil?: number;
  nonce: Hex32;
}): { credential: GeoClaimCredential; endorsementDigest: Hex32 } {
  if (args.subject === args.issuer) throw new Error('geo-features: an endorsed claim must be cross-issued');
  const credential: GeoClaimCredential = {
    '@context': [VC_CONTEXT_V2],
    type: ['VerifiableCredential', 'GeoClaimCredential'],
    issuer: caip10(args.chainId, args.issuer),
    credentialSubject: buildSubject({ ...args, visibility: args.visibility ?? 'public' }),
  };
  const endorsementDigest = geoEndorsementDigest({
    subject: args.subject,
    featureId: args.feature.featureId,
    featureVersion: args.feature.version,
    relation: args.relation,
    validAfter: args.validAfter ?? 0,
    validUntil: args.validUntil ?? 0,
    nonce: args.nonce,
  });
  return { credential, endorsementDigest };
}

/** The canonical hash of a claim credential body (for vault keys / receipts). */
export function geoClaimHash(credential: GeoClaimCredential): Hex {
  return credentialHash(credential as unknown as Parameters<typeof credentialHash>[0]) as Hex;
}

// ─── On-chain feature reader (minimal ABI fragment) ────────────────────────

/** Minimal read ABI for GeoFeatureRegistry — `exists` + `latestVersion`. */
export const GEO_FEATURE_READ_ABI = [
  { type: 'function', name: 'exists', stateMutability: 'view', inputs: [{ name: 'featureId', type: 'bytes32' }, { name: 'version', type: 'uint64' }], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'latestVersion', stateMutability: 'view', inputs: [{ name: '', type: 'bytes32' }], outputs: [{ type: 'uint64' }] },
] as const;

/** A `readContract`-shaped function (inject viem's `publicClient.readContract`). */
export type ReadContractFn = (args: { address: Address; abi: typeof GEO_FEATURE_READ_ABI; functionName: string; args: readonly unknown[] }) => Promise<unknown>;

/** Confirm a claim's pinned `(featureId, version)` still exists on the registry. */
export async function geoFeatureExists(read: ReadContractFn, registry: Address, ref: GeoFeatureRef): Promise<boolean> {
  return (await read({ address: registry, abi: GEO_FEATURE_READ_ABI, functionName: 'exists', args: [ref.featureId, BigInt(ref.version)] })) as boolean;
}

// ─── Hash helpers ──────────────────────────────────────────────────────────

function hashUri(s: string): Hex32 {
  return toHex32(keccak_256(utf8ToBytes(s)));
}
function toHex32(b: Uint8Array): Hex32 {
  let hex = '0x';
  for (const v of b) hex += v.toString(16).padStart(2, '0');
  return hex as Hex32;
}
function writeHex32(buf: Uint8Array, offset: number, h: Hex32): void {
  const clean = h.toLowerCase().replace(/^0x/, '').padStart(64, '0');
  for (let i = 0; i < 32; i++) buf[offset + i] = parseInt(clean.substring(i * 2, i * 2 + 2), 16);
}
function writeAddress(buf: Uint8Array, offset: number, addr: Address): void {
  const clean = addr.toLowerCase().replace(/^0x/, '');
  if (clean.length !== 40) throw new Error(`bad address: ${addr}`);
  for (let i = 0; i < 20; i++) buf[offset + 12 + i] = parseInt(clean.substring(i * 2, i * 2 + 2), 16);
}
function writeUint(buf: Uint8Array, offset: number, n: bigint): void {
  let v = n;
  for (let i = 31; i >= 0; i--) {
    buf[offset + i] = Number(v & 0xffn);
    v >>= 8n;
  }
}
