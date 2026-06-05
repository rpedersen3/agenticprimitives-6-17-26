// JWT sessions (HS256) with key rotation.
//
// Cookie value is a JWT: base64url(header).base64url(payload).base64url(hmac).
// Multiple signing secrets are supported via SESSION_JWT_SECRETS=kid:hex,kid:hex.
// The leftmost key signs; all keys can verify (rotation).

import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { hexToBytes } from 'viem';
import type { JwtClaims } from './types';

export const SESSION_COOKIE = 'agentic-session';
export const SESSION_TTL_SECONDS = 86_400; // 24h

const JWT_HEADER = { alg: 'HS256', typ: 'JWT' };

interface SigningKey {
  kid: string;
  secret: Uint8Array;
}

function loadKeys(): SigningKey[] {
  const env = process.env.SESSION_JWT_SECRETS;
  if (!env) {
    throw new Error(
      'connect-auth: SESSION_JWT_SECRETS is required (format: kid1:hex,kid2:hex). Generate one: openssl rand -hex 32',
    );
  }
  const out: SigningKey[] = [];
  for (const piece of env.split(',')) {
    const trimmed = piece.trim();
    if (!trimmed) continue;
    const idx = trimmed.indexOf(':');
    if (idx <= 0) {
      throw new Error(`connect-auth: malformed SESSION_JWT_SECRETS entry "${trimmed}" (expected "kid:hex")`);
    }
    const kid = trimmed.slice(0, idx);
    let hex = trimmed.slice(idx + 1);
    if (!hex.startsWith('0x')) hex = '0x' + hex;
    const secret = hexToBytes(hex as `0x${string}`);
    if (secret.length < 16) {
      throw new Error(`connect-auth: SESSION_JWT_SECRETS key "${kid}" too short (need ≥ 16 bytes)`);
    }
    out.push({ kid, secret });
  }
  if (out.length === 0) {
    throw new Error('connect-auth: SESSION_JWT_SECRETS resolved to zero usable keys');
  }
  return out;
}

function base64urlEncode(bytes: Uint8Array | string): string {
  const data = typeof bytes === 'string' ? new TextEncoder().encode(bytes) : bytes;
  let s = '';
  // Manual base64 then url-safe replace
  if (typeof Buffer !== 'undefined') {
    s = Buffer.from(data).toString('base64');
  } else {
    // Browser path — not used by sessions but kept for parity
    let bin = '';
    for (const b of data) bin += String.fromCharCode(b);
    s = btoa(bin);
  }
  return s.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlDecode(s: string): Uint8Array {
  let padded = s.replace(/-/g, '+').replace(/_/g, '/');
  while (padded.length % 4) padded += '=';
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(padded, 'base64'));
  }
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

/**
 * R5.10 / PKG-CONNECT-AUTH-003 (external audit P1-1).
 *
 * Default clock-skew tolerance applied to `exp` (expiration) and `iat`
 * (issued-at) checks. 30 s matches the OIDC reference + tolerates the
 * typical cross-host NTP drift without opening a meaningful replay
 * window. Override via `verifySession(..., { clockSkewSec })` when
 * a deployment needs tighter or looser bounds.
 */
export const DEFAULT_SESSION_CLOCK_SKEW_SEC = 30;

export interface VerifySessionOpts {
  /**
   * Required for production deploys (R5.10 / P1-1). When provided,
   * `claims.iss` MUST exactly match or the cookie is rejected. Prevents
   * a sibling broker (same shape, different origin) from authenticating
   * here. The production gate below throws if this is missing when
   * `NODE_ENV=production` AND `developmentMode !== true`.
   */
  expectedIss?: string;
  /**
   * Required for production deploys (R5.10 / P1-1). When provided,
   * verifies `expectedAud` appears in `claims.aud` (which may be a
   * string or string[] per RFC 7519 §4.1.3). Stops a session minted
   * for relying app A from being replayed at relying app B even when
   * they share the broker.
   */
  expectedAud?: string;
  /** Override default clock-skew tolerance (seconds). */
  clockSkewSec?: number;
  /**
   * Opt out of the production gate (test code, dev-only flows). When
   * unset, NODE_ENV=production triggers a throw if expectedIss/Aud are
   * missing.
   */
  developmentMode?: boolean;
}

function isProduction(opts?: VerifySessionOpts): boolean {
  if (opts?.developmentMode === true) return false;
  try {
    return typeof process !== 'undefined' && process.env?.NODE_ENV === 'production';
  } catch {
    /* SES / browsers may throw on process access */
    return false;
  }
}

function randomSid(): string {
  // 128 bits is the canonical OAuth `state` / OIDC `nonce` size.
  // Worker / Node 18+ / browsers all expose `crypto.getRandomValues`.
  const bytes = new Uint8Array(16);
  try {
    crypto.getRandomValues(bytes);
  } catch {
    // Fallback for environments without WebCrypto (vanishingly rare on
    // the runtimes we support; Math.random is NOT a security boundary
    // but the sid is one of multiple defense layers, so this is
    // documentation-grade rather than load-bearing).
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  let s = '';
  for (const b of bytes) s += b.toString(16).padStart(2, '0');
  return s;
}

/**
 * Mint a JWT session cookie value from claims. Adds iat/exp + (if
 * missing) sid automatically. Signs with the leftmost key in
 * SESSION_JWT_SECRETS.
 *
 * R5.10 / PKG-CONNECT-AUTH-003 — `iss` + `aud` are required (no default).
 * Pass the canonical broker URI as `iss` and the relying app's
 * audience identifier(s) as `aud`. Without them the resulting session
 * is unverifiable in production (see {@link verifySession}).
 */
export function mintSession(
  claims: Omit<JwtClaims, 'iat' | 'exp' | 'sid'> & { sid?: string },
): string {
  const keys = loadKeys();
  const signer = keys[0]!;
  const now = Math.floor(Date.now() / 1000);
  const payload: JwtClaims = {
    ...claims,
    sid: claims.sid ?? randomSid(),
    iat: now,
    exp: now + SESSION_TTL_SECONDS,
  };
  const header = { ...JWT_HEADER, kid: signer.kid };
  const headerEnc = base64urlEncode(JSON.stringify(header));
  const payloadEnc = base64urlEncode(JSON.stringify(payload));
  const signingInput = `${headerEnc}.${payloadEnc}`;
  const sig = hmac(sha256, signer.secret, new TextEncoder().encode(signingInput));
  return `${signingInput}.${base64urlEncode(sig)}`;
}

/**
 * Verify a JWT cookie value. Returns claims if valid, else null.
 * Constant-time comparison; no info-leak on which key matched.
 *
 * R5.10 / PKG-CONNECT-AUTH-003 (external audit P1-1) — verifies:
 *   - HMAC signature against every kid in SESSION_JWT_SECRETS (rotation
 *     tolerant; constant-time)
 *   - `claims.exp + clockSkewSec >= now` (not expired)
 *   - `claims.iat - clockSkewSec <= now` (rejects future-iat tokens
 *     that could carry a wider replay window if a malicious mint server
 *     issued one)
 *   - `claims.iss === opts.expectedIss` when provided
 *   - `opts.expectedAud` ∈ `claims.aud` when provided (claims.aud may
 *     be a string or string[] per RFC 7519 §4.1.3)
 *
 * In `NODE_ENV=production` the helper THROWS if `expectedIss` /
 * `expectedAud` are missing — they're required for any meaningful
 * security boundary. Tests/dev opt out with `developmentMode: true`.
 */
export function verifySession(
  cookieValue: string,
  opts?: VerifySessionOpts,
): JwtClaims | null {
  if (isProduction(opts)) {
    if (!opts?.expectedIss) {
      throw new Error(
        '[connect-auth] verifySession requires `expectedIss` in production. ' +
          'Without it any session cookie minted by any broker passes the iss check, ' +
          'defeating the R5.10 / P1-1 closure. Pass the canonical broker URI as ' +
          'opts.expectedIss; for tests, pass `developmentMode: true`.',
      );
    }
    if (!opts?.expectedAud) {
      throw new Error(
        '[connect-auth] verifySession requires `expectedAud` in production. ' +
          'Without it a session minted for relying app A can be replayed at ' +
          'relying app B even when they share the broker. Pass the relying app ' +
          'audience id as opts.expectedAud; for tests, pass `developmentMode: true`.',
      );
    }
  }

  if (!cookieValue) return null;
  const parts = cookieValue.split('.');
  if (parts.length !== 3) return null;
  const [headerEnc, payloadEnc, sigEnc] = parts as [string, string, string];

  let header: { alg?: string; kid?: string };
  let claims: JwtClaims;
  try {
    header = JSON.parse(new TextDecoder().decode(base64urlDecode(headerEnc)));
    claims = JSON.parse(new TextDecoder().decode(base64urlDecode(payloadEnc)));
  } catch {
    return null;
  }
  if (header.alg !== 'HS256') return null;

  const presentedSig = base64urlDecode(sigEnc);
  const signingInput = `${headerEnc}.${payloadEnc}`;

  let keys: SigningKey[];
  try {
    keys = loadKeys();
  } catch {
    return null;
  }

  // Prefer the kid in the header, but try all keys for rotation tolerance.
  const ordered = header.kid ? [...keys.filter((k) => k.kid === header.kid), ...keys.filter((k) => k.kid !== header.kid)] : keys;

  let ok = false;
  for (const k of ordered) {
    const expected = hmac(sha256, k.secret, new TextEncoder().encode(signingInput));
    if (constantTimeEqual(expected, presentedSig)) {
      ok = true;
      break;
    }
  }
  if (!ok) return null;

  const now = Math.floor(Date.now() / 1000);
  const skew = opts?.clockSkewSec ?? DEFAULT_SESSION_CLOCK_SKEW_SEC;

  // Expiration check with skew (canonical RFC 7519 §4.1.4).
  if (typeof claims.exp !== 'number' || claims.exp + skew < now) return null;

  // R5.10: future-iat reject (defends against a misconfigured /
  // malicious mint server emitting tokens with iat well in the future,
  // which would otherwise outlive the TTL window).
  if (typeof claims.iat !== 'number' || claims.iat - skew > now) return null;

  // R5.10: iss binding (when expected).
  if (opts?.expectedIss !== undefined) {
    if (typeof claims.iss !== 'string' || claims.iss !== opts.expectedIss) return null;
  }

  // R5.10: aud binding (when expected). claims.aud may be a string or
  // a string[]; expectedAud must appear (RFC 7519 §4.1.3).
  if (opts?.expectedAud !== undefined) {
    const aud = claims.aud;
    if (typeof aud === 'string') {
      if (aud !== opts.expectedAud) return null;
    } else if (Array.isArray(aud)) {
      if (!aud.includes(opts.expectedAud)) return null;
    } else {
      return null;
    }
  }

  return claims;
}
