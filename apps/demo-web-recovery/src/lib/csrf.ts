/**
 * CSRF helper for demo-web-pro.
 *
 * demo-web-pro is served from a different origin than demo-a2a (it\'s
 * a Cloudflare Pages site that calls a separate Worker), so the CSRF
 * dance is cross-origin:
 *
 *   1. `ensureCsrfToken()` fetches `/auth/csrf` on demo-a2a with
 *      credentials: 'include'. demo-a2a sets a cookie with
 *      SameSite=None; Secure (cross-site-safe) and returns the same
 *      token in the JSON body.
 *
 *   2. We cache the token from the body — we can\'t read the cookie
 *      via document.cookie because it\'s on a different origin.
 *
 *   3. For every mutating fetch, callers pass `credentials: 'include'`
 *      (so the cookie roundtrips) AND attach `csrfHeaders()`. The
 *      worker then checks `header === cookie` (double-submit) + an
 *      HMAC over the embedded origin.
 *
 * Token TTL is 1 hour; on expiry refetch by calling `clearCsrfToken()`
 * then `ensureCsrfToken()` again.
 */

import { config } from '../config';

let cached: string | null = null;
let inflight: Promise<string> | null = null;

export class CsrfError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CsrfError';
  }
}

function a2aBase(): string {
  const base = config.demoA2aUrl;
  if (!base) {
    throw new CsrfError(
      'VITE_DEMO_A2A_URL is not set in this build; the CSRF dance needs demo-a2a.',
    );
  }
  return base.replace(/\/$/, '');
}

/**
 * Fetch + cache the CSRF token. Idempotent; concurrent callers share
 * the same in-flight request.
 */
export async function ensureCsrfToken(): Promise<string> {
  if (cached) return cached;
  if (inflight) return inflight;
  inflight = (async () => {
    const res = await fetch(`${a2aBase()}/auth/csrf`, {
      method: 'GET',
      credentials: 'include',
    });
    if (!res.ok) {
      inflight = null;
      throw new CsrfError(`csrf token fetch failed: HTTP ${res.status}`);
    }
    const body = (await res.json()) as { ok: true; token: string };
    cached = body.token;
    inflight = null;
    return cached;
  })();
  return inflight;
}

/**
 * Returns headers to attach to every mutating fetch. Throws if
 * `ensureCsrfToken()` hasn\'t been awaited yet.
 */
export function csrfHeaders(): Record<string, string> {
  if (!cached) {
    throw new CsrfError(
      'csrfHeaders: no token cached. Await ensureCsrfToken() before mutating fetch.',
    );
  }
  return { 'X-CSRF-Token': cached };
}

/** Reset cached token (for tests / refresh after expiry). */
export function clearCsrfToken(): void {
  cached = null;
  inflight = null;
}
