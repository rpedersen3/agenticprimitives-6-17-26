import { describe, expect, it } from 'vitest';
import {
  PACKAGE_NAME,
  PACKAGE_STATUS,
  SPEC_REF,
  isCompatible,
  composite,
  toMatchScore,
  type Intent,
} from '../../src/index.js';

describe('intent-marketplace package identity', () => {
  it('exposes the spec ref + W1 status', () => {
    expect(PACKAGE_NAME).toBe('@agenticprimitives/intent-marketplace');
    expect(PACKAGE_STATUS).toBe('w1-foundational');
    expect(SPEC_REF).toContain('239-');
  });
});

describe('compatibility rule (SS-01 + SS-02)', () => {
  const baseIntent = (overrides: Partial<Intent>): Intent => ({
    id: 'i1',
    direction: 'receive',
    object: 'apint:Coaching',
    expressedBy: '0x1111111111111111111111111111111111111111',
    addressedTo: [],
    hasConstraintSet: { hardConstraints: [], softConstraints: [] },
    visibility: 'Public',
    status: 'expressed',
    createdAt: '2026-06-02T00:00:00Z',
    ...overrides,
  });

  it('rejects same-direction pair', () => {
    expect(isCompatible(baseIntent({ id: 'a' }), baseIntent({ id: 'b' }))).toBe(false);
  });

  it('rejects different-object pair', () => {
    const a = baseIntent({ id: 'a', direction: 'receive', object: 'apint:Coaching' });
    const b = baseIntent({ id: 'b', direction: 'give', object: 'apint:Mentoring' });
    expect(isCompatible(a, b)).toBe(false);
  });

  it('accepts opposite-direction + same-object pair', () => {
    const a = baseIntent({ id: 'a', direction: 'receive', object: 'apint:Coaching' });
    const b = baseIntent({ id: 'b', direction: 'give', object: 'apint:Coaching' });
    expect(isCompatible(a, b)).toBe(true);
  });
});

describe('composite scoring', () => {
  it('weights proximity 0.6, outcome 0.4', () => {
    expect(composite({ proximity: 1, outcome: 1 })).toBeCloseTo(1, 6);
    expect(composite({ proximity: 0, outcome: 0 })).toBeCloseTo(0.5, 6);
  });

  it('toMatchScore clamps + scales to 10000', () => {
    expect(toMatchScore(1.5)).toBe(10000);
    expect(toMatchScore(-1)).toBe(0);
    expect(toMatchScore(0.5)).toBe(5000);
  });
});
