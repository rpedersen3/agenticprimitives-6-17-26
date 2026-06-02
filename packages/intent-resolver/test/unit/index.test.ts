import { describe, expect, it } from 'vitest';
import { PACKAGE_NAME, PACKAGE_STATUS, SPEC_REF, PassThroughResolver } from '../../src/index.js';

describe('intent-resolver skeleton', () => {
  it('exposes the spec ref + W1 status', () => {
    expect(PACKAGE_NAME).toBe('@agenticprimitives/intent-resolver');
    expect(PACKAGE_STATUS).toBe('w1-skeleton');
    expect(SPEC_REF).toContain('239-');
  });

  it('PassThroughResolver passes the intent through unchanged', async () => {
    const r = new PassThroughResolver();
    const resolved = await r.resolve({
      id: 'i-1',
      hasConstraintSet: { hardConstraints: [], softConstraints: [] },
      hasAssumptionSet: undefined,
    });
    expect(resolved?.resolvedFromIntentId).toBe('i-1');
    expect(resolved?.canonicalConstraints).toEqual({ hardConstraints: [], softConstraints: [] });
    expect(resolved?.expandedAssumptions).toBeNull();
  });
});
