// CSRF helper for demo-web.
//
// Pairs with the demo-a2a /auth/csrf endpoint (audit finding H1). On
// page load, App.tsx calls `ensureCsrfToken()` which fetches the token
// + sets the cookie. Every mutating fetch through this app then calls
// `csrfHeaders()` to include the `X-CSRF-Token` header.
//
// The token + cookie use the double-submit pattern: the cookie is
// non-HttpOnly so JS can read it; the server verifies header == cookie
// AND that the HMAC binds to the request origin. CSRF-only attacks
// can't forge both because they can't read the cookie cross-origin.

const CSRF_COOKIE = 'agentic-csrf';

let cached: string | null = null;

function readCookie(name: string): string | null {
  // Cookie format: "name1=value1; name2=value2; ..."
  const pairs = document.cookie.split(';');
  for (const p of pairs) {
    const [k, ...rest] = p.trim().split('=');
    if (k === name) return rest.join('=');
  }
  return null;
}

/**
 * Fetch + cache the CSRF token. Idempotent: subsequent calls reuse the
 * existing cookie if present.
 */
export async function ensureCsrfToken(): Promise<string> {
  if (cached) return cached;
  const fromCookie = readCookie(CSRF_COOKIE);
  if (fromCookie) {
    cached = decodeURIComponent(fromCookie);
    return cached;
  }
  const res = await fetch('/a2a/auth/csrf', {
    method: 'GET',
    credentials: 'include',
  });
  if (!res.ok) throw new Error(`csrf token fetch failed: HTTP ${res.status}`);
  const body = (await res.json()) as { ok: true; token: string };
  cached = body.token;
  return cached;
}

/**
 * Returns headers to attach to every mutating fetch. The token comes
 * from the cookie (set by /auth/csrf) so the server sees the same
 * value via cookie AND header (double-submit).
 *
 * Throws if `ensureCsrfToken()` hasn't been called yet.
 */
export function csrfHeaders(): Record<string, string> {
  const token = cached ?? readCookie(CSRF_COOKIE);
  if (!token) {
    throw new Error('csrfHeaders: no token cached. Call ensureCsrfToken() on app mount.');
  }
  return { 'X-CSRF-Token': decodeURIComponent(token) };
}

/** Reset cached token (for tests / reset-state). */
export function clearCsrfToken(): void {
  cached = null;
}
