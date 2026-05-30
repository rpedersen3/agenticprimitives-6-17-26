// JWT sessions (HS256) with key rotation.
//
// Cookie value is a JWT: base64url(header).base64url(payload).base64url(hmac).
// Multiple signing secrets are supported via SESSION_JWT_SECRETS=kid:hex,kid:hex.
// The leftmost key signs; all keys can verify (rotation).

import { hmac } from '@noble/hashes/hmac';
import { sha256 } from '@noble/hashes/sha256';
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
 * Mint a JWT session cookie value from claims. Adds iat/exp automatically.
 * Signs with the leftmost key in SESSION_JWT_SECRETS.
 */
export function mintSession(claims: Omit<JwtClaims, 'iat' | 'exp'>): string {
  const keys = loadKeys();
  const signer = keys[0]!;
  const now = Math.floor(Date.now() / 1000);
  const payload: JwtClaims = { ...claims, iat: now, exp: now + SESSION_TTL_SECONDS };
  const header = { ...JWT_HEADER, kid: signer.kid };
  const headerEnc = base64urlEncode(JSON.stringify(header));
  const payloadEnc = base64urlEncode(JSON.stringify(payload));
  const signingInput = `${headerEnc}.${payloadEnc}`;
  const sig = hmac(sha256, signer.secret, new TextEncoder().encode(signingInput));
  return `${signingInput}.${base64urlEncode(sig)}`;
}

/**
 * Verify a JWT cookie value. Returns claims if valid + not expired, else null.
 * Tries every kid in SESSION_JWT_SECRETS — rotation-safe.
 * Constant-time comparison; no info-leak on which key matched.
 */
export function verifySession(cookieValue: string): JwtClaims | null {
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
  if (typeof claims.exp !== 'number' || claims.exp < now) return null;

  return claims;
}
