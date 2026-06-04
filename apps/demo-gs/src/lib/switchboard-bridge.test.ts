import { describe, expect, it } from 'vitest';
import { SWITCHBOARD_ROLES, type SwitchboardRole } from '../data/switchboard-roles';
import { bridgedNeedId, mapRoles, roleToNeed } from './switchboard-bridge';

const byId = (id: string): SwitchboardRole => SWITCHBOARD_ROLES.find((r) => r.id === id)!;
const AT = '2026-06-03T00:00:00Z';

describe('Pattern-A Switchboard read bridge', () => {
  it('maps exact-slug skills + an alias region, tagging provenance', () => {
    const { need, mappedSkills, unmappedSkills, region } = roleToNeed(byId('SBR-1042'), AT);
    expect(mappedSkills.map((s) => s.gcUri.split('/').pop())).toEqual(['grant-writing', 'proposal-budgeting']);
    expect(unmappedSkills).toEqual([]);
    expect(region?.uri.endsWith('sub-saharan-africa')).toBe(true); // 'ssa' alias resolved
    expect(need.id).toBe('gc:need:switchboard:SBR-1042');
    expect(need.provenance?.source).toBe('switchboard-bridge');
    expect(need.provenance?.sourceUri).toBe('https://switchboard.global.church/roles/SBR-1042');
    expect(need.provenance?.importedAt).toBe(AT);
    expect(need.visibility).toBe('public');
    expect(need.confidentialContact).toContain('partnerships@sahelhope.example');
    expect(need.status).toBe('open');
  });

  it('resolves a skill alias (videography → video-production)', () => {
    const { mappedSkills } = roleToNeed(byId('SBR-1077'), AT);
    expect(mappedSkills.some((s) => s.gcUri.endsWith('video-production'))).toBe(true);
  });

  it('SURFACES an unmapped skill on provenance, never silently dropping it', () => {
    const { need, mappedSkills, unmappedSkills } = roleToNeed(byId('SBR-1101'), AT);
    expect(unmappedSkills).toContain('prayer-mobilization');
    expect(mappedSkills.map((s) => s.gcUri.split('/').pop())).toEqual(['web-development', 'data-analysis']);
    expect(need.provenance?.unmapped?.skills).toContain('prayer-mobilization');
    expect(need.geoFacets[0]?.uri.endsWith('global')).toBe(true); // 'remote' → global
  });

  it('coarsens a creative-access region to confidential visibility', () => {
    const { need, region } = roleToNeed(byId('SBR-1090'), AT); // mena → middle-east (creative_access)
    expect(region?.sensitivity).toBe('creative_access');
    expect(need.visibility).toBe('confidential');
  });

  it('produces a deterministic, idempotent Need id', () => {
    expect(bridgedNeedId('SBR-1042')).toBe('gc:need:switchboard:SBR-1042');
    expect(roleToNeed(byId('SBR-1042'), AT).need.id).toBe(roleToNeed(byId('SBR-1042'), 'other-time').need.id);
  });

  it('totals mapped vs. unmapped across a batch', () => {
    const res = mapRoles(SWITCHBOARD_ROLES, AT);
    expect(res.imported).toBe(4);
    expect(res.totalUnmappedSkills).toBe(1); // only prayer-mobilization
    expect(res.totalUnmappedRegions).toBe(0); // every region slug/alias resolves
  });
});
