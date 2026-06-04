/**
 * @agenticprimitives/agent-skills — off-chain skill CLAIM credentials + on-chain
 * SkillDefinitionRegistry helpers (spec 251).
 *
 * Definitions are PUBLIC, versioned, on-chain anchors (SkillDefinitionRegistry).
 * A claim — a Smart Agent's relation to a skill — is a PRIVATE verifiable credential
 * in that agent's vault, pointing to an on-chain `(skillId, version)`. There is no
 * on-chain claim registry; this SDK owns the credential shape + builders + the
 * commitment/digest math + an on-chain definition reader.
 *
 * Neutral substrate — NO domain/faith vocabulary (spec 251).
 */

import { keccak_256 } from '@noble/hashes/sha3';
import { utf8ToBytes } from '@noble/hashes/utils';
import type { Address, Hex } from '@agenticprimitives/types';
import { credentialHash, VC_CONTEXT_V2 } from '@agenticprimitives/verifiable-credentials';

export const PACKAGE_NAME = '@agenticprimitives/agent-skills';
export const PACKAGE_STATUS = 'w1-foundational' as const;
export const SPEC_REF = 'specs/251-skills-and-geo-features.md';

export type Uri = string;
export type Hex32 = `0x${string}`;

const NS = 'https://agenticprimitives.dev/ns/skill#';

// ─── C-box codelists (keccak of the ns/skill# concept URIs) ────────────────
// The kind values are LOCKSTEP with SkillDefinitionRegistry.KIND_* (ADR-0009);
// the cross-stack test asserts equality against the live .sol.

/** On-chain-bound skill kinds. `SKILL_KIND.Leaf === SkillDefinitionRegistry.KIND_LEAF`. */
export const SKILL_KIND = {
  Leaf: hashUri(`${NS}Leaf`),
  Domain: hashUri(`${NS}Domain`),
  Custom: hashUri(`${NS}Custom`),
} as const;
export const SKILL_KIND_URI = { Leaf: `${NS}Leaf`, Domain: `${NS}Domain`, Custom: `${NS}Custom` } as const;

/** Claim relations (C-box `aps:skillRelation`). Off-chain only (in the credential). */
export const SKILL_RELATION = {
  hasSkill: hashUri(`${NS}hasSkill`),
  practicesSkill: hashUri(`${NS}practicesSkill`),
  certifiedIn: hashUri(`${NS}certifiedIn`),
  endorsesSkill: hashUri(`${NS}endorsesSkill`),
  mentorsIn: hashUri(`${NS}mentorsIn`),
  canTrainOthersIn: hashUri(`${NS}canTrainOthersIn`),
} as const;

export type SkillVisibility = 'public' | 'public-coarse' | 'private-commitment' | 'private-zk' | 'offchain-only';

/** Relations that are meaningless about oneself — forbidden on a self claim (mirrors smart-agent). */
export const SELF_FORBIDDEN_RELATIONS: readonly Hex32[] = [
  SKILL_RELATION.certifiedIn,
  SKILL_RELATION.endorsesSkill,
  SKILL_RELATION.mentorsIn,
  SKILL_RELATION.canTrainOthersIn,
];
export const SELF_MAX_PROFICIENCY = 6000;
export const MAX_PROFICIENCY = 10000;

// ─── Definitions (the on-chain anchor) ─────────────────────────────────────

/** Compute a stable skillId from a canonical id key (keccak). */
export function computeSkillId(canonicalKey: string): Hex32 {
  return hashUri(canonicalKey);
}

/** Canonical conceptHash a steward commits on chain (keccak of prefLabel + ancestors). */
export function conceptHash(prefLabel: string, ancestors: string[] = []): Hex32 {
  return hashUri([prefLabel, ...ancestors].join('|'));
}

/** Payload a steward submits to `SkillDefinitionRegistry.publish(...)`. */
export interface SkillDefinitionPublishInput {
  skillId: Hex32;
  skillKind: Hex32;
  stewardAccount: Address;
  conceptHash: Hex32;
  ontologyMerkleRoot: Hex32;
  metadataURI: string;
  validAfter: bigint;
  validUntil: bigint;
}

/** A reference to an on-chain skill definition version — what a claim points to. */
export interface SkillDefinitionRef {
  skillId: Hex32;
  version: number;
}

// ─── Claims (off-chain vault credentials) ──────────────────────────────────

export interface SkillClaimSubject {
  /** The Smart Agent the claim is about. */
  subject: Address;
  /** The on-chain definition version this claim references. */
  definition: SkillDefinitionRef;
  /** A SKILL_RELATION value. */
  relation: Hex32;
  visibility: SkillVisibility;
  /** 0..10000 basis points. */
  proficiencyScore?: number;
  /** keccak commitment / merkle root (ZK-targetable). NEVER a URI; preimage in the vault. */
  evidenceCommit?: Hex32;
  validAfter?: number;
  validUntil?: number;
  nonce: Hex32;
  /** Deterministic claim id (see {@link skillClaimId}). */
  claimId: Hex32;
}

/** The vault-resident skill claim credential (a VC). */
export interface SkillClaimCredential {
  '@context': string[];
  type: ['VerifiableCredential', 'SkillClaimCredential'];
  /** CAIP-10 of the issuer Smart Agent. */
  issuer: string;
  validFrom?: string;
  validUntil?: string;
  credentialSubject: SkillClaimSubject;
}

/** Deterministic claim id = keccak(abi.encode(subject, skillId, relation, nonce)). */
export function skillClaimId(args: { subject: Address; skillId: Hex32; relation: Hex32; nonce: Hex32 }): Hex32 {
  const buf = new Uint8Array(4 * 32);
  writeAddress(buf, 0, args.subject);
  writeHex32(buf, 32, args.skillId);
  writeHex32(buf, 64, args.relation);
  writeHex32(buf, 96, args.nonce);
  return toHex32(keccak_256(buf));
}

/** Typehash for the cross-issued endorsement (issuer signs; verified via ERC-1271). */
export const SKILL_ENDORSEMENT_TYPEHASH: Hex32 = hashUri(
  'SkillEndorsement(address subjectAgent,bytes32 skillId,uint64 skillVersion,bytes32 relation,uint16 proficiencyScore,uint64 validAfter,uint64 validUntil,bytes32 nonce)',
);

/** The digest an issuer signs to endorse a cross-issued claim (ERC-1271-verifiable). */
export function skillEndorsementDigest(args: {
  subject: Address;
  skillId: Hex32;
  skillVersion: number;
  relation: Hex32;
  proficiencyScore: number;
  validAfter: number;
  validUntil: number;
  nonce: Hex32;
}): Hex32 {
  const buf = new Uint8Array(9 * 32);
  writeHex32(buf, 0, SKILL_ENDORSEMENT_TYPEHASH);
  writeAddress(buf, 32, args.subject);
  writeHex32(buf, 64, args.skillId);
  writeUint(buf, 96, BigInt(args.skillVersion));
  writeHex32(buf, 128, args.relation);
  writeUint(buf, 160, BigInt(args.proficiencyScore));
  writeUint(buf, 192, BigInt(args.validAfter));
  writeUint(buf, 224, BigInt(args.validUntil));
  writeHex32(buf, 256, args.nonce);
  return toHex32(keccak_256(buf));
}

function caip10(chainId: number, addr: Address): string {
  return `eip155:${chainId}:${addr}`;
}

function buildSubject(args: {
  subject: Address;
  definition: SkillDefinitionRef;
  relation: Hex32;
  visibility: SkillVisibility;
  proficiencyScore?: number;
  evidenceCommit?: Hex32;
  validAfter?: number;
  validUntil?: number;
  nonce: Hex32;
}): SkillClaimSubject {
  return {
    subject: args.subject,
    definition: args.definition,
    relation: args.relation,
    visibility: args.visibility,
    proficiencyScore: args.proficiencyScore,
    evidenceCommit: args.evidenceCommit,
    validAfter: args.validAfter,
    validUntil: args.validUntil,
    nonce: args.nonce,
    claimId: skillClaimId({ subject: args.subject, skillId: args.definition.skillId, relation: args.relation, nonce: args.nonce }),
  };
}

/** Build a SELF skill claim (subject == issuer). Capped proficiency; self-meaningless relations forbidden. */
export function buildSelfSkillClaim(args: {
  chainId: number;
  subject: Address;
  definition: SkillDefinitionRef;
  relation: Hex32;
  visibility?: SkillVisibility;
  proficiencyScore?: number;
  evidenceCommit?: Hex32;
  validAfter?: number;
  validUntil?: number;
  nonce: Hex32;
}): SkillClaimCredential {
  if (SELF_FORBIDDEN_RELATIONS.includes(args.relation)) {
    throw new Error('agent-skills: that relation is meaningless about oneself (use an endorsed claim)');
  }
  if ((args.proficiencyScore ?? 0) > SELF_MAX_PROFICIENCY) {
    throw new Error(`agent-skills: self proficiency capped at ${SELF_MAX_PROFICIENCY}`);
  }
  return {
    '@context': [VC_CONTEXT_V2],
    type: ['VerifiableCredential', 'SkillClaimCredential'],
    issuer: caip10(args.chainId, args.subject),
    credentialSubject: buildSubject({ ...args, visibility: args.visibility ?? 'private-commitment' }),
  };
}

/** Build an ENDORSED skill claim + the digest the issuer must sign (cross-issued; subject != issuer). */
export function buildEndorsedSkillClaim(args: {
  chainId: number;
  subject: Address;
  issuer: Address;
  definition: SkillDefinitionRef;
  relation: Hex32;
  visibility?: SkillVisibility;
  proficiencyScore?: number;
  evidenceCommit?: Hex32;
  validAfter?: number;
  validUntil?: number;
  nonce: Hex32;
}): { credential: SkillClaimCredential; endorsementDigest: Hex32 } {
  if (args.subject === args.issuer) throw new Error('agent-skills: an endorsed claim must be cross-issued');
  if ((args.proficiencyScore ?? 0) > MAX_PROFICIENCY) throw new Error('agent-skills: proficiency out of range');
  const credential: SkillClaimCredential = {
    '@context': [VC_CONTEXT_V2],
    type: ['VerifiableCredential', 'SkillClaimCredential'],
    issuer: caip10(args.chainId, args.issuer),
    credentialSubject: buildSubject({ ...args, visibility: args.visibility ?? 'public' }),
  };
  const endorsementDigest = skillEndorsementDigest({
    subject: args.subject,
    skillId: args.definition.skillId,
    skillVersion: args.definition.version,
    relation: args.relation,
    proficiencyScore: args.proficiencyScore ?? 0,
    validAfter: args.validAfter ?? 0,
    validUntil: args.validUntil ?? 0,
    nonce: args.nonce,
  });
  return { credential, endorsementDigest };
}

/** The canonical hash of a claim credential body (for vault keys / receipts). */
export function skillClaimHash(credential: SkillClaimCredential): Hex {
  return credentialHash(credential as unknown as Parameters<typeof credentialHash>[0]) as Hex;
}

// ─── On-chain definition reader (minimal ABI fragment) ─────────────────────

/** Minimal read ABI for SkillDefinitionRegistry — `exists` + `latestVersion`. */
export const SKILL_DEFINITION_READ_ABI = [
  { type: 'function', name: 'exists', stateMutability: 'view', inputs: [{ name: 'skillId', type: 'bytes32' }, { name: 'version', type: 'uint64' }], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'latestVersion', stateMutability: 'view', inputs: [{ name: '', type: 'bytes32' }], outputs: [{ type: 'uint64' }] },
] as const;

/** A `readContract`-shaped function (inject viem's `publicClient.readContract`). */
export type ReadContractFn = (args: { address: Address; abi: typeof SKILL_DEFINITION_READ_ABI; functionName: string; args: readonly unknown[] }) => Promise<unknown>;

/** Confirm a claim's pinned `(skillId, version)` still exists on the registry. */
export async function skillDefinitionExists(read: ReadContractFn, registry: Address, ref: SkillDefinitionRef): Promise<boolean> {
  return (await read({ address: registry, abi: SKILL_DEFINITION_READ_ABI, functionName: 'exists', args: [ref.skillId, BigInt(ref.version)] })) as boolean;
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
