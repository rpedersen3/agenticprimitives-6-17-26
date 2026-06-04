import { describe, expect, it } from 'vitest';
import type { ExpertOffering, GcoNeedIntent } from '../domain/gs-types';
import { CAUSES, REGIONS, skillBySlug } from '../data/taxonomy';
import { caip10, GCO_ORG, GCO_PERSON_EOA, KC_EOA } from './personas';
import { buildDirectory, directoryFacets, projectNeed, projectOffering, searchDirectory } from './directory';

const region = (slug: string) => REGIONS.find((r) => r.uri.endsWith(slug))!;
const cause = (slug: string) => CAUSES.find((c) => c.uri.endsWith(slug))!;
const T = '2026-06-01T00:00:00Z';

function need(over: Partial<GcoNeedIntent>): GcoNeedIntent {
  return {
    id: 'gc:need:test:1', ownerOrgAgentId: caip10(GCO_ORG), createdByPersonAgentId: caip10(GCO_PERSON_EOA),
    title: 'A need', needKind: 'project', requiredSkills: [skillBySlug('grant-writing')], geoFacets: [region('sub-saharan-africa')],
    causeFacets: [cause('disciple-making')], visibility: 'public', status: 'open', createdAt: T, updatedAt: T, ...over,
  };
}
function offering(over: Partial<ExpertOffering>): ExpertOffering {
  return {
    id: 'gc:offering:test:1', ownerPersonAgentId: caip10(KC_EOA), displayName: 'Dana', headline: 'Grant strategy',
    offeredSkills: [skillBySlug('grant-writing')], geoFacets: [region('north-africa')], visibility: 'public-summary',
    confidentialContact: 'dana@secret.example (confidential)', status: 'active', createdAt: T, updatedAt: T, ...over,
  };
}

describe('directory projection — privacy tiers', () => {
  it('excludes sensitive-tier needs entirely (absence)', () => {
    expect(projectNeed(need({ visibility: 'sensitive' }))).toBeNull();
  });

  it('coarsens a confidential need: flagged + region collapsed, never the raw geo', () => {
    const d = projectNeed(need({ visibility: 'confidential', geoFacets: [region('middle-east')] }))!;
    expect(d.confidential).toBe(true);
    expect(d.regions.every((r) => r.coarsened && r.uri === 'sensitive')).toBe(true);
  });

  it('coarsens a creative-access region even on a public need', () => {
    const d = projectNeed(need({ geoFacets: [region('north-africa')] }))!; // north-africa = creative_access
    expect(d.confidential).toBe(false);
    expect(d.regions[0]!).toMatchObject({ uri: 'sensitive', coarsened: true });
  });

  it('keeps a normal region uncoarsened', () => {
    const d = projectNeed(need({}))!; // sub-saharan-africa
    expect(d.regions[0]!.coarsened).toBe(false);
    expect(d.regions[0]!.uri.endsWith('sub-saharan-africa')).toBe(true);
  });

  it('offering shows the public handle, never the confidential contact', () => {
    const d = projectOffering(offering({}))!;
    expect(d.ownerLabel).toBe('Dana');
    expect(JSON.stringify(d)).not.toContain('dana@secret.example');
  });

  it('drops fulfilled needs + non-active offerings from the directory', () => {
    const entries = buildDirectory(
      [need({ id: 'a', status: 'open' }), need({ id: 'b', status: 'fulfilled' })],
      [offering({ id: 'c', status: 'active' }), offering({ id: 'd', status: 'paused' })],
    );
    expect(entries.map((e) => e.id).sort()).toEqual(['a', 'c']);
  });
});

describe('directory search + facets', () => {
  const entries = buildDirectory(
    [
      need({ id: 'n-grant', title: 'Grant help', requiredSkills: [skillBySlug('grant-writing')], geoFacets: [region('sub-saharan-africa')] }),
      need({ id: 'n-video', title: 'Video story', requiredSkills: [skillBySlug('video-production')], geoFacets: [region('southeast-asia')], causeFacets: [cause('church-planting')] }),
    ],
    [offering({ id: 'o-grant', headline: 'Grant strategy', offeredSkills: [skillBySlug('grant-writing')], geoFacets: [region('sub-saharan-africa')] })],
  );

  it('filters by kind', () => {
    expect(searchDirectory(entries, { kind: 'offering' }).map((e) => e.id)).toEqual(['o-grant']);
  });
  it('filters by skill category', () => {
    const media = skillBySlug('video-production').categoryUri;
    expect(searchDirectory(entries, { categoryUri: media }).map((e) => e.id)).toEqual(['n-video']);
  });
  it('filters by region and free text', () => {
    expect(searchDirectory(entries, { regionUri: region('southeast-asia').uri }).map((e) => e.id)).toEqual(['n-video']);
    expect(searchDirectory(entries, { text: 'grant' }).map((e) => e.id).sort()).toEqual(['n-grant', 'o-grant']);
  });
  it('computes facet counts', () => {
    const f = directoryFacets(entries);
    expect(f.causes.find((c) => c.label === 'Church Planting')?.n).toBe(1);
    expect(f.regions.find((r) => r.uri.endsWith('sub-saharan-africa'))?.n).toBe(2);
  });
});
