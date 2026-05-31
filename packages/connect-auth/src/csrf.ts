// CSRF tokens: HMAC-stamped origin (+ optional method / path / session) +
// timestamp.
//
// R5.11 / PKG-CONNECT-AUTH-004 (external audit P1-2):
//
//   Pre-R5.11 the verifier only checked the token's SIGNED origin
//   against an allowlist. It never compared to the request's ACTUAL
//   origin — so a token legitimately minted for `https://app.com`
//   (signed, in allowlist) would pass even when the request itself
//   came from `https://evil.com`. The double-submit cookie pattern
//   helps but doesn't bind the verifier to the request origin.
//
//   Post-R5.11 `verifyCsrf` takes an explicit `actualOrigin` opt and
//   rejects unless `stamp.origin === actualOrigin AND actualOrigin
//   ∈ allowedOrigins`. The actual request origin is the load-bearing
//   check; the allowlist is defense in depth.
//
//   Additionally, the audit row PKG-CONNECT-AUTH-004 also flagged
//   that a token usable on `POST /transfer` is also usable on
//   `POST /grant-admin` — no method/path/session binding. R5.11 adds
//   optional `method` / `path` / `sessionSid` bindings: both mint
//   and verify must agree on them, and when supplied they're stamped
//   into the HMAC. Empty matches empty so legacy "origin only"
//   callers keep working at the wire level.
//
// Token format (unchanged shape; new fields nullable):
//   base64url(JSON.stringify({origin, ts, method?, path?, sessionSid?}))
//     . base64url(hmac)

import { hmac } from '@noble/hashes/hmac';
import { sha256 } from '@noble/hashes/sha256';
import { hexToBytes } from 'viem';

const CSRF_VALIDITY_SECONDS = 60 * 60; // 1 hour

function loadCsrfSecret(): Uint8Array {
  const hex = process.env.CSRF_SECRET;
  if (!hex) {
    throw new Error('connect-auth: CSRF_SECRET (hex) is required. Generate one: openssl rand -hex 32');
  }
  const bytes = hexToBytes(hex.startsWith('0x') ? (hex as `0x${string}`) : (`0x${hex}` as `0x${string}`));
  if (bytes.length < 16) {
    throw new Error(`connect-auth: CSRF_SECRET too short (need ≥ 16 bytes)`);
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

function isProduction(opts?: { developmentMode?: boolean }): boolean {
  if (opts?.developmentMode === true) return false;
  try {
    return typeof process !== 'undefined' && process.env?.NODE_ENV === 'production';
  } catch {
    return false;
  }
}

/**
 * R5.11 — Optional bindings stamped into the CSRF token.
 *
 *   `method`     HTTP method (POST, PUT, ...) the token is bound to.
 *   `path`       Request path the token is bound to. Use the URL pathname
 *                (not the full URL); query string is excluded.
 *   `sessionSid` Session id (typically `JwtClaims.sid` from the session
 *                cookie) so a CSRF token is unusable with a different
 *                session — defends against an attacker stealing the
 *                CSRF token alone.
 *
 * Empty/undefined bindings on both sides match (legacy callers see no
 * behavior change at the wire format level). When mint supplies a
 * binding, verify MUST supply the same value or the token is rejected.
 */
export interface CsrfBindings {
  method?: string;
  path?: string;
  sessionSid?: string;
}

export interface CsrfMintOpts extends CsrfBindings {
  origin: string;
}

export interface CsrfVerifyOpts extends CsrfBindings {
  /**
   * The ACTUAL request origin (from the inbound `Origin` header or the
   * verified `Referer`). The verifier rejects unless
   * `stamp.origin === actualOrigin AND actualOrigin ∈ allowedOrigins`.
   * Pass an empty string only when the caller has explicitly chosen
   * not to bind to the request origin (e.g. a server-to-server
   * verifier in a test); in production that path THROWS unless
   * `developmentMode: true` is set.
   */
  actualOrigin: string;
  /** Exact-match allowlist of acceptable origins (defense in depth). */
  allowedOrigins: string[];
  /** Opt-out for tests / dev paths that intentionally lack an origin. */
  developmentMode?: boolean;
}

interface Stamp {
  origin: string;
  ts: number;
  method?: string;
  path?: string;
  sessionSid?: string;
}

/**
 * Mint a CSRF token bound to the supplied origin (and optionally to a
 * method / path / session id). The HMAC covers all stamped fields, so
 * any field tampering invalidates the token.
 *
 * R5.11 breaking change: the function signature now takes an opts
 * object instead of a single `origin` positional arg. Pass
 * `{ origin }` for the legacy origin-only behavior.
 */
export function csrfTokenFor(opts: CsrfMintOpts): string {
  const secret = loadCsrfSecret();
  const ts = Math.floor(Date.now() / 1000);
  const stamp: Stamp = { origin: opts.origin, ts };
  // Only include binding fields when supplied — keeps the wire format
  // tight for legacy callers + makes intent visible in audit logs.
  if (opts.method !== undefined) stamp.method = opts.method;
  if (opts.path !== undefined) stamp.path = opts.path;
  if (opts.sessionSid !== undefined) stamp.sessionSid = opts.sessionSid;

  const stampEnc = base64urlEncode(JSON.stringify(stamp));
  const sig = hmac(sha256, secret, new TextEncoder().encode(stampEnc));
  return `${stampEnc}.${base64urlEncode(sig)}`;
}

/**
 * Verify a CSRF token. R5.11 breaking change: signature is now
 * `verifyCsrf(token, opts: CsrfVerifyOpts)`.
 *
 *   1. HMAC must verify under `CSRF_SECRET`.
 *   2. `stamp.ts` must be within the last `CSRF_VALIDITY_SECONDS` window
 *      (with a small skew for future-ts).
 *   3. `stamp.origin === opts.actualOrigin` (R5.11 / P1-2).
 *   4. `opts.actualOrigin ∈ opts.allowedOrigins` (defense in depth).
 *   5. When the mint side stamped a binding, the verify side MUST
 *      supply the same value:
 *        - `stamp.method === opts.method`
 *        - `stamp.path === opts.path`
 *        - `stamp.sessionSid === opts.sessionSid`
 *      Empty / undefined matches empty / undefined. A token minted
 *      WITHOUT bindings cannot be verified WITH bindings (and vice
 *      versa) — the comparison is exact.
 *
 * Returns true iff all checks pass.
 *
 * **Production guard:** when `NODE_ENV=production` AND
 * `developmentMode !== true`, the function THROWS if `actualOrigin`
 * is an empty string. A silently-permissive `''` would re-open the
 * audit finding; failing fast keeps production deploys honest. Tests
 * / dev opt out via `developmentMode: true`.
 */
export function verifyCsrf(token: string, opts: CsrfVerifyOpts): boolean {
  if (isProduction(opts)) {
    if (!opts.actualOrigin || opts.actualOrigin.length === 0) {
      throw new Error(
        '[connect-auth] verifyCsrf requires a non-empty `actualOrigin` in production. ' +
          'Without it the request-origin binding is bypassed, re-opening the R5.11 / P1-2 ' +
          'finding. Pass the inbound `Origin` header (or parsed `Referer`) as ' +
          'opts.actualOrigin; for tests, pass `developmentMode: true`.',
      );
    }
  }

  if (!token) return false;
  const parts = token.split('.');
  if (parts.length !== 2) return false;
  const [stampEnc, sigEnc] = parts as [string, string];

  let stamp: Partial<Stamp>;
  try {
    stamp = JSON.parse(new TextDecoder().decode(base64urlDecode(stampEnc)));
  } catch {
    return false;
  }
  if (typeof stamp.origin !== 'string' || typeof stamp.ts !== 'number') return false;

  // R5.11 / P1-2: bind the verifier to the ACTUAL request origin.
  // The verifier MUST be told the actual origin (we don't reach into
  // an HTTP request here — that's the caller's concern). If actualOrigin
  // is empty / missing, the check rejects (production gate above throws).
  if (!opts.actualOrigin || stamp.origin !== opts.actualOrigin) return false;

  // Defense in depth: even when actualOrigin matches, it must be in
  // the operator-curated allowlist. Catches a misconfigured caller
  // that wires the wrong header into `actualOrigin`.
  if (!opts.allowedOrigins.includes(opts.actualOrigin)) return false;

  // R5.11: method / path / sessionSid bindings. Empty matches empty.
  // The stamp has the value iff mint supplied it; the same applies to
  // opts. A mismatched declaration on either side rejects.
  if ((stamp.method ?? undefined) !== (opts.method ?? undefined)) return false;
  if ((stamp.path ?? undefined) !== (opts.path ?? undefined)) return false;
  if ((stamp.sessionSid ?? undefined) !== (opts.sessionSid ?? undefined)) return false;

  const now = Math.floor(Date.now() / 1000);
  if (now - stamp.ts > CSRF_VALIDITY_SECONDS || now < stamp.ts) return false;

  const secret = loadCsrfSecret();
  const expected = hmac(sha256, secret, new TextEncoder().encode(stampEnc));
  const presented = base64urlDecode(sigEnc);
  return constantTimeEqual(expected, presented);
}
