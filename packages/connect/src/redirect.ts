// Redirect & response delivery (spec 224 §4a; CN-1 / CN-9).
//
// The AgentSession is NOT delivered as a bearer token in a redirect URL.
// Instead: the broker mints the token, stores it under a single-use, short-TTL
// authorization CODE, and redirects with the code; the relying site exchanges
// the code server-side at the broker token endpoint for the token. This keeps
// the token out of URLs/history/Referer and gives the broker (which holds the
// atomic store) the single-use replay guarantee — relying sites need no store.

/**
 * Validate a requested `redirect_uri` against a per-client allowlist (CN-1).
 * EXACT match only — never substring/prefix (open-redirect defense). The
 * allowlist is registered out-of-band per `client_id`, never user-supplied.
 */
export function validateRedirectUri(registered: readonly string[], requested: string): boolean {
  return registered.includes(requested);
}

export interface AuthCodeValue {
  /** The minted AgentSession token. */
  token: string;
  /** The relying-site client_id this code (and token) is bound to. */
  aud: string;
}

export interface AuthCodeStore {
  /** Store a code → value with a TTL (ms). */
  put(code: string, value: AuthCodeValue, ttlMs: number): void;
  /** Single-use take: returns the value once (removing it) if present + unexpired, else null. */
  take(code: string): AuthCodeValue | null;
}

/** Generate a single-use authorization code. */
export function newAuthCode(byteLen = 32): string {
  const b = new Uint8Array(byteLen);
  globalThis.crypto.getRandomValues(b);
  let s = typeof Buffer !== 'undefined' ? Buffer.from(b).toString('base64') : btoa(String.fromCharCode(...b));
  return s.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * In-memory single-use auth-code store (demo/tests; CN-9). `take` is atomic
 * (deletes on read) so a code can be exchanged at most once. Production uses a
 * shared store (e.g. KV/D1) with the same single-use contract.
 */
export function createInMemoryAuthCodeStore(now: () => number = () => Date.now()): AuthCodeStore {
  const store = new Map<string, { value: AuthCodeValue; expiresAt: number }>();
  return {
    put(code, value, ttlMs) {
      store.set(code, { value, expiresAt: now() + ttlMs });
    },
    take(code) {
      const rec = store.get(code);
      if (!rec) return null;
      store.delete(code); // single-use: gone after one read, even if expired
      if (rec.expiresAt <= now()) return null;
      return rec.value;
    },
  };
}
