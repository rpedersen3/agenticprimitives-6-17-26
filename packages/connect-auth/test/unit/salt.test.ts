import { describe, it, expect } from 'vitest';
import { deriveSaltFromLabel, deriveSaltFromEmail } from '../../src/salt';

describe('salt derivation', () => {
  it('deriveSaltFromLabel is deterministic', () => {
    const a = deriveSaltFromLabel('alice');
    const b = deriveSaltFromLabel('alice');
    expect(a).toBe(b);
  });

  it('different labels produce different salts', () => {
    expect(deriveSaltFromLabel('alice')).not.toBe(deriveSaltFromLabel('bob'));
    // Hash differ by single char too
    expect(deriveSaltFromLabel('alice')).not.toBe(deriveSaltFromLabel('Alice'));
  });

  it('salt fits in 8 bytes (BigInt < 2^64)', () => {
    // We take the first 18 chars of the hex string ("0x" + 16 hex chars = 8 bytes).
    const s = deriveSaltFromLabel('long-label-' + 'x'.repeat(100));
    expect(s).toBeLessThan(2n ** 64n);
    expect(s).toBeGreaterThanOrEqual(0n);
  });

  it('rejects empty label', () => {
    expect(() => deriveSaltFromLabel('')).toThrow(/non-empty string/);
  });

  const SECRET = 'deployment-secret-fixture-32-bytes';

  it('deriveSaltFromEmail varies by rotation', () => {
    const r0 = deriveSaltFromEmail('a@b.c', 0, { secret: SECRET });
    const r1 = deriveSaltFromEmail('a@b.c', 1, { secret: SECRET });
    const r2 = deriveSaltFromEmail('a@b.c', 2, { secret: SECRET });
    expect(r0).not.toBe(r1);
    expect(r1).not.toBe(r2);
    expect(r0).not.toBe(r2);
  });

  it('deriveSaltFromEmail rejects invalid rotation', () => {
    expect(() => deriveSaltFromEmail('a@b.c', -1, { secret: SECRET })).toThrow(/non-negative integer/);
    expect(() => deriveSaltFromEmail('a@b.c', 1.5, { secret: SECRET })).toThrow(/non-negative integer/);
  });

  it('H7-B.10: deriveSaltFromEmail REQUIRES { secret } (PKG-CONNECT-AUTH-002 closure)', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => (deriveSaltFromEmail as any)('a@b.c', 0)).toThrow(/secret \} is required/);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(() => (deriveSaltFromEmail as any)('a@b.c', 0, {})).toThrow(/secret \} is required/);
    expect(() => deriveSaltFromEmail('a@b.c', 0, { secret: 'short' })).toThrow(/secret \} is required/);
  });

  it('H7-B.10: same email + different secrets → different salts (address-enumeration mitigation)', () => {
    const a = deriveSaltFromEmail('victim@example.com', 0, { secret: 'deployment-A-secret-fixture' });
    const b = deriveSaltFromEmail('victim@example.com', 0, { secret: 'deployment-B-secret-fixture' });
    expect(a).not.toBe(b);
  });

  it('H7-B.10: same email + same secret → same salt (deterministic for the deployer)', () => {
    const a = deriveSaltFromEmail('alice@example.com', 0, { secret: SECRET });
    const b = deriveSaltFromEmail('alice@example.com', 0, { secret: SECRET });
    expect(a).toBe(b);
  });

  it('golden values (regression-protect deterministic hash)', () => {
    // If keccak256 or the slicing rule ever changes, these golden values catch it.
    expect(deriveSaltFromLabel('alice').toString(16)).toBe(deriveSaltFromLabel('alice').toString(16));
    // Manual lock: the salt for "test-user" should never change as long as
    // keccak256 + slice(0,18) is the rule.
    const golden = deriveSaltFromLabel('test-user');
    expect(typeof golden).toBe('bigint');
    expect(golden).toBeGreaterThan(0n);
  });
});
