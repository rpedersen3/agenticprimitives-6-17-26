import { describe, expect, it } from 'vitest';
import { publicNeeds, publicOfferings } from './public-data';
import { buildDirectory, searchDirectory } from './directory';
import { computeSignal } from './signal';

// Wave 2 (spec 252): the public read API serves the bridged Switchboard demand only — member
// needs/offerings are private to each member's vault and never enter this public feed.
describe('public read API dataset', () => {
  it('is the bridged Switchboard demand (no in-app sample fixtures)', () => {
    const needs = publicNeeds();
    expect(needs.length).toBeGreaterThan(0);
    expect(needs.every((n) => n.id.startsWith('gc:need:switchboard:'))).toBe(true); // bridged only
    expect(needs.every((n) => n.createdAt)).toBe(true);
    expect(publicOfferings()).toEqual([]); // supply is private to each KC's vault
  });

  it('the directory projection exposes bridged needs with provenance, never raw contact', () => {
    const entries = buildDirectory(publicNeeds(), publicOfferings());
    const bridged = searchDirectory(entries, { kind: 'need' }).filter((e) => e.kind === 'need' && e.bridged);
    expect(bridged.length).toBeGreaterThan(0);
    expect(JSON.stringify(entries)).not.toContain('@'); // no contact emails leak into the public projection
  });

  it('the signal counts the bridged demand', () => {
    const sig = computeSignal(publicNeeds(), publicOfferings());
    expect(sig.openCount).toBeGreaterThan(0);
    expect(sig.bySkill.length).toBeGreaterThan(0);
  });
});
