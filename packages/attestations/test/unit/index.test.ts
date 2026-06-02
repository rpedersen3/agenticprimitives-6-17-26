import { describe, expect, it } from 'vitest';
import {
  PACKAGE_NAME,
  PACKAGE_STATUS,
  SPEC_REF,
  CREDENTIAL_TYPE,
  computeAttestationUid,
} from '../../src/index.js';

describe('attestations package identity', () => {
  it('exposes the spec ref + W1 status', () => {
    expect(PACKAGE_NAME).toBe('@agenticprimitives/attestations');
    expect(PACKAGE_STATUS).toBe('w1-foundational');
    expect(SPEC_REF).toContain('242-');
  });
});

describe('CREDENTIAL_TYPE discriminators', () => {
  it('all credential types have unique 32-byte hashes', () => {
    const values = Object.values(CREDENTIAL_TYPE);
    const unique = new Set(values);
    expect(unique.size).toBe(values.length);
    for (const v of values) {
      expect(v).toMatch(/^0x[0-9a-f]{64}$/);
    }
  });
});

describe('computeAttestationUid', () => {
  it('is deterministic + sensitive to inputs', () => {
    const base = {
      subject: '0x1111111111111111111111111111111111111111' as const,
      party2: '0x0000000000000000000000000000000000000000' as const,
      issuer: '0x2222222222222222222222222222222222222222' as const,
      credentialType: CREDENTIAL_TYPE.Association,
      credentialHash: ('0x' + 'aa'.repeat(32)) as `0x${string}`,
      refUID: ('0x' + '00'.repeat(32)) as `0x${string}`,
      salt: 42n,
    };
    expect(computeAttestationUid(base)).toBe(computeAttestationUid(base));
    expect(
      computeAttestationUid({ ...base, subject: '0x3333333333333333333333333333333333333333' as const }),
    ).not.toBe(computeAttestationUid(base));
  });
});
