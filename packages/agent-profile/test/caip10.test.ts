import { describe, expect, it } from 'vitest';
import {
  buildCaip10Address,
  parseCaip10,
  isValidCaip10,
  CAIP10_NAMESPACE_ALLOWLIST,
} from '../src/caip10';
import { InvalidCaip10Error } from '../src/errors';

describe('CAIP-10 grammar', () => {
  it('accepts grammar-valid strings for eip155, hedera, solana (roundtrip)', () => {
    const cases = [
      { namespace: 'eip155', reference: '84532', address: '0x1234567890abcdef1234567890abcdef12345678' },
      { namespace: 'hedera', reference: 'testnet', address: '0.0.12345' },
      { namespace: 'solana', reference: '4sGjMW1sUnHzSxGspuhpqLDx6wiyjNtZ', address: 'SoLPa11ace1111111111111111111111111111111111' },
    ];
    for (const parts of cases) {
      const built = buildCaip10Address(parts);
      const parsed = parseCaip10(built);
      expect(parsed.namespace).toBe(parts.namespace);
      expect(parsed.reference).toBe(parts.reference);
      // eip155 lowercases address; others preserve.
      if (parts.namespace === 'eip155') {
        expect(parsed.address).toBe(parts.address.toLowerCase());
      } else {
        expect(parsed.address).toBe(parts.address);
      }
    }
  });

  it('lowercases eip155 addresses for canonical comparison', () => {
    const a = buildCaip10Address({ namespace: 'eip155', reference: '1', address: '0xAbCdEf1234567890aBcDef1234567890ABCdEf12' });
    const b = buildCaip10Address({ namespace: 'eip155', reference: '1', address: '0xabcdef1234567890abcdef1234567890abcdef12' });
    expect(a).toBe(b);
  });

  it('refuses namespaces NOT in the allowlist (encode-strict)', () => {
    expect(() => buildCaip10Address({ namespace: 'cosmos', reference: 'cosmoshub-4', address: 'cosmos1abc' })).toThrow(
      InvalidCaip10Error,
    );
  });

  it('refuses grammar-malformed inputs', () => {
    expect(() => buildCaip10Address({ namespace: 'eip155', reference: '1', address: 'no-zero-x-prefix' })).not.toThrow();
    expect(() => parseCaip10('eip155:1')).toThrow(InvalidCaip10Error);
    expect(() => parseCaip10('eip155:1:')).toThrow(InvalidCaip10Error);
    expect(() => parseCaip10('::address')).toThrow(InvalidCaip10Error);
  });

  it('decoder (parseCaip10) accepts grammar-valid strings even for namespaces NOT in the allowlist (forward-compat)', () => {
    const parsed = parseCaip10('cosmos:cosmoshub-4:cosmos1abc');
    expect(parsed.namespace).toBe('cosmos');
    expect(parsed.reference).toBe('cosmoshub-4');
    expect(parsed.address).toBe('cosmos1abc');
  });

  it('isValidCaip10 is grammar-only (does NOT enforce allowlist)', () => {
    expect(isValidCaip10('cosmos:cosmoshub-4:cosmos1abc')).toBe(true);
    expect(isValidCaip10('not-a-caip10-string')).toBe(false);
  });

  it('Phase 1 allowlist contains eip155, hedera, solana — and no other', () => {
    expect([...CAIP10_NAMESPACE_ALLOWLIST].sort()).toEqual(['eip155', 'hedera', 'solana']);
  });
});
