// Golden fixtures for `canonicalJSON` — the token-mint serialization
// that MUST produce identical bytes across every runtime that uses
// this package (Node, Bun, browser, Cloudflare Workers, Deno).
//
// Drift here is a critical-severity bug: same claims hashing to
// different bytes means the same signature verifies on one runtime
// and rejects on another. The fixtures below capture every shape
// that's appeared in production token payloads.

import { describe, it, expect } from 'vitest';
import { canonicalJSON } from '../../src/token';

describe('canonicalJSON — cross-runtime byte-identity', () => {
  it('sorts top-level keys alphabetically', () => {
    expect(canonicalJSON({ b: 2, a: 1, c: 3 })).toBe('{"a":1,"b":2,"c":3}');
  });

  it('sorts nested keys recursively', () => {
    expect(canonicalJSON({ outer: { z: 'z', a: 'a', m: { x: 1, b: 2 } } })).toBe(
      '{"outer":{"a":"a","m":{"b":2,"x":1},"z":"z"}}',
    );
  });

  it('drops undefined keys (standard JSON behavior)', () => {
    expect(canonicalJSON({ a: 1, b: undefined, c: 3 })).toBe('{"a":1,"c":3}');
  });

  it('serializes bigint as numeric string', () => {
    expect(canonicalJSON({ salt: 12345678901234567890n })).toBe(
      '{"salt":"12345678901234567890"}',
    );
    // Specifically the format used by Delegation.salt — a large random uint256.
    const realisticSalt =
      102835094587103952385720938572038475092834750928347509283470598234705n;
    expect(canonicalJSON({ salt: realisticSalt })).toBe(
      `{"salt":"${realisticSalt.toString()}"}`,
    );
  });

  it('preserves arrays in iteration order, not sorted', () => {
    expect(canonicalJSON({ caveats: ['z', 'a', 'm'] })).toBe('{"caveats":["z","a","m"]}');
  });

  it('replaces undefined array entries with null', () => {
    // Matches standard JSON.stringify semantics for sparse arrays.
    const arr = [1, undefined, 3];
    expect(canonicalJSON(arr)).toBe('[1,null,3]');
  });

  it('handles non-finite numbers as null (matches JSON.stringify)', () => {
    expect(canonicalJSON({ a: NaN, b: Infinity, c: -Infinity, d: 1 })).toBe(
      '{"a":null,"b":null,"c":null,"d":1}',
    );
  });

  it('escapes strings consistently', () => {
    expect(canonicalJSON({ key: 'line1\nline2' })).toBe('{"key":"line1\\nline2"}');
    expect(canonicalJSON({ key: 'quote"and\\backslash' })).toBe(
      '{"key":"quote\\"and\\\\backslash"}',
    );
    expect(canonicalJSON({ key: 'unicodeé' })).toBe('{"key":"unicodeé"}');
  });

  it('throws on circular references rather than producing garbage', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const a: any = { name: 'a' };
    a.self = a;
    expect(() => canonicalJSON(a)).toThrow(/circular/);
  });

  it('throws on unsupported types (functions, symbols)', () => {
    expect(() => canonicalJSON({ fn: () => undefined })).toThrow(/unsupported/);
    expect(() => canonicalJSON({ sym: Symbol('x') })).toThrow(/unsupported/);
  });

  // ─── Golden delegation-token-claims fixture ─────────────────────
  //
  // Realistic shape of `DelegationTokenClaims` per its declared type.
  // If this byte string ever changes, EVERY existing token in flight
  // becomes unverifiable — sign-off required (security review).
  it('golden: full DelegationTokenClaims envelope', () => {
    const claims = {
      iss: 'demo-a2a',
      aud: 'urn:mcp:server:person',
      sub: '0x31ed17fb99e82e02085ab4b3cbdab05489098b44',
      delegation: {
        delegator: '0x31ed17fb99e82e02085ab4b3cbdab05489098b44',
        delegate: '0x9cfc7e44757529769a28747f86425c682fe64653',
        authority:
          '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
        caveats: [
          {
            enforcer: '0xc51255b756219ec5a9a9a378884f7e07f148d0d4',
            terms:
              '0x000000000000000000000000000000000000000000000000683fea170000000000000000000000000000000000000000000000000000000068ab2c97',
            args: '0x',
          },
        ],
        salt: 999000111222333444555666777888999n,
        signature: '0x' + '00'.repeat(65),
      },
      sessionKeyAddress: '0xabcdef0123456789abcdef0123456789abcdef01',
      jti: 'jti_aabbccddeeff00112233445566778899',
      iat: 1716595200,
      exp: 1716595800,
      usageLimit: 10,
    };
    // Compute once; lock it down.
    const got = canonicalJSON(claims);
    expect(got).toMatchInlineSnapshot(
      `"{"aud":"urn:mcp:server:person","delegation":{"authority":"0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff","caveats":[{"args":"0x","enforcer":"0xc51255b756219ec5a9a9a378884f7e07f148d0d4","terms":"0x000000000000000000000000000000000000000000000000683fea170000000000000000000000000000000000000000000000000000000068ab2c97"}],"delegate":"0x9cfc7e44757529769a28747f86425c682fe64653","delegator":"0x31ed17fb99e82e02085ab4b3cbdab05489098b44","salt":"999000111222333444555666777888999","signature":"0x0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000"},"exp":1716595800,"iat":1716595200,"iss":"demo-a2a","jti":"jti_aabbccddeeff00112233445566778899","sessionKeyAddress":"0xabcdef0123456789abcdef0123456789abcdef01","sub":"0x31ed17fb99e82e02085ab4b3cbdab05489098b44","usageLimit":10}"`,
    );
    // Repeat the call — must produce IDENTICAL bytes. If we ever
    // accidentally introduce non-determinism (e.g. iteration order),
    // this assertion catches it.
    expect(canonicalJSON(claims)).toBe(got);
  });
});
