// Google OIDC auth method (real implementation).
//
// Authorization-code + PKCE (S256) + state + nonce, then id_token verification
// (RS256 via Web Crypto against the provider JWKS) and claim validation
// (iss / aud / exp / nonce + email_verified). Dependency-light: @noble/hashes
// for the PKCE challenge, Web Crypto (`globalThis.crypto.subtle`, Node 20+) for
// RSA verification — no JWT library.
//
// SECURITY (audit CN-3 / CN-4, ADR-0017):
//   - PKCE + state + nonce are mandatory; `state` is compared constant-time.
//   - `alg` is PINNED to RS256 — the token's own `alg` header is never trusted
//     to select the algorithm; `alg: none` / HS* are rejected (alg-confusion).
//   - `iss` + `aud` validated; `nonce` matched to the expected value.
//   - `email_verified === true` is REQUIRED; the facet is keyed on (iss, sub),
//     never on email (resists email-reuse takeover).
//
// This method returns a *verified OIDC principal* (iss/sub/email). It does NOT
// resolve to a canonical Smart Agent — that binding is the directory's job
// (spec 223) and the broker's (spec 224); connect-auth must not import them.

import { sha256 } from '@noble/hashes/sha2.js';

// ─── Provider config ──────────────────────────────────────────────────

export interface OidcProviderConfig {
  /** Accepted `iss` claim values (Google issues `https://accounts.google.com`). */
  issuers: string[];
  authorizationEndpoint: string;
  tokenEndpoint: string;
  jwksUri: string;
}

/** Google's stable OIDC endpoints (discovery doc values, pinned). */
export const GOOGLE_OIDC: OidcProviderConfig = {
  issuers: ['https://accounts.google.com', 'accounts.google.com'],
  authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenEndpoint: 'https://oauth2.googleapis.com/token',
  jwksUri: 'https://www.googleapis.com/oauth2/v3/certs',
};

/** YouVersion Platform OIDC endpoints (developers.youversion.com/sign-in-apis, pinned). A PUBLIC PKCE
 *  client: the token exchange carries NO `client_secret` (pass `clientSecret: undefined` to completeLogin).
 *  YouVersion does not document an `email_verified` claim, so the consumer sets `requireEmailVerified:
 *  false` — the credential is keyed on (iss, sub), never on email, so this does not weaken takeover
 *  resistance. */
export const YOUVERSION_OIDC: OidcProviderConfig = {
  // YouVersion's id_token sets `iss` to the TOKEN ENDPOINT URL (observed live), not the base origin the
  // docs state — accept both so we're robust to either.
  issuers: ['https://api.youversion.com/auth/token', 'https://api.youversion.com'],
  authorizationEndpoint: 'https://api.youversion.com/auth/authorize',
  tokenEndpoint: 'https://api.youversion.com/auth/token',
  jwksUri: 'https://api.youversion.com/.well-known/jwks.json',
};

// ─── base64url + random helpers ───────────────────────────────────────

function b64urlEncode(bytes: Uint8Array): string {
  let s: string;
  if (typeof Buffer !== 'undefined') {
    s = Buffer.from(bytes).toString('base64');
  } else {
    let bin = '';
    for (const b of bytes) bin += String.fromCharCode(b);
    s = btoa(bin);
  }
  return s.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlToBytes(s: string): Uint8Array {
  let padded = s.replace(/-/g, '+').replace(/_/g, '/');
  while (padded.length % 4) padded += '=';
  if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(padded, 'base64'));
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function b64urlToString(s: string): string {
  return new TextDecoder().decode(b64urlToBytes(s));
}

/**
 * Copy into a fresh ArrayBuffer-backed view. Web Crypto's `BufferSource` typing
 * (TS 5.7 typed-array generics) rejects `Uint8Array<ArrayBufferLike>`; a fresh
 * `new Uint8Array(n)` is `Uint8Array<ArrayBuffer>`, which is accepted.
 */
function freshBytes(u: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(u.byteLength);
  out.set(u);
  return out;
}

function randomB64url(byteLen: number): string {
  const buf = new Uint8Array(byteLen);
  globalThis.crypto.getRandomValues(buf);
  return b64urlEncode(buf);
}

function constantTimeEqualStr(a: string, b: string): boolean {
  const ab = new TextEncoder().encode(a);
  const bb = new TextEncoder().encode(b);
  if (ab.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ab.length; i++) diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  return diff === 0;
}

// ─── begin: build the authorization URL + PKCE/state/nonce ────────────

export interface BeginLoginInput {
  clientId: string;
  redirectUri: string;
  /** OIDC scopes; `openid` is forced. Defaults to `openid email profile`. */
  scope?: string;
  /** e.g. 'consent' | 'select_account'. */
  prompt?: string;
  config?: OidcProviderConfig;
}

export interface BeginLoginResult {
  /** Redirect the user agent here. */
  authUrl: string;
  /** Store these in the broker's same-origin session; needed by completeLogin. */
  codeVerifier: string;
  state: string;
  nonce: string;
}

/**
 * Start the OIDC login: generate PKCE verifier/challenge, state, nonce, and the
 * authorization URL. The caller stores `codeVerifier`/`state`/`nonce` server-side
 * (the broker `BrokerSession`) and redirects to `authUrl`.
 */
export function beginLogin(input: BeginLoginInput): BeginLoginResult {
  const config = input.config ?? GOOGLE_OIDC;
  const codeVerifier = randomB64url(32); // 43-char unreserved string (RFC 7636)
  const codeChallenge = b64urlEncode(sha256(new TextEncoder().encode(codeVerifier)));
  const state = randomB64url(24);
  const nonce = randomB64url(24);

  const scope = input.scope ?? 'openid email profile';
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    scope: scope.includes('openid') ? scope : `openid ${scope}`,
    state,
    nonce,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });
  if (input.prompt) params.set('prompt', input.prompt);

  return { authUrl: `${config.authorizationEndpoint}?${params.toString()}`, codeVerifier, state, nonce };
}

// ─── complete: token exchange + id_token verification ─────────────────

export interface OidcPrincipal {
  /** The verified issuer. */
  iss: string;
  /** The verified subject (immutable provider id). The facet key, NOT the identity. */
  sub: string;
  email: string | null;
  /** Always true on success — login is rejected unless the provider asserts it. */
  emailVerified: boolean;
  name: string | null;
}

export interface CompleteLoginInput {
  /** Authorization code returned to the redirect_uri. */
  code: string;
  /** `state` returned by the provider — compared to `expectedState`. */
  returnedState: string;
  /** Values produced by beginLogin and stored server-side. */
  expectedState: string;
  expectedNonce: string;
  codeVerifier: string;
  /** Must match the value used in beginLogin. */
  redirectUri: string;
  clientId: string;
  /** Confidential-client secret. OMIT for a PUBLIC PKCE client (e.g. YouVersion) — the token request
   *  then carries only `client_id` + `code_verifier`, never an (empty) `client_secret`. */
  clientSecret?: string;
  /** Require `email_verified === true` (default true — Google). Set false for providers that don't
   *  assert it (YouVersion); the facet is keyed on (iss, sub), not email, so this is safe. */
  requireEmailVerified?: boolean;
  /** Require the id_token `nonce` to match (default true — Google). Set false for providers whose
   *  non-standard multi-leg flow doesn't round-trip the authorize `nonce` into the id_token
   *  (YouVersion). PKCE (the code_verifier only we hold) already binds the code exchange, so this is
   *  safe — replay/injection of a stolen id_token still fails without the verifier. */
  requireNonce?: boolean;
  config?: OidcProviderConfig;
  /** Injectable for tests (defaults to global fetch). */
  fetchImpl?: typeof fetch;
  /** Injectable clock in ms (defaults to Date.now). */
  now?: () => number;
}

export type CompleteLoginResult =
  | { ok: true; principal: OidcPrincipal }
  | { ok: false; reason: string };

interface IdTokenClaims {
  iss?: string;
  sub?: string;
  aud?: string | string[];
  exp?: number;
  iat?: number;
  nonce?: string;
  email?: string;
  email_verified?: boolean | string;
  name?: string;
}

/** Build the `(iss, sub)` facet key a directory keys an OIDC credential on. */
export function oidcFacetId(iss: string, sub: string): string {
  return `${iss}#${sub}`;
}

export async function completeLogin(input: CompleteLoginInput): Promise<CompleteLoginResult> {
  const config = input.config ?? GOOGLE_OIDC;
  // Bind the global fetch to globalThis: the Cloudflare workerd runtime throws
  // "Illegal invocation" if its native `fetch` is invoked with a `this` other
  // than the global (e.g. `ctx.fetchImpl(url)` — a method call sets `this=ctx`).
  // A bound function ignores the call-site `this`, so it is safe to pass around
  // and call as a property. A caller-supplied mock is used as-is.
  const doFetch = input.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const nowMs = (input.now ?? Date.now)();

  // 1. State (CSRF / mix-up defense) — constant-time, before any network call.
  if (!input.returnedState || !constantTimeEqualStr(input.returnedState, input.expectedState)) {
    return { ok: false, reason: 'state mismatch' };
  }

  // 2. Authorization-code → tokens (with PKCE code_verifier).
  let idToken: string;
  try {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code: input.code,
      redirect_uri: input.redirectUri,
      client_id: input.clientId,
      code_verifier: input.codeVerifier,
    });
    // Confidential clients (Google) include the secret; public PKCE clients (YouVersion) MUST NOT send
    // one — an empty `client_secret` makes some providers reject the exchange.
    if (input.clientSecret) body.set('client_secret', input.clientSecret);
    const res = await doFetch(config.tokenEndpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: body.toString(),
    });
    if (!res.ok) return { ok: false, reason: `token endpoint returned ${res.status}` };
    const json = (await res.json()) as { id_token?: string };
    if (!json.id_token) return { ok: false, reason: 'token response missing id_token' };
    idToken = json.id_token;
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? `token exchange failed: ${e.message}` : 'token exchange failed' };
  }

  // 3. Verify the id_token.
  const verified = await verifyIdToken(idToken, {
    config,
    clientId: input.clientId,
    expectedNonce: input.expectedNonce,
    requireNonce: input.requireNonce !== false,
    nowMs,
    fetchImpl: doFetch,
  });
  if (!verified.ok) return verified;

  // 4. email_verified is mandatory by default (audit CN-3 / P0-3). Providers that don't assert the claim
  //    (YouVersion) opt out via `requireEmailVerified: false` — safe because the facet keys on (iss, sub).
  const ev = verified.claims.email_verified;
  const emailVerified = ev === true || ev === 'true';
  if (input.requireEmailVerified !== false && !emailVerified) {
    return { ok: false, reason: 'email_verified is not true' };
  }

  return {
    ok: true,
    principal: {
      iss: verified.claims.iss!,
      sub: verified.claims.sub!,
      email: verified.claims.email ?? null,
      emailVerified,
      name: verified.claims.name ?? null,
    },
  };
}

async function verifyIdToken(
  idToken: string,
  ctx: { config: OidcProviderConfig; clientId: string; expectedNonce: string; requireNonce: boolean; nowMs: number; fetchImpl: typeof fetch },
): Promise<{ ok: true; claims: IdTokenClaims } | { ok: false; reason: string }> {
  const parts = idToken.split('.');
  if (parts.length !== 3) return { ok: false, reason: 'id_token is not a 3-part JWT' };
  const [headerB64, payloadB64, sigB64] = parts as [string, string, string];

  let header: { alg?: string; kid?: string };
  let claims: IdTokenClaims;
  try {
    header = JSON.parse(b64urlToString(headerB64));
    claims = JSON.parse(b64urlToString(payloadB64));
  } catch {
    return { ok: false, reason: 'id_token header/payload not valid JSON' };
  }

  // Alg pinning — never trust the token's alg to pick the algorithm (CN-4).
  if (header.alg !== 'RS256') return { ok: false, reason: `id_token alg must be RS256, got "${header.alg}"` };
  if (!header.kid) return { ok: false, reason: 'id_token missing kid' };

  // Fetch JWKS and find the signing key.
  let jwk: JsonWebKey & { kid?: string };
  try {
    const res = await ctx.fetchImpl(ctx.config.jwksUri, { headers: { accept: 'application/json' } });
    if (!res.ok) return { ok: false, reason: `JWKS endpoint returned ${res.status}` };
    const set = (await res.json()) as { keys?: Array<JsonWebKey & { kid?: string }> };
    const found = set.keys?.find((k) => k.kid === header.kid && k.kty === 'RSA');
    if (!found) return { ok: false, reason: `no RSA JWKS key for kid "${header.kid}"` };
    jwk = found;
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? `JWKS fetch failed: ${e.message}` : 'JWKS fetch failed' };
  }

  // Verify RS256 over `header.payload` via Web Crypto.
  let signatureValid: boolean;
  try {
    const key = await globalThis.crypto.subtle.importKey(
      'jwk',
      { kty: jwk.kty, n: (jwk as { n?: string }).n, e: (jwk as { e?: string }).e, alg: 'RS256', ext: true },
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify'],
    );
    signatureValid = await globalThis.crypto.subtle.verify(
      { name: 'RSASSA-PKCS1-v1_5' },
      key,
      freshBytes(b64urlToBytes(sigB64)),
      freshBytes(new TextEncoder().encode(`${headerB64}.${payloadB64}`)),
    );
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? `signature verification error: ${e.message}` : 'signature verification error' };
  }
  if (!signatureValid) return { ok: false, reason: 'id_token signature invalid' };

  // Claim validation.
  if (!claims.iss || !ctx.config.issuers.includes(claims.iss)) {
    return { ok: false, reason: `id_token iss "${claims.iss}" not accepted` };
  }
  const audOk = Array.isArray(claims.aud) ? claims.aud.includes(ctx.clientId) : claims.aud === ctx.clientId;
  if (!audOk) return { ok: false, reason: 'id_token aud does not match clientId' };
  if (typeof claims.exp !== 'number' || claims.exp * 1000 <= ctx.nowMs) {
    return { ok: false, reason: 'id_token expired' };
  }
  if (ctx.requireNonce && (!claims.nonce || !constantTimeEqualStr(claims.nonce, ctx.expectedNonce))) {
    return { ok: false, reason: 'id_token nonce mismatch' };
  }
  if (!claims.sub) return { ok: false, reason: 'id_token missing sub' };

  return { ok: true, claims };
}
