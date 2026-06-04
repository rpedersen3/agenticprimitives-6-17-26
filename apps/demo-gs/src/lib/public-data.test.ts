import { describe, expect, it } from 'vitest';
import { publicNeeds, publicOfferings } from './public-data';
import { buildDirectory, searchDirectory } from './directory';
import { computeSignal } from './signal';

describe('public read API dataset', () => {
  it('unions canonical fixtures with bridged Switchboard demand', () => {
    const needs = publicNeeds();
    expect(needs.some((n) => n.id.startsWith('gc:need:demo-gs:'))).toBe(true); // fixtures
    expect(needs.some((n) => n.id.startsWith('gc:need:switchboard:'))).toBe(true); // bridged
    expect(needs.every((n) => n.createdAt)).toBe(true);
  });

  it('the directory projection exposes bridged needs with provenance, never raw contact', () => {
    const entries = buildDirectory(publicNeeds(), publicOfferings());
    const bridged = searchDirectory(entries, { kind: 'need' }).filter((e) => e.kind === 'need' && e.bridged);
    expect(bridged.length).toBeGreaterThan(0);
    expect(JSON.stringify(entries)).not.toContain('@'); // no contact emails leak into the public projection
  });

  it('the signal counts the unioned demand', () => {
    const sig = computeSignal(publicNeeds(), publicOfferings());
    expect(sig.openCount).toBeGreaterThanOrEqual(publicNeeds().filter((n) => n.status === 'open').length - 1);
    expect(sig.bySkill.length).toBeGreaterThan(0);
  });
});
