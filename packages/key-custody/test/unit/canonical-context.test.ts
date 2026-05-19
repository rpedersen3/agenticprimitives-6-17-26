import { describe, it, expect } from 'vitest';
import { canonicalContextBytes } from '../../src/aad';

describe('canonicalContextBytes', () => {
  it('produces deterministic output for the same input', () => {
    const ctx = { session_id_h: 'aaaa', account_address: '0xabc', chain_id: '31337' };
    const a = canonicalContextBytes(ctx);
    const b = canonicalContextBytes(ctx);
    expect(a).toEqual(b);
  });

  it('is insensitive to key insertion order', () => {
    const a = canonicalContextBytes({ b: '2', a: '1', c: '3' });
    const b = canonicalContextBytes({ a: '1', b: '2', c: '3' });
    const c = canonicalContextBytes({ c: '3', b: '2', a: '1' });
    expect(a).toEqual(b);
    expect(b).toEqual(c);
  });

  it('produces different output when any value changes', () => {
    const base = canonicalContextBytes({ a: '1', b: '2' });
    const altered = canonicalContextBytes({ a: '1', b: '3' });
    expect(base).not.toEqual(altered);
  });

  it('URI-encodes values so that = and ; are unambiguous', () => {
    const a = canonicalContextBytes({ key: 'value=with=equals' });
    const decoded = new TextDecoder().decode(a);
    // The literal '=' inside the value must be encoded as %3D so the parser
    // can't confuse it with the key=value separator.
    expect(decoded).toContain('%3D');
  });

  it('rejects non-string values at runtime', () => {
    // TypeScript would normally catch this, but runtime input could come from
    // JSON.parse where types aren't enforced.
    const bad: unknown = { key: 42 };
    expect(() => canonicalContextBytes(bad as Record<string, string>)).toThrow(/must be a string/);
  });

  it('produces stable bytes for an empty context', () => {
    const empty = canonicalContextBytes({});
    expect(empty.length).toBe(0);
  });
});
