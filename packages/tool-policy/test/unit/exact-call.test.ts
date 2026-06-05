import { describe, it, expect } from 'vitest';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { exactCall, matchesExactCall } from '../../src/exact-call';

function keccak256(hex: `0x${string}`): `0x${string}` {
  const cleaned = hex.slice(2);
  const bytes = new Uint8Array(cleaned.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(cleaned.slice(i * 2, i * 2 + 2), 16);
  const out = keccak_256(bytes);
  let s = '0x';
  for (const b of out) s += b.toString(16).padStart(2, '0');
  return s as `0x${string}`;
}

const TARGET = '0x1111111111111111111111111111111111111111' as const;
const SELECTOR = '0xa9059cbb' as const; // transfer(address,uint256)

describe('exactCall + matchesExactCall', () => {
  it('matches when target + selector match', () => {
    const p = exactCall(TARGET, SELECTOR);
    const call = { to: TARGET, data: (SELECTOR + 'aa'.repeat(64)) as `0x${string}`, value: 0n };
    expect(matchesExactCall(call, p)).toBe(true);
  });

  it('rejects wrong target', () => {
    const p = exactCall(TARGET, SELECTOR);
    const call = {
      to: '0x2222222222222222222222222222222222222222' as const,
      data: SELECTOR + 'aa'.repeat(64) as `0x${string}`,
      value: 0n,
    };
    expect(matchesExactCall(call, p)).toBe(false);
  });

  it('rejects wrong selector', () => {
    const p = exactCall(TARGET, SELECTOR);
    const call = { to: TARGET, data: '0xdeadbeef' + 'aa'.repeat(64) as `0x${string}`, value: 0n };
    expect(matchesExactCall(call, p)).toBe(false);
  });

  it('with calldataHash: byte-identical match required', () => {
    const data = (SELECTOR + 'bb'.repeat(64)) as `0x${string}`;
    const hash = keccak256(data);
    const p = exactCall(TARGET, SELECTOR, { calldataHash: hash });
    expect(matchesExactCall({ to: TARGET, data, value: 0n }, p)).toBe(true);
    // Change a single byte → mismatch
    const tampered = (SELECTOR + 'bc'.repeat(64)) as `0x${string}`;
    expect(matchesExactCall({ to: TARGET, data: tampered, value: 0n }, p)).toBe(false);
  });

  it('enforces valueLimit', () => {
    const p = exactCall(TARGET, SELECTOR, { valueLimit: 100n });
    const data = (SELECTOR + 'aa'.repeat(64)) as `0x${string}`;
    expect(matchesExactCall({ to: TARGET, data, value: 100n }, p)).toBe(true);
    expect(matchesExactCall({ to: TARGET, data, value: 101n }, p)).toBe(false);
  });

  it('rejects malformed selectors at policy creation', () => {
    expect(() => exactCall(TARGET, '0xabcd' as `0x${string}`)).toThrow(/4 bytes/);
  });

  it('rejects malformed calldataHash', () => {
    expect(() => exactCall(TARGET, SELECTOR, { calldataHash: '0xshort' as `0x${string}` })).toThrow(/32 bytes/);
  });
});
