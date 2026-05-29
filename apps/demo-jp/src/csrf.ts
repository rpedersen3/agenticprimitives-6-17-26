// CSRF helper (ported from demo-web) — pairs with demo-a2a's /auth/csrf.
// Double-submit: a non-HttpOnly cookie JS can read, echoed in X-CSRF-Token.
const CSRF_COOKIE = 'agentic-csrf';
let cached: string | null = null;

function readCookie(name: string): string | null {
  for (const p of document.cookie.split(';')) {
    const [k, ...rest] = p.trim().split('=');
    if (k === name) return rest.join('=');
  }
  return null;
}

export async function ensureCsrfToken(): Promise<string> {
  if (cached) return cached;
  const fromCookie = readCookie(CSRF_COOKIE);
  if (fromCookie) {
    cached = decodeURIComponent(fromCookie);
    return cached;
  }
  const res = await fetch('/a2a/auth/csrf', { method: 'GET', credentials: 'include' });
  if (!res.ok) throw new Error(`csrf token fetch failed: HTTP ${res.status}`);
  // Guard the parse: if /a2a/auth/csrf returns HTML (proxy/route misconfigured) rather than
  // JSON, surface a clear message instead of a cryptic "Unexpected token '<'".
  const data = (await res.json().catch(() => null)) as { token?: string } | null;
  if (!data?.token) {
    throw new Error('Security token unavailable — the /a2a/auth/csrf endpoint did not return JSON (check the demo-a2a proxy/route).');
  }
  cached = data.token;
  return cached;
}

export function csrfHeaders(): Record<string, string> {
  const token = cached ?? readCookie(CSRF_COOKIE);
  if (!token) throw new Error('csrfHeaders: call ensureCsrfToken() first.');
  return { 'X-CSRF-Token': decodeURIComponent(token) };
}
