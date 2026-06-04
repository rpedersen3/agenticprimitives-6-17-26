import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { keccak256, stringToBytes, encodeAbiParameters } from 'viem';
import {
  SKILL_KIND, SKILL_KIND_URI, SKILL_RELATION, SELF_FORBIDDEN_RELATIONS,
  buildSelfSkillClaim, buildEndorsedSkillClaim, skillClaimId, skillEndorsementDigest,
  SKILL_ENDORSEMENT_TYPEHASH, type Hex32,
} from '../../src/index.js';

const SOL = join(dirname(fileURLToPath(import.meta.url)), '../../../contracts/src/skills/SkillDefinitionRegistry.sol');
const subject = '0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9' as const;
const issuer = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' as const;
const skillId = `0x${'ab'.repeat(32)}` as Hex32;
const nonce = `0x${'cd'.repeat(32)}` as Hex32;

describe('agent-skills — lockstep with SkillDefinitionRegistry', () => {
  it('SKILL_KIND values equal keccak of the live contract KIND_* URIs', () => {
    const src = readFileSync(SOL, 'utf8');
    const solUri = (name: string) => new RegExp(`${name}\\s*=\\s*keccak256\\(bytes\\("([^"]+)"\\)\\)`).exec(src)![1]!;
    expect(SKILL_KIND_URI.Leaf).toBe(solUri('KIND_LEAF'));
    expect(SKILL_KIND_URI.Domain).toBe(solUri('KIND_DOMAIN'));
    expect(SKILL_KIND_URI.Custom).toBe(solUri('KIND_CUSTOM'));
    // and the bytes32 == keccak of that URI (what the contract stores)
    expect(SKILL_KIND.Leaf).toBe(keccak256(stringToBytes(solUri('KIND_LEAF'))));
    expect(SKILL_KIND.Custom).toBe(keccak256(stringToBytes(solUri('KIND_CUSTOM'))));
  });
});

describe('agent-skills — claim builders', () => {
  it('buildSelfSkillClaim builds a self VC (issuer == subject)', () => {
    const c = buildSelfSkillClaim({ chainId: 84532, subject, definition: { skillId, version: 1 }, relation: SKILL_RELATION.hasSkill, proficiencyScore: 5000, nonce });
    expect(c.issuer).toBe(`eip155:84532:${subject}`);
    expect(c.credentialSubject.subject).toBe(subject);
    expect(c.credentialSubject.claimId).toBe(skillClaimId({ subject, skillId, relation: SKILL_RELATION.hasSkill, nonce }));
  });

  it('rejects self-meaningless relations + over-cap proficiency', () => {
    expect(SELF_FORBIDDEN_RELATIONS).toContain(SKILL_RELATION.certifiedIn);
    expect(() => buildSelfSkillClaim({ chainId: 84532, subject, definition: { skillId, version: 1 }, relation: SKILL_RELATION.certifiedIn, nonce })).toThrow();
    expect(() => buildSelfSkillClaim({ chainId: 84532, subject, definition: { skillId, version: 1 }, relation: SKILL_RELATION.hasSkill, proficiencyScore: 9000, nonce })).toThrow();
  });

  it('buildEndorsedSkillClaim returns a cross-issued VC + the issuer endorsement digest', () => {
    const { credential, endorsementDigest } = buildEndorsedSkillClaim({
      chainId: 84532, subject, issuer, definition: { skillId, version: 2 }, relation: SKILL_RELATION.certifiedIn, proficiencyScore: 9000, nonce,
    });
    expect(credential.issuer).toBe(`eip155:84532:${issuer}`);
    expect(endorsementDigest).toBe(skillEndorsementDigest({ subject, skillId, skillVersion: 2, relation: SKILL_RELATION.certifiedIn, proficiencyScore: 9000, validAfter: 0, validUntil: 0, nonce }));
    expect(() => buildEndorsedSkillClaim({ chainId: 84532, subject, issuer: subject, definition: { skillId, version: 1 }, relation: SKILL_RELATION.hasSkill, nonce })).toThrow();
  });
});

describe('agent-skills — digest math matches abi.encode', () => {
  it('skillEndorsementDigest equals keccak(abi.encode(TYPEHASH, …))', () => {
    const expected = keccak256(encodeAbiParameters(
      [{ type: 'bytes32' }, { type: 'address' }, { type: 'bytes32' }, { type: 'uint64' }, { type: 'bytes32' }, { type: 'uint16' }, { type: 'uint64' }, { type: 'uint64' }, { type: 'bytes32' }],
      [SKILL_ENDORSEMENT_TYPEHASH, subject, skillId, 3n, SKILL_RELATION.certifiedIn, 9000, 0n, 0n, nonce],
    ));
    expect(skillEndorsementDigest({ subject, skillId, skillVersion: 3, relation: SKILL_RELATION.certifiedIn, proficiencyScore: 9000, validAfter: 0, validUntil: 0, nonce })).toBe(expected);
  });

  it('skillClaimId equals keccak(abi.encode(subject, skillId, relation, nonce))', () => {
    const expected = keccak256(encodeAbiParameters(
      [{ type: 'address' }, { type: 'bytes32' }, { type: 'bytes32' }, { type: 'bytes32' }],
      [subject, skillId, SKILL_RELATION.hasSkill, nonce],
    ));
    expect(skillClaimId({ subject, skillId, relation: SKILL_RELATION.hasSkill, nonce })).toBe(expected);
  });
});
