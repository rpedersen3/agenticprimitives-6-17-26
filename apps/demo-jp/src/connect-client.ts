// OIDC relying-app client for demo-jp (spec 230 / ADR-0019).
//
// demo-jp is a RELYING APP that does NOT run its own broker — every sign-in goes
// through the user's central auth at `<name>.impact-agent.me`. This file owns ONLY
// the relying-app side of that protocol:
//
//   1. `startSiteEnrollment(name)` — build the `/authorize` URL pointing at the
//      user's secure home (with state + PKCE + nonce + agent_name + delegate +
//      delegation_template). The SPA at the home runs the ceremony and redirects
//      back here with `?code=…&state=…`.
//   2. `exchangeCode(authOrigin, code, codeVerifier)` — POST to /token with PKCE
//      and pick up `{ id_token, delegation, org? }`.
//   3. `verifyIdToken(authOrigin, idToken, expectedNonce)` — ES256 alg-pinned,
//      iss/aud/nonce/exp-bound verification against the home's `/jwks` (the
//      relying-site half of spec 230). SEC-018: issuer allowlist enforced.
//
// Everything else (passkey enrollment, SIWE login, org creation, person-data reads)
// belongs at the central auth home, not here. Trimmed in Wave H6+ per the ARCH-034
// finding — the unused server-side functions in `apps/demo-jp/functions/connect/*`
// are deleted (SEC-021), and the unused client-side callers of those routes are
// removed here.
import { buildSubregistryRegisterCall, buildSetPrimaryNameCall } from '@agenticprimitives/agent-naming';
import { buildExecuteBatchCallData } from '@agenticprimitives/agent-account';
import type { Address, Hex } from '@agenticprimitives/types';
import type { DelegationWire } from './lib/delegation';
import { AGENT_NAME_PARENT, isAllowedIssuerOrigin, nameLabel, personalAuthOrigin, PLATFORM_AUTH_ORIGIN } from './lib/domain';

void buildSubregistryRegisterCall; // exports kept reachable for future name-claim flows; harmless if unused
void buildSetPrimaryNameCall;
void buildExecuteBatchCallData;

const CLIENT_ID = 'demo-jp';
const redirectUri = (): string => window.location.origin + '/';

// demo-jp's fixed relying-site delegate identity — the backend account JP grants are
// scoped TO. The person's secure home (Impact) issues the scoped grant to THIS address;
// the backend presents it for delegated reads. Configurable via VITE_DEMO_JP_DELEGATE.
// NOTE: the fallback below is shared with demo-org for the P1 demo (SEC-003 / ARCH-024
// — per-app delegate split is a config-only change once SEC-001's anti-spoof check is
// in place, which it now is).
const DEMO_JP_DELEGATE: Address =
  ((import.meta.env?.VITE_DEMO_JP_DELEGATE as string | undefined) ??
    '0x89D13c596c45E4eE80Af5ae06C727FE9A820ffD0') as Address;

/** Resolve where a name's central auth lives (spec 229 §4 / spec 231 — P5).
 *  ONE mechanism, no fallback chain (ADR-0013): each person's secure home is their
 *  own subdomain `<label>.impact-agent.me`, derived from the name. An empty/
 *  unparseable name (bootstrap / sign-up) lands at the platform apex. */
// eslint-disable-next-line @typescript-eslint/require-await
export async function resolveAuthOrigin(name?: string): Promise<string> {
  const label = name ? nameLabel(name) : '';
  return label ? personalAuthOrigin(label) : PLATFORM_AUTH_ORIGIN;
}

// ── PKCE + JWT base64url helpers ───────────────────────────────────────

function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function fromB64url(seg: string): Uint8Array<ArrayBuffer> {
  const bin = atob(seg.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(bin.length); // ArrayBuffer-backed (Web Crypto BufferSource)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function decodeJwtSegment<T>(seg: string): T {
  return JSON.parse(new TextDecoder().decode(fromB64url(seg))) as T;
}
const randomB64url = (n: number): string => b64url(crypto.getRandomValues(new Uint8Array(n)));

/** PKCE S256: a random verifier + base64url(SHA-256(verifier)) challenge (RFC 7636). */
async function generatePkce(): Promise<{ verifier: string; challenge: string }> {
  const verifier = randomB64url(32);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return { verifier, challenge: b64url(new Uint8Array(digest)) };
}

interface AuthorizeParams {
  authOrigin: string;
  state: string;
  nonce: string;
  codeChallenge: string;
  agentName: string;
  delegate: Address;
  template: 'site-login' | 'org-create' | 'jp-data-access';
  orgBase?: string;
  purpose?: string;
  grantOrg?: Address;
}
/** Build the OIDC `/authorize` URL (the OP's consent UI is the SPA at the origin root). */
function buildAuthorizeUrl(p: AuthorizeParams): string {
  const u = new URL('/', p.authOrigin);
  u.searchParams.set('client_id', CLIENT_ID);
  u.searchParams.set('redirect_uri', redirectUri());
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('scope', 'openid agent');
  u.searchParams.set('state', p.state);
  u.searchParams.set('nonce', p.nonce);
  u.searchParams.set('code_challenge', p.codeChallenge);
  u.searchParams.set('code_challenge_method', 'S256');
  u.searchParams.set('agent_name', p.agentName);
  u.searchParams.set('delegate', p.delegate);
  u.searchParams.set('delegation_template', p.template);
  if (p.orgBase) u.searchParams.set('org_base', p.orgBase);
  if (p.purpose) u.searchParams.set('org_purpose', p.purpose);
  if (p.grantOrg) u.searchParams.set('grant_org', p.grantOrg);
  return u.toString();
}

/** Wire shape of a related-org link the person's vault returns (spec 246). Carries NO
 *  person→org mapping — just the org metadata + the scoped delegation demo-jp received. */
export interface RelatedOrgLink {
  orgAgent: Address;
  orgName: string;
  purpose: string;
  delegation?: DelegationWire;
  proofHash?: string;
}

/** ADR-0025: ask Connect (the person's home) for the orgs related to THIS app — instead
 *  of reading a local person→org store. Person-session-authorized (the id_token). */
export async function listRelatedOrgs(name: string, idToken: string): Promise<RelatedOrgLink[]> {
  const authOrigin = await resolveAuthOrigin(name);
  const url = new URL('/connect/related-orgs', authOrigin);
  url.searchParams.set('client_id', CLIENT_ID);
  const r = await fetch(url.toString(), { headers: { authorization: `Bearer ${idToken}` } });
  if (!r.ok) return [];
  const b = (await r.json().catch(() => ({}))) as { orgs?: RelatedOrgLink[] };
  return b.orgs ?? [];
}

// ── Wire shapes ────────────────────────────────────────────────────────

export interface OrgTokenPayload {
  orgAgent: Address;
  orgName: string;
  edgeId: string;
  governed: boolean;
}
export interface TokenResult {
  idToken: string;
  delegation?: DelegationWire;
  org?: OrgTokenPayload;
}

export interface IdTokenClaims {
  iss: string;
  sub: string;
  aud: string;
  exp: number;
  nonce?: string;
  agent_name?: string;
  canonical_agent_id?: string;
}

// ── Public surface ─────────────────────────────────────────────────────

/** Build the OIDC `/authorize` request to the person's secure home (template=jp-data-access).
 *  demo-jp creates NOTHING locally — no passkey, no account, ZERO prompts on this origin.
 *  The home runs the ceremony, shows the explicit JP data-access consent (read+write your
 *  profile + adoption records in YOUR vault — spec 247), signs the grant, and redirects back
 *  with `?code=…&state=…`. demo-jp uses that grant to read/write the member's records. */
export async function startSiteEnrollment(
  name: string,
): Promise<{ ok: true; url: string; state: string; authOrigin: string; codeVerifier: string; nonce: string }> {
  const state = randomB64url(16);
  const nonce = randomB64url(16);
  const { verifier, challenge } = await generatePkce();
  const authOrigin = await resolveAuthOrigin(name); // person's secure home (spec 229 §4)
  const url = buildAuthorizeUrl({
    authOrigin,
    state,
    nonce,
    codeChallenge: challenge,
    agentName: name,
    delegate: DEMO_JP_DELEGATE,
    template: 'jp-data-access',
  });
  return { ok: true, url, state, authOrigin, codeVerifier: verifier, nonce };
}

/** Start an org-creation ceremony (template=org-create) at the connected person's
 *  secure home. The org SA is DEPLOYED + custodied by the person's ROOT credential
 *  AT their home (same custody as their person agent — demo-jp is never a custodian);
 *  the home mints a scoped org→demo-jp delegation and returns it with the org identity.
 *  `orgBase` is the desired org name label (e.g. the church name). */
export async function startOrgCreation(
  personName: string,
  orgBase: string,
  purpose?: string,
  grantOrg?: Address,
): Promise<{ url: string; state: string; authOrigin: string; codeVerifier: string; nonce: string }> {
  const state = randomB64url(16);
  const nonce = randomB64url(16);
  const { verifier, challenge } = await generatePkce();
  const authOrigin = await resolveAuthOrigin(personName);
  const url = buildAuthorizeUrl({
    authOrigin,
    state,
    nonce,
    codeChallenge: challenge,
    agentName: personName,
    delegate: DEMO_JP_DELEGATE,
    template: 'org-create',
    orgBase,
    purpose,
    grantOrg,
  });
  return { url, state, authOrigin, codeVerifier: verifier, nonce };
}

/** spec 246 §5: the broker org (JP) lists the orgs that delegated scoped access to it.
 *  The caller proves control of `delegate` via an ERC-1271 signature over the fixed
 *  challenge. `connectOrigin` is any Connect home origin (the vault KV is shared). */
export interface DelegatedOrgLink {
  orgAgent: Address;
  orgName: string;
  delegation?: DelegationWire;
}
export async function listDelegatedOrgs(connectOrigin: string, delegate: Address, sig: Hex): Promise<DelegatedOrgLink[]> {
  const url = new URL('/connect/delegated-orgs', connectOrigin);
  url.searchParams.set('delegate', delegate);
  url.searchParams.set('sig', sig);
  const r = await fetch(url.toString());
  if (!r.ok) return [];
  const b = (await r.json().catch(() => ({}))) as { orgs?: DelegatedOrgLink[] };
  return b.orgs ?? [];
}

/** spec 247: register a person→org link the operator already governs (their GC/JP org,
 *  created outside the Connect org-create ceremony) into the person's home vault, so
 *  /you lists it via the existing related-orgs query. Authorized by control of the person
 *  SA — `sig` is an ERC-1271 signature over `keccak256("related-orgs:write:<person>")`. */
export async function registerRelatedOrg(
  connectOrigin: string,
  link: { person: Address; orgAgent: Address; orgName: string; purpose: string; requestedBy: string },
  sig: Hex,
): Promise<boolean> {
  const r = await fetch(new URL('/connect/related-orgs', connectOrigin).toString(), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...link, sig }),
  });
  return r.ok;
}

/** Exchange the authorization code at /token (PKCE) → { id_token, delegation, org? } (§4.3). */
export async function exchangeCode(authOrigin: string, code: string, codeVerifier: string): Promise<TokenResult> {
  const r = await fetch(new URL('/token', authOrigin).toString(), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ grant_type: 'authorization_code', code, code_verifier: codeVerifier, client_id: CLIENT_ID, redirect_uri: redirectUri() }),
  });
  const b = (await r.json().catch(() => ({}))) as { id_token?: string; delegation?: DelegationWire; org?: OrgTokenPayload; error?: string };
  if (!r.ok || !b.id_token) throw new Error(b.error ?? `token exchange failed (HTTP ${r.status})`);
  return { idToken: b.id_token, delegation: b.delegation, org: b.org };
}

/** Verify the OIDC id_token against the OP's JWKS — ES256 alg-pinned to the key, iss/aud
 *  exact-match, nonce binding, exp. The relying-site half of spec 230.
 *  SEC-018: `authOrigin` is hard-validated as a well-formed Connect origin (single-label
 *  subdomain under our connect domain, or the apex). The id_token's `iss` MUST be the
 *  same validated value, so a user-typed name pointing at an attacker domain can't slip
 *  through even before the signature check. */
export async function verifyIdToken(authOrigin: string, idToken: string, expectedNonce: string): Promise<IdTokenClaims> {
  if (!isAllowedIssuerOrigin(authOrigin)) {
    throw new Error(`refusing to verify id_token: issuer "${authOrigin}" not in allowlist`);
  }
  const parts = idToken.split('.');
  if (parts.length !== 3) throw new Error('id_token malformed');
  const [h, p, s] = parts as [string, string, string];
  const header = decodeJwtSegment<{ alg?: string; kid?: string }>(h);
  const claims = decodeJwtSegment<IdTokenClaims>(p);
  const { keys } = (await (await fetch(new URL('/jwks', authOrigin).toString())).json()) as {
    keys: Array<JsonWebKey & { kid: string; alg: string }>;
  };
  const jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) throw new Error('no JWKS key for id_token kid');
  if (jwk.alg !== 'ES256' || header.alg !== 'ES256') throw new Error('id_token alg not ES256');
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, fromB64url(s), new TextEncoder().encode(`${h}.${p}`));
  if (!ok) throw new Error('id_token signature invalid');
  if (claims.iss !== authOrigin) throw new Error('id_token iss mismatch');
  if (!isAllowedIssuerOrigin(claims.iss)) throw new Error('id_token iss not in allowlist');
  if (claims.aud !== CLIENT_ID) throw new Error('id_token aud mismatch');
  if (expectedNonce && claims.nonce !== expectedNonce) throw new Error('id_token nonce mismatch');
  if (typeof claims.exp !== 'number' || claims.exp * 1000 <= Date.now()) throw new Error('id_token expired');
  return claims;
}

/** Unused helper kept for the `agent-naming` import (which carries the AGENT_NAME_PARENT
 *  constant the build references via deployment-config). Trimmed out of the public surface. */
export const AUD = CLIENT_ID;
void AGENT_NAME_PARENT;
void redirectUri;
// `redirectUri` is referenced inside `startSiteEnrollment` and `exchangeCode` via closure;
// the void above only silences the unused-export warning if this gets re-imported.
// `Hex` is currently unreferenced — kept available for type re-export downstream.
type _Hex = Hex;
void (null as unknown as _Hex);
