// Org-name → `.impact` label validation. A raw display name (spaces, capitals,
// punctuation) must be normalized to a subregistry-safe `[a-z0-9-]` label before
// it's sent to the Impact org-create ceremony — otherwise the member lands on the
// home's "Request blocked" screen.

import { describe, expect, it } from 'vitest';
import { toOrgLabel } from '../member-org.js';

describe('toOrgLabel', () => {
  it('lowercases + hyphenates spaces (the Calvary Bible case)', () => {
    expect(toOrgLabel('Calvary Bible')).toBe('calvary-bible');
  });

  it('collapses runs of punctuation/whitespace to a single hyphen', () => {
    expect(toOrgLabel('Grace   Community  Church!!')).toBe('grace-community-church');
    expect(toOrgLabel('St. John’s (Downtown)')).toBe('st-john-s-downtown');
  });

  it('strips leading/trailing hyphens', () => {
    expect(toOrgLabel('  -Frontier Path-  ')).toBe('frontier-path');
    expect(toOrgLabel('***hub***')).toBe('hub');
  });

  it('keeps already-valid labels intact', () => {
    expect(toOrgLabel('calvary-bible')).toBe('calvary-bible');
    expect(toOrgLabel('east-asia-2026')).toBe('east-asia-2026');
  });

  it('caps length at 63 chars with no trailing hyphen', () => {
    const long = 'a'.repeat(80);
    expect(toOrgLabel(long).length).toBe(63);
    const longWithBreak = 'a'.repeat(62) + ' ' + 'b'.repeat(10); // hyphen would land at 63
    expect(toOrgLabel(longWithBreak).endsWith('-')).toBe(false);
  });

  it('produces an empty/too-short label for input with no alphanumerics', () => {
    expect(toOrgLabel('   ')).toBe('');
    expect(toOrgLabel('!!!')).toBe('');
    expect(toOrgLabel('a').length).toBeLessThan(2); // single char → caller rejects
  });
});
