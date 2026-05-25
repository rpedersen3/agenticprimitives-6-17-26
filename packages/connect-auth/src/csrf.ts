// CSRF tokens: HMAC-stamped origin + timestamp.
// Token format: base64url(JSON.stringify({origin, ts})).base64url(hmac).
// verifyCsrf checks: origin ∈ allowlist (exact match), ts ∈ recent window,
// HMAC valid. Constant-time compare.

import { hmac } from '@noble/hashes/hmac';
import { sha256 } from '@noble/hashes/sha256';
import { hexToBytes } from 'viem';

const CSRF_VALIDITY_SECONDS = 60 * 60; // 1 hour

function loadCsrfSecret(): Uint8Array {
  const hex = process.env.CSRF_SECRET;
  if (!hex) {
    throw new Error('identity-auth: CSRF_SECRET (hex) is required. Generate one: openssl rand -hex 32');
  }
  const bytes = hexToBytes(hex.startsWith('0x') ? (hex as `0x${string}`) : (`0x${hex}` as `0x${string}`));
  if (bytes.length < 16) {
    throw new Error(`identity-auth: CSRF_SECRET too short (need ≥ 16 bytes)`);
  }
  return bytes;
}

function base64urlEncode(s: string | Uint8Array): string {
  const data = typeof s === 'string' ? new TextEncoder().encode(s) : s;
  const b64 = Buffer.from(data).toString('base64');
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlDecode(s: string): Uint8Array {
  let padded = s.replace(/-/g, '+').replace(/_/g, '/');
  while (padded.length % 4) padded += '=';
  return new Uint8Array(Buffer.from(padded, 'base64'));
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

/**
 * Produce a CSRF token bound to the given origin and the current timestamp.
 */
export function csrfTokenFor(origin: string): string {
  const secret = loadCsrfSecret();
  const ts = Math.floor(Date.now() / 1000);
  const stamp = JSON.stringify({ origin, ts });
  const stampEnc = base64urlEncode(stamp);
  const sig = hmac(sha256, secret, new TextEncoder().encode(stampEnc));
  return `${stampEnc}.${base64urlEncode(sig)}`;
}

/**
 * Verify a CSRF token.
 *   - origin (parsed exactly from the token) MUST be in allowedOrigins (exact-match).
 *   - HMAC must match.
 *   - Timestamp must be within the last CSRF_VALIDITY_SECONDS window.
 * Returns true iff all three hold.
 */
export function verifyCsrf(token: string, allowedOrigins: string[]): boolean {
  if (!token) return false;
  const parts = token.split('.');
  if (parts.length !== 2) return false;
  const [stampEnc, sigEnc] = parts as [string, string];

  let stamp: { origin?: string; ts?: number };
  try {
    stamp = JSON.parse(new TextDecoder().decode(base64urlDecode(stampEnc)));
  } catch {
    return false;
  }
  if (typeof stamp.origin !== 'string' || typeof stamp.ts !== 'number') return false;

  // Exact-match parsed URL allowlist (per spec §6) — origins are compared verbatim,
  // never substring.
  if (!allowedOrigins.includes(stamp.origin)) return false;

  const now = Math.floor(Date.now() / 1000);
  if (now - stamp.ts > CSRF_VALIDITY_SECONDS || now < stamp.ts) return false;

  const secret = loadCsrfSecret();
  const expected = hmac(sha256, secret, new TextEncoder().encode(stampEnc));
  const presented = base64urlDecode(sigEnc);
  return constantTimeEqual(expected, presented);
}
