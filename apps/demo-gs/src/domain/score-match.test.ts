import { describe, it, expect } from 'vitest';
import { rankMatches, scoreMatch } from './score-match';
import { SEED_NEEDS, SEED_OFFERINGS } from '../data/__fixtures__/sample';
import type { ExpertOffering, GcoNeedIntent } from './gs-types';

const CLOCK = () => '2026-06-01T00:00:00Z';
const need = (id: string) => SEED_NEEDS.find((n) => n.id === id)!;
const offering = (id: string) => SEED_OFFERINGS.find((o) => o.id === id)!;

describe('score-match — golden grant-writing path', () => {
  const m = scoreMatch(need('gc:need:demo-gs:grant-writing-na-001'), offering('gc:offering:demo-gs:kc-grant-writing-001'), CLOCK);

  it('scores high on exact skill + geo + cause + language + evidence', () => {
    expect(m.score).toBeGreaterThanOrEqual(80);
    const kinds = m.reasons.map((r) => r.kind);
    expect(kinds).toContain('skill_exact');
    expect(kinds).toContain('geo_exact');
    expect(kinds).toContain('cause');
    expect(kinds).toContain('language');
    expect(kinds).toContain('trust_evidence');
  });

  it('is deterministic (stable id + score across runs)', () => {
    const again = scoreMatch(need('gc:need:demo-gs:grant-writing-na-001'), offering('gc:offering:demo-gs:kc-grant-writing-001'), CLOCK);
    expect(again.id).toBe(m.id);
    expect(again.score).toBe(m.score);
  });
});

describe('score-match — exact skill ≫ category', () => {
  const baseNeed: GcoNeedIntent = {
    ...need('gc:need:demo-gs:grant-writing-na-001'),
    geoFacets: [], causeFacets: [], languages: [], desiredSkills: [],
  };
  const exact = offering('gc:offering:demo-gs:kc-grant-writing-001');
  // An offering with NO grant-writing but a same-category skill (donor-communications is also
  // fundraising-development — drop grant-writing to isolate category-only).
  const categoryOnly: ExpertOffering = {
    ...exact,
    id: 'gc:offering:test:category-only',
    offeredSkills: exact.offeredSkills.filter((s) => !s.gcUri.endsWith('grant-writing')),
  };

  it('an exact-skill match outscores a category-only match', () => {
    const exactM = scoreMatch(baseNeed, exact, CLOCK);
    const catM = scoreMatch(baseNeed, categoryOnly, CLOCK);
    expect(exactM.score).toBeGreaterThan(catM.score);
    expect(exactM.reasons.some((r) => r.kind === 'skill_exact')).toBe(true);
    expect(catM.reasons.some((r) => r.kind === 'skill_exact')).toBe(false);
    expect(catM.reasons.some((r) => r.kind === 'skill_category')).toBe(true);
  });
});

describe('score-match — availability + missing signals', () => {
  it('flags an unavailable expert with a policy warning + penalty', () => {
    const o = { ...offering('gc:offering:demo-gs:kc-grant-writing-001'), capacity: { availabilityStatus: 'paused' as const } };
    const m = scoreMatch(need('gc:need:demo-gs:grant-writing-na-001'), o, CLOCK);
    expect(m.policyWarnings.some((w) => /not currently available/i.test(w))).toBe(true);
    expect(m.missing.some((x) => x.kind === 'policy')).toBe(true);
  });

  it('records missing required skill when not offered', () => {
    const m = scoreMatch(need('gc:need:demo-gs:video-sea-002'), offering('gc:offering:demo-gs:kc-grant-writing-001'), CLOCK);
    expect(m.missing.some((x) => x.kind === 'skill_exact')).toBe(true);
  });

  it('surfaces a sensitive-region suppression warning', () => {
    const m = scoreMatch(need('gc:need:demo-gs:translate-me-003'), offering('gc:offering:demo-gs:kc-translate-003'), CLOCK);
    expect(m.policyWarnings.some((w) => /sensitive region/i.test(w))).toBe(true);
  });
});

describe('rankMatches — drops zero-overlap noise + ranks high→low', () => {
  const ranked = rankMatches(need('gc:need:demo-gs:grant-writing-na-001'), SEED_OFFERINGS, CLOCK);

  it('returns only offerings with some skill/category overlap', () => {
    expect(ranked.length).toBeGreaterThan(0);
    // The web-dev + coaching offerings share no grant-writing skill/category → excluded.
    expect(ranked.every((m) => m.reasons.some((r) => r.kind === 'skill_exact' || r.kind === 'skill_category'))).toBe(true);
  });

  it('puts the grant-writing expert first', () => {
    expect(ranked[0]!.offeringId).toBe('gc:offering:demo-gs:kc-grant-writing-001');
    expect(ranked[0]!.score).toBeGreaterThanOrEqual(ranked[ranked.length - 1]!.score);
  });
});
