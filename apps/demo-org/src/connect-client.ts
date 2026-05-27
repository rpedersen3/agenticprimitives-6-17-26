// Browser orchestration for demo-org (a relying site). Name-first connect (passkey
// or SIWE) → on-chain custody AgentSession; sign-up a new agent. Org/service-agent
// creation is a CENTRAL-AUTH ceremony (startOrgCreation → demo-sso popup): the agent is
// custodied by the person's ROOT passkey, not this site, and we receive a scoped
// org→delegate delegation (spec 229 / ADR-0019). Hits demo-org's own broker + the
// deployed demo-a2a worker (via /a2a).
import { buildMessage } from '@agenticprimitives/connect-auth/siwe';
import { buildSubregistryRegisterCall, buildSetPrimaryNameCall } from '@agenticprimitives/agent-naming';
import { buildExecuteBatchCallData } from '@agenticprimitives/agent-account';
import type { Address, Hex } from '@agenticprimitives/types';
import type { DelegationWire } from './lib/delegation';
import { connectWallet, personalSign } from './lib/wallet';
import { registerPasskey, signWithPasskey, loadPasskey, type DemoPasskey } from './lib/passkey';
import { ensureCsrfToken, csrfHeaders } from './csrf';
import { CONTRACTS } from './lib/chain';

/** A function that signs a 32-byte hash (EOA personal_sign or WebAuthn). */
export type SignHash = (hash: Hex) => Promise<Hex>;

export const AUD = 'demo-org';
const CHAIN_ID = 84532;

/** The registrable Connect SSO domain. Each person's central auth (their human
 *  sign-in home) is their own single-label subdomain of this (spec 232). NOTE the
 *  split: SSO is `<label>.impact-agent.me` (Vercel); the agent's A2A endpoint is a
 *  separate domain `<label>.impact-agent.io` (Cloudflare). Relying sites send
 *  users HERE for sign-in. */
const CENTRAL_AUTH_DOMAIN = 'impact-agent.me';

/** The configured PLATFORM Connect origin — the apex landing + the bootstrap/sign-up
 *  origin (a name with no agent yet has nothing to resolve, so it lands at the apex).
 *  Not exported: callers go through `resolveAuthOrigin`. */
const PLATFORM_AUTH_ORIGIN =
  (import.meta.env?.VITE_CENTRAL_AUTH_ORIGIN as string | undefined) ?? `https://${CENTRAL_AUTH_DOMAIN}`;

/** The label part of a name (`alice.demo.agent` → `alice`; `alice` → `alice`). */
function nameLabel(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/\.demo\.agent$/, '')
      .replace(/\.+$/, '')
      .split('.')[0] ?? ''
  );
}

/** Resolve where a name's central auth lives (spec 229 §4 / spec 231 — P5).
 *  ONE mechanism, no fallback chain (ADR-0013): each person's secure home is their
 *  own subdomain `<label>.impact-agent.io`, and the home origin is DERIVED from the
 *  name — the subdomain ⟺ name-label binding is canonical in this deployment, a pure
 *  computation, not a remote lookup. An empty/unparseable name (bootstrap / sign-up —
 *  no agent yet, so nothing to resolve) lands at the platform apex. The on-chain
 *  `authOrigin` profile facet (agent-profile `AUTH_ORIGIN`) remains the FUTURE override
 *  for self-hosted homes; deriving it here adds no information and no gas. `async` keeps
 *  the seam stable for that future facet read. */
// eslint-disable-next-line @typescript-eslint/require-await
export async function resolveAuthOrigin(name?: string): Promise<string> {
  const label = name ? nameLabel(name) : '';
  return label ? `https://${label}.${CENTRAL_AUTH_DOMAIN}` : PLATFORM_AUTH_ORIGIN;
}

export type SiweOutcome =
  | { status: 'issued'; token: string; address: Address; agent: Address }
  | { status: 'bootstrap'; address: Address }
  | { status: 'disambiguate' | 'rejected'; address?: Address; reason?: string };

async function getNonce(): Promise<string> {
  const r = await fetch('/connect/nonce');
  if (!r.ok) throw new Error('nonce fetch failed');
  return ((await r.json()) as { nonce: string }).nonce;
}

/** Connect a wallet, sign SIWE, resolve to an AgentSession (or signal bootstrap). */
export async function siweLogin(): Promise<SiweOutcome> {
  const address = await connectWallet();
  const nonce = await getNonce();
  const message = buildMessage({
    domain: window.location.host,
    address,
    uri: window.location.origin,
    chainId: CHAIN_ID,
    nonce,
    statement: 'Sign in to Agentic Org — proving you control this wallet.',
  });
  const signature = await personalSign(address, message);
  const r = await fetch('/connect/siwe', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message, signature, aud: AUD }),
  });
  const body = (await r.json()) as { status: string; token?: string; agent?: string; reason?: string };
  if (body.status === 'issued' && body.token) {
    return { status: 'issued', token: body.token, address, agent: (body.agent ?? address) as Address };
  }
  if (body.status === 'bootstrap') return { status: 'bootstrap', address };
  return { status: (body.status as 'disambiguate' | 'rejected') ?? 'rejected', address, reason: body.reason };
}

/** Bootstrap: deploy a person SA (EOA custodian) via demo-a2a. */
export async function bootstrapWithWallet(
  address: Address,
  onStep?: (s: string) => void,
): Promise<{ ok: true; agent: Address } | { ok: false; error: string }> {
  await ensureCsrfToken();
  onStep?.('Preparing your workspace…');
  const buildRes = await fetch('/a2a/session/deploy', {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json', ...csrfHeaders() },
    body: JSON.stringify({ initMethod: 'eoa', owner: address }),
  });
  if (buildRes.status === 409) {
    return { ok: false, error: 'Gas sponsorship is not enabled on the backend (paymaster).' };
  }
  const built = (await buildRes.json()) as {
    ok?: boolean;
    sender?: Address;
    userOpHash?: Hex;
    userOp?: Record<string, unknown>;
    error?: string;
  };
  if (!buildRes.ok || !built.ok || !built.userOpHash || !built.userOp) {
    return { ok: false, error: built.error ?? `deploy build failed (HTTP ${buildRes.status})` };
  }
  onStep?.('Confirm in your wallet…');
  const signature = await personalSign(address, built.userOpHash);
  onStep?.('Securing on the network…');
  const submitRes = await fetch('/a2a/session/deploy/submit', {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json', ...csrfHeaders() },
    body: JSON.stringify({ userOp: { ...built.userOp, signature } }),
  });
  const submitted = (await submitRes.json()) as {
    ok?: boolean;
    deployedAddress?: Address;
    error?: string;
    detail?: string;
  };
  if (!submitRes.ok || !submitted.ok || !submitted.deployedAddress) {
    return {
      ok: false,
      error: [submitted.error, submitted.detail].filter(Boolean).join(' — ') || `deploy submit failed (HTTP ${submitRes.status})`,
    };
  }
  return { ok: true, agent: submitted.deployedAddress };
}

/** Execute a call FROM a deployed agent: build userOp -> sign hash -> submit (via /a2a).
 *
 *  The hard part is the nonce. A just-deployed SA consumed nonce 0 in its deploy op, so its
 *  first post-deploy op needs nonce 1 — but the relayer's `getNonce` read can lag and return
 *  0, producing `AA25 invalid account nonce` (the wrong nonce is baked into the signature, so
 *  resubmitting the same op can't fix it). `minNonce` gates this: we poll the BUILD (no
 *  signing — no credential prompt) until the relayer's view reaches the expected nonce, THEN
 *  sign ONCE and submit. So we never sign a stale-nonce op, and the passkey/wallet is prompted
 *  exactly once. If a submit still fails (residual simulation lag, or an unexpected AA25), we
 *  rebuild+resign on the next loop with a fresh nonce. */
async function executeCall(
  sender: Address,
  signHash: SignHash,
  callData: Hex,
  opts: { minNonce?: bigint; attempts?: number } = {},
): Promise<{ ok: true; txHash?: Hex } | { ok: false; error: string }> {
  const { minNonce, attempts = 4 } = opts;
  await ensureCsrfToken();
  let lastErr = 'execute failed';

  for (let i = 0; i < attempts; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, 2500));

    // Build (no signing yet → no credential prompt on this step).
    const buildRes = await fetch('/a2a/account/build-call-userop', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json', ...csrfHeaders() },
      body: JSON.stringify({ sender, callData }),
    });
    const b = (await buildRes.json()) as {
      ok?: boolean;
      userOpHash?: Hex;
      userOp?: (Record<string, unknown> & { nonce?: string });
      error?: string;
      detail?: string;
    };
    if (!buildRes.ok || !b.ok || !b.userOpHash || !b.userOp) {
      lastErr = [b.error, b.detail].filter(Boolean).join(' — ') || `build-call failed (HTTP ${buildRes.status})`;
      continue;
    }

    // Nonce gate: don't sign until the relayer's nonce view reflects the deploy.
    if (minNonce !== undefined && BigInt(b.userOp.nonce ?? '0') < minNonce) {
      lastErr = `relayer nonce ${b.userOp.nonce} < ${minNonce} — deploy not yet propagated`;
      continue; // rebuild next loop; still no prompt
    }

    // Sign ONCE for this (correct-nonce) op, then submit.
    const signature = await signHash(b.userOpHash);
    const submitRes = await fetch('/a2a/account/submit-call-userop', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json', ...csrfHeaders() },
      body: JSON.stringify({ userOp: { ...b.userOp, signature } }),
    });
    const submitted = (await submitRes.json()) as { ok?: boolean; transactionHash?: Hex; error?: string; detail?: string };
    if (submitRes.ok && submitted.ok) return { ok: true, txHash: submitted.transactionHash };
    lastErr =
      [submitted.error, submitted.detail].filter(Boolean).join(' — ') || `submit-call failed (HTTP ${submitRes.status})`;
  }
  return { ok: false, error: lastErr };
}

/** Claim a forced-unique `<base>[N].demo.agent` for the agent + set it as primary.
 *  register + setPrimaryName are BATCHED into one execute UserOp (one nonce, one signature):
 *  they must land together, and the batch avoids an inter-userOp race where the second op
 *  sees a stale view of the first's state. `minNonce` rides out the post-deploy nonce lag
 *  (pass the nonce the SA must be at after its deploy, e.g. 1n right after a fresh deploy). */
export async function claimName(
  agent: Address,
  signHash: SignHash,
  base: string,
  onStep?: (s: string) => void,
  minNonce?: bigint,
): Promise<{ ok: true; name: string } | { ok: false; error: string }> {
  onStep?.('Finding a free name…');
  const nameRes = await fetch(`/connect/name?base=${encodeURIComponent(base)}`);
  const picked = (await nameRes.json()) as { label?: string; name?: string; node?: Hex; error?: string };
  if (!nameRes.ok || !picked.name || !picked.node || !picked.label) {
    return { ok: false, error: picked.error ?? 'no free name' };
  }

  onStep?.(`Claiming ${picked.name}…`);
  const register = buildSubregistryRegisterCall({
    subregistry: CONTRACTS.permissionlessSubregistry,
    label: picked.label,
    newOwner: agent,
  });
  const setPrimary = buildSetPrimaryNameCall({ registry: CONTRACTS.agentNameRegistry, node: picked.node });
  const batch = buildExecuteBatchCallData([register, setPrimary]);
  const res = await executeCall(agent, signHash, batch, { minNonce, attempts: 10 });
  if (!res.ok) return { ok: false, error: `name claim failed: ${res.error}` };
  return { ok: true, name: picked.name };
}

// ── Passkey (WebAuthn) ──────────────────────────────────────────────
export type { DemoPasskey };
export type PasskeyOutcome =
  | { status: 'issued'; token: string; passkey: DemoPasskey }
  | { status: 'bootstrap'; passkey: DemoPasskey }
  | { status: 'disambiguate' | 'rejected'; passkey?: DemoPasskey; reason?: string };

/** A signHash backed by the registered passkey (WebAuthn). */
export const passkeySignHash: SignHash = (hash) => signWithPasskey(hash);

/** Sign in with a passkey (registering one first if none on this device), then resolve. */
export async function passkeyLogin(registerIfMissing = true): Promise<PasskeyOutcome> {
  let passkey = loadPasskey();
  if (!passkey) {
    if (!registerIfMissing) return { status: 'rejected', reason: 'no passkey on this device' };
    passkey = await registerPasskey('Agentic Org passkey');
  }
  const { challenge } = (await (await fetch('/connect/passkey-challenge')).json()) as { challenge: Hex };
  const signature = await signWithPasskey(challenge);
  const r = await fetch('/connect/passkey', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      credentialIdDigest: passkey.credentialIdDigest,
      pubKeyX: passkey.pubKeyX.toString(),
      pubKeyY: passkey.pubKeyY.toString(),
      challenge,
      signature,
      aud: AUD,
    }),
  });
  const body = (await r.json()) as { status: string; token?: string };
  if (body.status === 'issued' && body.token) return { status: 'issued', token: body.token, passkey };
  if (body.status === 'bootstrap') return { status: 'bootstrap', passkey };
  return { status: (body.status as 'disambiguate' | 'rejected') ?? 'rejected', passkey };
}

/** Bootstrap a passkey-direct person SA (no server custodian ever). */
export async function bootstrapWithPasskey(
  passkey: DemoPasskey,
  onStep?: (s: string) => void,
): Promise<{ ok: true; agent: Address } | { ok: false; error: string }> {
  await ensureCsrfToken();
  onStep?.('Preparing your workspace…');
  const buildRes = await fetch('/a2a/session/deploy', {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json', ...csrfHeaders() },
    body: JSON.stringify({
      initMethod: 'passkey',
      credentialIdDigest: passkey.credentialIdDigest,
      pubKeyX: passkey.pubKeyX.toString(),
      pubKeyY: passkey.pubKeyY.toString(),
    }),
  });
  if (buildRes.status === 409) return { ok: false, error: 'Gas sponsorship is not enabled on the backend (paymaster).' };
  const built = (await buildRes.json()) as { ok?: boolean; userOpHash?: Hex; userOp?: Record<string, unknown>; error?: string };
  if (!buildRes.ok || !built.ok || !built.userOpHash || !built.userOp) {
    return { ok: false, error: built.error ?? `deploy build failed (HTTP ${buildRes.status})` };
  }
  onStep?.('Confirm with your device…');
  const signature = await signWithPasskey(built.userOpHash);
  onStep?.('Securing on the network…');
  const submitRes = await fetch('/a2a/session/deploy/submit', {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json', ...csrfHeaders() },
    body: JSON.stringify({ userOp: { ...built.userOp, signature } }),
  });
  const submitted = (await submitRes.json()) as {
    ok?: boolean;
    deployedAddress?: Address;
    error?: string;
    detail?: string;
  };
  if (!submitRes.ok || !submitted.ok || !submitted.deployedAddress) {
    return {
      ok: false,
      error: [submitted.error, submitted.detail].filter(Boolean).join(' — ') || `deploy submit failed (HTTP ${submitRes.status})`,
    };
  }
  return { ok: true, agent: submitted.deployedAddress };
}

/** Deploy a Smart Agent via demo-a2a (no facet enroll). Used for the org agent. */
async function deployAgent(
  deployBody: Record<string, unknown>,
  signHash: SignHash,
): Promise<{ ok: true; agent: Address } | { ok: false; error: string }> {
  await ensureCsrfToken();
  const buildRes = await fetch('/a2a/session/deploy', {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json', ...csrfHeaders() },
    body: JSON.stringify(deployBody),
  });
  if (buildRes.status === 409) return { ok: false, error: 'paymaster not enabled' };
  const built = (await buildRes.json()) as { ok?: boolean; userOpHash?: Hex; userOp?: Record<string, unknown>; error?: string };
  if (!buildRes.ok || !built.ok || !built.userOpHash || !built.userOp) {
    return { ok: false, error: built.error ?? `deploy build failed (HTTP ${buildRes.status})` };
  }
  const signature = await signHash(built.userOpHash);
  const submitRes = await fetch('/a2a/session/deploy/submit', {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json', ...csrfHeaders() },
    body: JSON.stringify({ userOp: { ...built.userOp, signature } }),
  });
  const submitted = (await submitRes.json()) as {
    ok?: boolean;
    deployedAddress?: Address;
    error?: string;
    detail?: string;
  };
  if (!submitRes.ok || !submitted.ok || !submitted.deployedAddress) {
    return {
      ok: false,
      error: [submitted.error, submitted.detail].filter(Boolean).join(' — ') || `deploy submit failed (HTTP ${submitRes.status})`,
    };
  }
  return { ok: true, agent: submitted.deployedAddress };
}

// ── OIDC relying-site client (spec 230) ─────────────────────────────
// demo-org is the OpenID Connect client of the person's central auth (the OP). Sign-in is a
// standard authorization-code + S256 PKCE flow: /authorize (the OP SPA consent + ROOT-passkey
// ceremony) → code → /token → { id_token, delegation }. Identity = the id_token (verified
// against the OP's JWKS); authority = the scoped delegation sidecar (ADR-0019).

const CLIENT_ID = 'demo-org';
const redirectUri = (): string => window.location.origin + '/';
// This relying site's fixed delegate identity — the demo-org backend account. The person's
// secure home issues a scoped grant to THIS address; the backend presents it for reads (and
// could redeem it on-chain later). Fixed + backend-controlled ⇒ the browser creates NO local
// passkey or account, so sign-in fires zero prompts on this origin (they belong in the secure
// home). spec 229/230. Configurable via VITE_DEMO_ORG_DELEGATE.
const DEMO_ORG_DELEGATE: Address =
  ((import.meta.env?.VITE_DEMO_ORG_DELEGATE as string | undefined) ??
    '0x89D13c596c45E4eE80Af5ae06C727FE9A820ffD0') as Address;

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
  template: 'site-login' | 'org-create';
  orgBase?: string;
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
  return u.toString();
}

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

/** Returning sign-in with NO popup/passkey (spec 230 / ADR-0019 runtime auth): present the
 *  held delegation to /token; the OP verifies it (ERC-1271 + window) and mints a fresh id_token.
 *  Returns the verified session, or null to fall back to the full enrollment ceremony. */
export async function silentReauth(name: string, delegation: DelegationWire): Promise<{ idToken: string; name: string } | null> {
  try {
    const authOrigin = await resolveAuthOrigin(name);
    const r = await fetch(new URL('/token', authOrigin).toString(), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ grant_type: 'delegation', delegation, client_id: CLIENT_ID, redirect_uri: redirectUri(), agent_name: name }),
    });
    if (!r.ok) return null;
    const b = (await r.json().catch(() => ({}))) as { id_token?: string };
    if (!b.id_token) return null;
    const claims = await verifyIdToken(authOrigin, b.id_token, ''); // no nonce in a silent re-auth
    return { idToken: b.id_token, name: claims.agent_name ?? name };
  } catch {
    return null; // any failure → caller falls back to the popup ceremony
  }
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

export interface IdTokenClaims {
  iss: string;
  sub: string;
  aud: string;
  exp: number;
  nonce?: string;
  agent_name?: string;
  canonical_agent_id?: string;
}
/** Verify the OIDC id_token against the OP's JWKS — ES256 alg-pinned to the key, iss/aud
 *  exact-match, nonce binding, exp. The relying-site half of spec 230 (no connect import). */
export async function verifyIdToken(authOrigin: string, idToken: string, expectedNonce: string): Promise<IdTokenClaims> {
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
  if (claims.aud !== CLIENT_ID) throw new Error('id_token aud mismatch');
  if (expectedNonce && claims.nonce !== expectedNonce) throw new Error('id_token nonce mismatch');
  if (typeof claims.exp !== 'number' || claims.exp * 1000 <= Date.now()) throw new Error('id_token expired');
  return claims;
}

// ── Create a named Organization Smart Agent (spec 229 §7 + ADR-0019) ───────────

/** Start org creation as an OIDC `org-create` authorization (memory
 *  project_demo_org_durable_org_custody): the org is custodied by the person's ROOT passkey at
 *  the central auth (same pattern as the person SA + any future service agent), never this
 *  site's passkey and never the person SA. Builds the /authorize URL (template=org-create);
 *  the caller opens the popup and exchanges the returned code → { id_token, delegation, org }. */
export async function startOrgCreation(
  personName: string,
  orgBase: string,
): Promise<{ url: string; state: string; authOrigin: string; codeVerifier: string; nonce: string }> {
  const state = randomB64url(16);
  const nonce = randomB64url(16);
  const { verifier, challenge } = await generatePkce();
  const authOrigin = await resolveAuthOrigin(personName); // person's secure home (spec 229 §4)
  const url = buildAuthorizeUrl({
    authOrigin,
    state,
    nonce,
    codeChallenge: challenge,
    agentName: personName,
    delegate: DEMO_ORG_DELEGATE,
    template: 'org-create',
    orgBase,
  });
  return { url, state, authOrigin, codeVerifier: verifier, nonce };
}


/** Build the OIDC `/authorize` request to the person's secure home (template=site-login).
 *  demo-org creates NOTHING locally — no passkey, no account, ZERO prompts on this origin.
 *  The delegate is the fixed backend identity (`DEMO_ORG_DELEGATE`); the person authenticates
 *  + approves at their secure home, which issues the id_token + the scoped `person → delegate`
 *  grant. The site is a DELEGATE, never a custodian. (Return sign-in is silent — `silentReauth`
 *  — so no local "for next time" credential is needed.) */
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
    delegate: DEMO_ORG_DELEGATE,
    template: 'site-login',
  });
  return { ok: true, url, state, authOrigin, codeVerifier: verifier, nonce };
}

/** Connect to the agent that OWNS `name`, proving control with a custody credential.
 *  Name-first: the agent-service name is the identity; the server resolves name→agent
 *  on-chain and verifies the credential is a custodian of it. */
export async function connectWithName(
  name: string,
  via: 'wallet' | 'passkey',
): Promise<{ ok: true; token: string; name?: string } | { ok: false; error: string }> {
  let proof: Record<string, unknown>;
  if (via === 'wallet') {
    const address = await connectWallet();
    const nonce = await getNonce();
    const message = buildMessage({
      domain: window.location.host,
      address,
      uri: window.location.origin,
      chainId: CHAIN_ID,
      nonce,
      statement: `Connect to ${name} on Agentic Org.`,
    });
    const signature = await personalSign(address, message);
    proof = { kind: 'siwe-eoa', message, signature };
  } else {
    const pk = loadPasskey();
    if (!pk) return { ok: false, error: 'No passkey on this device — sign up here, or connect with your wallet.' };
    const { challenge } = (await (await fetch('/connect/passkey-challenge')).json()) as { challenge: Hex };
    const signature = await signWithPasskey(challenge);
    proof = { kind: 'passkey', credentialIdDigest: pk.credentialIdDigest, challenge, signature };
  }
  const r = await fetch('/connect/with-name', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, aud: AUD, ...proof }),
  });
  const b = (await r.json()) as { status?: string; token?: string; name?: string; error?: string };
  if (r.ok && b.status === 'issued' && b.token) return { ok: true, token: b.token, name: b.name };
  return { ok: false, error: b.error ?? `connect failed (HTTP ${r.status})` };
}

/** Read the org's gated data via the scoped `org → this site's delegate SA` delegation minted
 *  at creation (ADR-0019 / demo-mcp get_org_sensitive). The org is custodied by the person's
 *  ROOT passkey (at the central auth), so we no longer sign here — we present the STORED org
 *  delegation: requester = the delegate; demo-a2a verifies the org SA signed it (ERC-1271),
 *  it's unrevoked + in-window, then mints the MCP token keyed by the org (the delegator).
 *  Single-custodian is fine — get_org_sensitive is T1 (no quorum). Same shape as readPersonData. */
export async function readOrgData(
  orgDelegation: DelegationWire,
): Promise<{ ok: true; record: unknown; orgName?: string } | { ok: false; error: string }> {
  await ensureCsrfToken();
  const r = await fetch('/a2a/mcp/org/sensitive', {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json', ...csrfHeaders() },
    body: JSON.stringify({ delegation: orgDelegation, requester: orgDelegation.delegate }),
  });
  const b = (await r.json().catch(() => ({}))) as { ok?: boolean; record?: unknown; org_name?: string; error?: string; detail?: string };
  if (r.ok && b.ok) return { ok: true, record: b.record, orgName: b.org_name };
  return { ok: false, error: b.detail ?? b.error ?? `org data read failed (HTTP ${r.status})` };
}

/** Read the PERSON's gated PII via the delegation we already hold (person → this site's
 *  delegate SA). requester = the delegate; demo-mcp get_pii returns data keyed by the person
 *  (the delegator). Reuses the same delegation that signed you in — no new signature. */
export async function readPersonData(
  delegation: DelegationWire,
): Promise<{ ok: true; record: unknown } | { ok: false; error: string }> {
  await ensureCsrfToken();
  const r = await fetch('/a2a/mcp/person/pii', {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json', ...csrfHeaders() },
    body: JSON.stringify({ delegation, requester: delegation.delegate }),
  });
  const b = (await r.json().catch(() => ({}))) as { ok?: boolean; record?: unknown; pii?: unknown; error?: string; detail?: string };
  if (r.ok && b.ok) return { ok: true, record: b.record ?? b.pii };
  return { ok: false, error: b.detail ?? b.error ?? `PII read failed (HTTP ${r.status})` };
}

/** Sign up: create a workspace named `<base>.demo.agent` with a custody credential,
 *  and CLAIM the name for THAT credential's agent. Passkey → a FRESH passkey (a new
 *  workspace); wallet → the EOA's deterministic agent. */
export async function signupWithName(
  base: string,
  via: 'wallet' | 'passkey',
  onStep?: (s: string) => void,
): Promise<{ ok: true; token: string; name: string } | { ok: false; error: string }> {
  if (via === 'passkey') {
    onStep?.('Creating your passkey…');
    const pk = await registerPasskey(`${base}.demo.agent`); // FRESH passkey for this workspace
    const dep = await bootstrapWithPasskey(pk, onStep); // deploy passkey-direct
    if (!dep.ok) return { ok: false, error: dep.error };
    // Fresh deploy consumed nonce 0 → the claim op must be nonce ≥ 1 (gate out the lag).
    const claim = await claimName(dep.agent, passkeySignHash, base, onStep, 1n);
    if (!claim.ok) return { ok: false, error: claim.error };
    onStep?.('Signing you in…');
    const login = await passkeyLogin(false);
    return login.status === 'issued'
      ? { ok: true, token: login.token, name: claim.name }
      : { ok: false, error: `created, but sign-in returned ${login.status}` };
  }
  // wallet: the EOA's deterministic agent (reconnect if it exists, else bootstrap).
  onStep?.('Connecting your wallet…');
  const first = await siweLogin(); // connects wallet + signs
  let agent: Address;
  let address: Address;
  let minNonce: bigint | undefined; // set only on a fresh deploy (nonce 0 just consumed)
  if (first.status === 'issued') {
    agent = first.agent;
    address = first.address;
  } else if (first.status === 'bootstrap') {
    address = first.address;
    const dep = await bootstrapWithWallet(address, onStep);
    if (!dep.ok) return { ok: false, error: dep.error };
    agent = dep.agent;
    minNonce = 1n;
  } else {
    return { ok: false, error: first.reason ?? `sign-in ${first.status}` };
  }
  const signHash: SignHash = (h) => personalSign(address, h);
  const claim = await claimName(agent, signHash, base, onStep, minNonce);
  if (!claim.ok) return { ok: false, error: claim.error };
  onStep?.('Signing you in…');
  const login = await siweLogin();
  return login.status === 'issued'
    ? { ok: true, token: login.token, name: claim.name }
    : { ok: false, error: `created, but sign-in returned ${login.status}` };
}
