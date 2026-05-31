// H7-F.5 / PKG-KEY-CUSTODY-005 closure — Secret<T> opaque brand.
//
// Locks the invariant that sensitive config values wrapped via
// `loadSecret` cannot be exfiltrated via JSON.stringify, console.log,
// util.inspect, Object.keys, or array iteration. The only path to the
// underlying string is `unwrapSecret`.

import { describe, it, expect, vi } from 'vitest';
import { loadSecret, loadSecretFromEnv, unwrapSecret, isSecret } from '../../src/types';
import util from 'node:util';

describe('H7-F.5 — Secret<T> opaque brand', () => {
  it('isSecret distinguishes wrapped vs plain values', () => {
    expect(isSecret(loadSecret('hunter2'))).toBe(true);
    expect(isSecret('hunter2')).toBe(false);
    expect(isSecret({})).toBe(false);
    expect(isSecret(null)).toBe(false);
  });

  it('unwrapSecret returns the original value', () => {
    const s = loadSecret('hunter2');
    expect(unwrapSecret(s)).toBe('hunter2');
  });

  it('JSON.stringify of a Secret never reveals the value', () => {
    const s = loadSecret('hunter2');
    const serialized = JSON.stringify(s);
    expect(serialized).not.toContain('hunter2');
    expect(serialized).toContain('redacted');
  });

  it('JSON.stringify of an object containing a Secret never reveals the value', () => {
    const cfg = { name: 'demo', master: loadSecret('top-secret-master') };
    const serialized = JSON.stringify(cfg);
    expect(serialized).not.toContain('top-secret-master');
    expect(serialized).toContain('redacted');
  });

  it('String(...) and `+` concat never reveal the value', () => {
    const s = loadSecret('hunter2');
    expect(String(s)).not.toContain('hunter2');
    expect(`${s}`).not.toContain('hunter2');
    expect(s + '').not.toContain('hunter2');
  });

  it('util.inspect (which console.log uses) never reveals the value', () => {
    const s = loadSecret('hunter2');
    const inspected = util.inspect(s);
    expect(inspected).not.toContain('hunter2');
  });

  it('Object.keys does not list the underlying value field', () => {
    const s = loadSecret('hunter2');
    const keys = Object.keys(s);
    expect(keys).not.toContain('__value');
  });

  it('Object spread does NOT copy the underlying value through enumerable keys', () => {
    const s = loadSecret('hunter2');
    const spread = { ...s };
    // The brand symbol is non-string-keyed; spread copies enumerable
    // string keys only. The __value field is non-enumerable; it MUST NOT
    // appear in the spread copy.
    expect(JSON.stringify(spread)).not.toContain('hunter2');
  });

  it('loadSecretFromEnv loads from process.env', () => {
    vi.stubEnv('AP_TEST_SECRET', 'env-secret-value');
    const s = loadSecretFromEnv('AP_TEST_SECRET');
    expect(unwrapSecret(s)).toBe('env-secret-value');
    vi.unstubAllEnvs();
  });

  it('loadSecretFromEnv throws when env var is missing', () => {
    vi.stubEnv('AP_MISSING_SECRET', '');
    expect(() => loadSecretFromEnv('AP_MISSING_SECRET')).toThrow(/missing or empty/);
    vi.unstubAllEnvs();
  });
});
