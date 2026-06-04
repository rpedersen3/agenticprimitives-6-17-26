import { describe, it, expect } from 'vitest';
import { computeSkillId } from '@agenticprimitives/agent-skills';
import { computeFeatureId } from '@agenticprimitives/geo-features';
import { REGIONS, skillBySlug } from '../data/taxonomy';
import { SEED_OFFERINGS } from '../data/__fixtures__/sample';
import { offeringGeoClaims, offeringSkillClaims } from './substrate';

describe('demo-gs ↔ substrate anchoring (spec 251 Phase 3)', () => {
  it('every taxonomy SkillRef carries the canonical substrate skillId', () => {
    const s = skillBySlug('grant-writing');
    expect(s.skillId).toBe(computeSkillId(s.gcUri));
    expect(s.skillId).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it('every region carries the canonical substrate featureId', () => {
    for (const r of REGIONS) expect(r.featureId).toBe(computeFeatureId(r.uri));
  });
});

describe('demo-gs Offering → substrate claim credentials', () => {
  const golden = SEED_OFFERINGS.find((o) => o.id.includes('kc-grant-writing'))!;

  it('builds a self skill claim per offered skill, pinned to the on-chain definition', () => {
    const claims = offeringSkillClaims(golden);
    expect(claims).toHaveLength(golden.offeredSkills.length);
    // each claim points to the right canonical skillId + is self-issued by the KC SA
    const kcAddr = golden.ownerPersonAgentId.split(':').pop()!.toLowerCase();
    for (const c of claims) {
      expect(c.type).toContain('SkillClaimCredential');
      expect(c.issuer.toLowerCase()).toContain(kcAddr);
      expect(golden.offeredSkills.some((s) => s.skillId === c.credentialSubject.definition.skillId)).toBe(true);
      expect(c.credentialSubject.definition.version).toBe(1);
    }
  });

  it('builds a self geo claim per region focus', () => {
    const claims = offeringGeoClaims(golden);
    expect(claims).toHaveLength((golden.geoFacets ?? []).length);
    for (const c of claims) {
      expect(c.type).toContain('GeoClaimCredential');
      expect((golden.geoFacets ?? []).some((g) => g.featureId === c.credentialSubject.feature.featureId)).toBe(true);
    }
  });

  it('a confidential offering yields private-commitment claims', () => {
    const confidential = { ...golden, visibility: 'confidential' as const };
    expect(offeringSkillClaims(confidential)[0]!.credentialSubject.visibility).toBe('private-commitment');
  });
});
