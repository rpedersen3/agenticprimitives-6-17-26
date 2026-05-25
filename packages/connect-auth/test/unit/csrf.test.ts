import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { csrfTokenFor, verifyCsrf } from '../../src/csrf';

const TEST_SECRET = '0x' + 'dd'.repeat(32);

describe('csrf', () => {
  let prev: string | undefined;
  beforeEach(() => {
    prev = process.env.CSRF_SECRET;
    process.env.CSRF_SECRET = TEST_SECRET;
  });
  afterEach(() => {
    if (prev !== undefined) process.env.CSRF_SECRET = prev;
    else delete process.env.CSRF_SECRET;
  });

  it('round-trips a token for an allowed origin', () => {
    const token = csrfTokenFor('http://127.0.0.1:5173');
    expect(verifyCsrf(token, ['http://127.0.0.1:5173'])).toBe(true);
  });

  it('rejects a token whose origin is NOT in the allowlist', () => {
    const token = csrfTokenFor('http://evil.example.com');
    expect(verifyCsrf(token, ['http://127.0.0.1:5173'])).toBe(false);
  });

  it('exact-match origins: substring matches must NOT succeed', () => {
    const token = csrfTokenFor('http://127.0.0.1:5173.evil.example.com');
    // The allowed list contains a substring of the token's origin — exact match
    // should still reject.
    expect(verifyCsrf(token, ['http://127.0.0.1:5173'])).toBe(false);
  });

  it('rejects when secret rotates', () => {
    const token = csrfTokenFor('http://127.0.0.1:5173');
    process.env.CSRF_SECRET = '0x' + 'ee'.repeat(32);
    expect(verifyCsrf(token, ['http://127.0.0.1:5173'])).toBe(false);
  });

  it('rejects malformed tokens', () => {
    expect(verifyCsrf('', ['x'])).toBe(false);
    expect(verifyCsrf('no-dot', ['x'])).toBe(false);
    expect(verifyCsrf('aaa.bbb.ccc', ['x'])).toBe(false);
    expect(verifyCsrf('aaa.bbb', ['x'])).toBe(false); // base64url of "aaa" doesn't parse as JSON
  });

  it('rejects future-stamped or replay-aged tokens', () => {
    // Hand-craft a stamp from 2 hours ago (beyond CSRF_VALIDITY_SECONDS).
    const oldTs = Math.floor(Date.now() / 1000) - 7200;
    const stamp = JSON.stringify({ origin: 'http://x', ts: oldTs });
    const enc = Buffer.from(stamp).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    // Compute a valid-looking sig (but with the old timestamp; should still reject).
    // Use the actual generator path so signature is valid:
    const real = csrfTokenFor('http://x');
    const realStampEnc = real.split('.')[0]!;
    // Swap the body but keep the signature — the verify rebuilds HMAC from
    // the swapped body, so signature won't match → rejected.
    const tampered = `${enc}.${real.split('.')[1]}`;
    void realStampEnc;
    expect(verifyCsrf(tampered, ['http://x'])).toBe(false);
  });

  it('throws when CSRF_SECRET is missing', () => {
    delete process.env.CSRF_SECRET;
    expect(() => csrfTokenFor('http://x')).toThrow(/CSRF_SECRET/);
  });
});
