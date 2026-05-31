import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { csrfTokenFor, verifyCsrf } from '../../src/csrf';

const TEST_SECRET = '0x' + 'dd'.repeat(32);
const O = 'http://127.0.0.1:5173';

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

  it('round-trips a token for the actual request origin', () => {
    const token = csrfTokenFor({ origin: O });
    expect(verifyCsrf(token, { actualOrigin: O, allowedOrigins: [O] })).toBe(true);
  });

  it('rejects a token whose origin is NOT in the allowlist', () => {
    const token = csrfTokenFor({ origin: 'http://evil.example.com' });
    expect(
      verifyCsrf(token, { actualOrigin: 'http://evil.example.com', allowedOrigins: [O] }),
    ).toBe(false);
  });

  it('exact-match origins: substring matches must NOT succeed', () => {
    const sub = 'http://127.0.0.1:5173.evil.example.com';
    const token = csrfTokenFor({ origin: sub });
    expect(verifyCsrf(token, { actualOrigin: sub, allowedOrigins: [O] })).toBe(false);
  });

  it('rejects when secret rotates', () => {
    const token = csrfTokenFor({ origin: O });
    process.env.CSRF_SECRET = '0x' + 'ee'.repeat(32);
    expect(verifyCsrf(token, { actualOrigin: O, allowedOrigins: [O] })).toBe(false);
  });

  it('rejects malformed tokens', () => {
    expect(verifyCsrf('', { actualOrigin: 'x', allowedOrigins: ['x'] })).toBe(false);
    expect(verifyCsrf('no-dot', { actualOrigin: 'x', allowedOrigins: ['x'] })).toBe(false);
    expect(verifyCsrf('aaa.bbb.ccc', { actualOrigin: 'x', allowedOrigins: ['x'] })).toBe(false);
    expect(verifyCsrf('aaa.bbb', { actualOrigin: 'x', allowedOrigins: ['x'] })).toBe(false);
  });

  it('rejects future-stamped or replay-aged tokens', () => {
    const oldTs = Math.floor(Date.now() / 1000) - 7200;
    const stamp = JSON.stringify({ origin: 'http://x', ts: oldTs });
    const enc = Buffer.from(stamp).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const real = csrfTokenFor({ origin: 'http://x' });
    const tampered = `${enc}.${real.split('.')[1]}`;
    expect(verifyCsrf(tampered, { actualOrigin: 'http://x', allowedOrigins: ['http://x'] })).toBe(false);
  });

  it('throws when CSRF_SECRET is missing', () => {
    delete process.env.CSRF_SECRET;
    expect(() => csrfTokenFor({ origin: 'http://x' })).toThrow(/CSRF_SECRET/);
  });
});

// ─── R5.11 / PKG-CONNECT-AUTH-004 — actualOrigin + bindings (external P1-2) ─

describe('R5.11 / PKG-CONNECT-AUTH-004 — actualOrigin binding (external P1-2)', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  let prevSecret: string | undefined;
  beforeEach(() => {
    prevSecret = process.env.CSRF_SECRET;
    process.env.CSRF_SECRET = TEST_SECRET;
  });
  afterEach(() => {
    if (prevSecret !== undefined) process.env.CSRF_SECRET = prevSecret;
    else delete process.env.CSRF_SECRET;
    process.env.NODE_ENV = originalNodeEnv;
  });

  // ─── actualOrigin must match the token's signed origin ───────────

  it('REJECTS when actualOrigin differs from token-signed origin (cross-origin replay)', () => {
    // Attacker minted a legitimate token for app.com, but presents it
    // from evil.com (actualOrigin = evil.com). Allowlist includes both.
    const token = csrfTokenFor({ origin: 'https://app.com' });
    expect(
      verifyCsrf(token, {
        actualOrigin: 'https://evil.com',
        allowedOrigins: ['https://app.com', 'https://evil.com'],
      }),
    ).toBe(false);
  });

  it('REJECTS when actualOrigin is empty + non-production', () => {
    delete process.env.NODE_ENV;
    const token = csrfTokenFor({ origin: O });
    expect(verifyCsrf(token, { actualOrigin: '', allowedOrigins: [O] })).toBe(false);
  });

  it('REJECTS when actualOrigin matches token but is NOT in allowedOrigins', () => {
    const token = csrfTokenFor({ origin: 'https://orphan.com' });
    expect(
      verifyCsrf(token, {
        actualOrigin: 'https://orphan.com',
        allowedOrigins: ['https://known.com'],
      }),
    ).toBe(false);
  });

  // ─── method binding ──────────────────────────────────────────────

  it('round-trips a method-bound token', () => {
    const token = csrfTokenFor({ origin: O, method: 'POST' });
    expect(
      verifyCsrf(token, { actualOrigin: O, allowedOrigins: [O], method: 'POST' }),
    ).toBe(true);
  });

  it('REJECTS a token used with a different method', () => {
    const token = csrfTokenFor({ origin: O, method: 'POST' });
    expect(
      verifyCsrf(token, { actualOrigin: O, allowedOrigins: [O], method: 'PUT' }),
    ).toBe(false);
  });

  it('REJECTS a method-bound token when verify omits the method', () => {
    const token = csrfTokenFor({ origin: O, method: 'POST' });
    expect(verifyCsrf(token, { actualOrigin: O, allowedOrigins: [O] })).toBe(false);
  });

  it('REJECTS an unbound token when verify supplies a method', () => {
    const token = csrfTokenFor({ origin: O });
    expect(
      verifyCsrf(token, { actualOrigin: O, allowedOrigins: [O], method: 'POST' }),
    ).toBe(false);
  });

  // ─── path binding ────────────────────────────────────────────────

  it('REJECTS a path-bound token used on a different path (the P1-2 sub-finding)', () => {
    // A token for POST /transfer must not be usable on POST /grant-admin.
    const token = csrfTokenFor({ origin: O, method: 'POST', path: '/transfer' });
    expect(
      verifyCsrf(token, {
        actualOrigin: O,
        allowedOrigins: [O],
        method: 'POST',
        path: '/grant-admin',
      }),
    ).toBe(false);
  });

  it('round-trips a path-bound token on the SAME path', () => {
    const token = csrfTokenFor({ origin: O, method: 'POST', path: '/transfer' });
    expect(
      verifyCsrf(token, {
        actualOrigin: O,
        allowedOrigins: [O],
        method: 'POST',
        path: '/transfer',
      }),
    ).toBe(true);
  });

  // ─── sessionSid binding ──────────────────────────────────────────

  it('REJECTS a session-bound token used with a different session', () => {
    const token = csrfTokenFor({ origin: O, sessionSid: 'sess-aaa' });
    expect(
      verifyCsrf(token, { actualOrigin: O, allowedOrigins: [O], sessionSid: 'sess-bbb' }),
    ).toBe(false);
  });

  it('round-trips a session-bound token with the matching sessionSid', () => {
    const token = csrfTokenFor({ origin: O, sessionSid: 'sess-aaa' });
    expect(
      verifyCsrf(token, { actualOrigin: O, allowedOrigins: [O], sessionSid: 'sess-aaa' }),
    ).toBe(true);
  });

  it('combines all four bindings (origin + method + path + sessionSid)', () => {
    const token = csrfTokenFor({
      origin: O,
      method: 'POST',
      path: '/transfer',
      sessionSid: 'sess-aaa',
    });
    expect(
      verifyCsrf(token, {
        actualOrigin: O,
        allowedOrigins: [O],
        method: 'POST',
        path: '/transfer',
        sessionSid: 'sess-aaa',
      }),
    ).toBe(true);
    // Flip one binding — must reject.
    expect(
      verifyCsrf(token, {
        actualOrigin: O,
        allowedOrigins: [O],
        method: 'POST',
        path: '/transfer',
        sessionSid: 'sess-bbb',
      }),
    ).toBe(false);
  });

  // ─── Production gate ─────────────────────────────────────────────

  it('production gate: throws when actualOrigin is empty', () => {
    process.env.NODE_ENV = 'production';
    const token = csrfTokenFor({ origin: O });
    expect(() => verifyCsrf(token, { actualOrigin: '', allowedOrigins: [O] })).toThrow(
      /requires a non-empty `actualOrigin` in production/,
    );
  });

  it('production gate: developmentMode: true bypasses the gate', () => {
    process.env.NODE_ENV = 'production';
    const token = csrfTokenFor({ origin: O });
    expect(() =>
      verifyCsrf(token, { actualOrigin: '', allowedOrigins: [O], developmentMode: true }),
    ).not.toThrow();
  });

  it('production gate: NOT triggered when NODE_ENV is undefined', () => {
    delete process.env.NODE_ENV;
    const token = csrfTokenFor({ origin: O });
    // Returns false (empty actualOrigin fails the binding check) but
    // doesn't throw — that's the non-production behavior.
    expect(() => verifyCsrf(token, { actualOrigin: '', allowedOrigins: [O] })).not.toThrow();
  });

  // ─── HMAC tampering ──────────────────────────────────────────────

  it('REJECTS a token whose stamp is tampered after minting (HMAC mismatch)', () => {
    const token = csrfTokenFor({ origin: O, method: 'POST', path: '/transfer' });
    // Decode + re-encode the stamp with a different path; keep the
    // original sig. HMAC over the modified stamp won't match.
    const [stampEnc, sigEnc] = token.split('.') as [string, string];
    const stamp = JSON.parse(Buffer.from(stampEnc.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());
    stamp.path = '/grant-admin';
    const tampered =
      Buffer.from(JSON.stringify(stamp))
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '') +
      '.' +
      sigEnc;
    expect(
      verifyCsrf(tampered, {
        actualOrigin: O,
        allowedOrigins: [O],
        method: 'POST',
        path: '/grant-admin',
      }),
    ).toBe(false);
  });
});
