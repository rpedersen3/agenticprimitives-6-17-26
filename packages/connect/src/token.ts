// AgentSession token layer — asymmetric, JWKS-verifiable (spec 224 §4; CN-4).
//
// The cross-origin AgentSession is signed with the broker's PRIVATE key and
// verified by relying sites with the PUBLIC key (via JWKS). EdDSA (Ed25519) is
// the default; ES256 (ECDSA P-256) is a capability fallback. Both are Web Crypto
// (no JWT library). The HS256 same-origin BrokerSession is a different token
// (connect-auth's mintSession) — never verified here.
//
// SECURITY (CN-4): the verifier PINS the algorithm to the KEY (resolved by kid),
// never to the token's own `alg` header — so alg-confusion (RS/ES↔HS) and
// `alg: none` are rejected. ADR-0016: an AgentSession has NO `owner` field; a
// token carrying one is rejected (defense in depth).

import { base64urlEncode, base64urlDecode } from '@agenticprimitives/connect-auth';
import type {
  AgentSession,
  CanonicalAgentId,
  CredentialPrincipal,
  Assurance,
} from '@agenticprimitives/types';

export type BrokerAlg = 'EdDSA' | 'ES256';

export interface BrokerSigner {
  kid: string;
  alg: BrokerAlg;
  privateKey: CryptoKey;
  publicKey: CryptoKey;
}

/** A public verification key (the relying-site side; from a JWKS). */
export interface VerifyKey {
  kid: string;
  alg: BrokerAlg;
  publicKey: CryptoKey;
}

function genParams(alg: BrokerAlg): EcKeyGenParams | { name: string } {
  return alg === 'EdDSA' ? { name: 'Ed25519' } : { name: 'ECDSA', namedCurve: 'P-256' };
}
function importParams(alg: BrokerAlg): EcKeyImportParams | { name: string } {
  return alg === 'EdDSA' ? { name: 'Ed25519' } : { name: 'ECDSA', namedCurve: 'P-256' };
}
function sigParams(alg: BrokerAlg): EcdsaParams | { name: string } {
  return alg === 'EdDSA' ? { name: 'Ed25519' } : { name: 'ECDSA', hash: 'SHA-256' };
}

function randomB64url(byteLen: number): string {
  const b = new Uint8Array(byteLen);
  globalThis.crypto.getRandomValues(b);
  return base64urlEncode(b);
}

/** Copy into a fresh ArrayBuffer-backed view (Web Crypto BufferSource typing). */
function freshBytes(u: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(u.byteLength);
  out.set(u);
  return out;
}

/** Generate a broker signing keypair. EdDSA (Ed25519) by default; ES256 fallback. */
export async function generateBrokerKeypair(alg: BrokerAlg = 'EdDSA'): Promise<BrokerSigner> {
  const kp = (await globalThis.crypto.subtle.generateKey(genParams(alg) as AlgorithmIdentifier, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair;
  return { kid: randomB64url(8), alg, privateKey: kp.privateKey, publicKey: kp.publicKey };
}

export interface MintAgentSessionInput {
  sub: CanonicalAgentId;
  principal: CredentialPrincipal;
  assurance: Assurance;
  /** Relying-site client_id (exact-match audience). */
  aud: string;
  /** The Connect origin. */
  iss: string;
  ttlSeconds: number;
  now?: () => number;
  jti?: string;
  /** Per-subject derivation rotation (Google × KMS custody, spec 235 §5b). Carried so the custody
   *  gate derives the matching per-subject key. Omitted for non-rotated sessions. */
  rotation?: number;
}

/** Mint a signed AgentSession (asymmetric). */
export async function mintAgentSession(input: MintAgentSessionInput, signer: BrokerSigner): Promise<string> {
  const nowSec = Math.floor((input.now?.() ?? Date.now()) / 1000);
  const payload: AgentSession = {
    sub: input.sub,
    principal: input.principal,
    assurance: input.assurance,
    aud: input.aud,
    iss: input.iss,
    iat: nowSec,
    exp: nowSec + input.ttlSeconds,
    jti: input.jti ?? randomB64url(12),
    ...(input.rotation ? { rotation: input.rotation } : {}),
  };
  const header = { alg: signer.alg, kid: signer.kid, typ: 'JWT' };
  const enc = new TextEncoder();
  const signingInput = `${base64urlEncode(enc.encode(JSON.stringify(header)))}.${base64urlEncode(enc.encode(JSON.stringify(payload)))}`;
  const sig = await globalThis.crypto.subtle.sign(
    sigParams(signer.alg) as AlgorithmIdentifier,
    signer.privateKey,
    new TextEncoder().encode(signingInput),
  );
  return `${signingInput}.${base64urlEncode(new Uint8Array(sig))}`;
}

export type VerifyResult = { ok: true; session: AgentSession } | { ok: false; reason: string };

export interface VerifyOpts {
  keys: VerifyKey[];
  /**
   * Audience expected for this AgentSession. **Required** (H7-B.4 closure of
   * PKG-CONNECT-001-sec). The legacy optional form let a caller verify any
   * AgentSession against any audience-A token mistakenly accepted at
   * audience-B. Aligns with `verifyIdToken` which already required this.
   */
  expectedAud: string;
  expectedIss?: string;
  now?: () => number;
  /**
   * H7-B.4: explicit `iat` clock-skew tolerance in seconds. Default 30.
   * Tokens whose `iat` is more than `clockSkewSec` in the future are
   * rejected (closes PKG-CONNECT-002 — future-dated tokens were accepted).
   */
  clockSkewSec?: number;
}

/** Verify an AgentSession. Alg is PINNED to the key (by kid), never the token's header. */
export async function verifyAgentSession(token: string, opts: VerifyOpts): Promise<VerifyResult> {
  const parts = token.split('.');
  if (parts.length !== 3) return { ok: false, reason: 'not a 3-part JWT' };
  const [h, p, s] = parts as [string, string, string];

  let header: { alg?: string; kid?: string };
  let payload: AgentSession & { owner?: unknown };
  try {
    header = JSON.parse(new TextDecoder().decode(base64urlDecode(h)));
    payload = JSON.parse(new TextDecoder().decode(base64urlDecode(p)));
  } catch {
    return { ok: false, reason: 'header/payload not valid JSON' };
  }

  const key = opts.keys.find((k) => k.kid === header.kid);
  if (!key) return { ok: false, reason: `no key for kid "${header.kid}"` };
  // Pin alg to the key — rejects alg-confusion + alg:none.
  if (header.alg !== key.alg) return { ok: false, reason: `alg "${header.alg}" does not match key alg "${key.alg}"` };
  // iss-first (so an HS BrokerSession token can never enter this verifier).
  if (opts.expectedIss && payload.iss !== opts.expectedIss) return { ok: false, reason: 'iss mismatch' };

  const valid = await globalThis.crypto.subtle.verify(
    sigParams(key.alg) as AlgorithmIdentifier,
    key.publicKey,
    freshBytes(base64urlDecode(s)),
    new TextEncoder().encode(`${h}.${p}`),
  );
  if (!valid) return { ok: false, reason: 'signature invalid' };

  // H7-B.4: expectedAud is required (PKG-CONNECT-001-sec closure). The legacy
  // optional form let callers verify any AgentSession against any audience.
  if (typeof opts.expectedAud !== 'string' || opts.expectedAud.length === 0) {
    return { ok: false, reason: 'expectedAud is required (H7-B.4)' };
  }
  if (payload.aud !== opts.expectedAud) return { ok: false, reason: 'aud mismatch' };
  const nowSec = Math.floor((opts.now?.() ?? Date.now()) / 1000);
  if (typeof payload.exp !== 'number' || payload.exp <= nowSec) return { ok: false, reason: 'expired' };
  // H7-B.4: reject future-dated `iat` beyond clock-skew tolerance (PKG-CONNECT-002).
  const clockSkewSec = opts.clockSkewSec ?? 30;
  if (typeof (payload as { iat?: unknown }).iat === 'number') {
    const iat = (payload as { iat: number }).iat;
    if (iat > nowSec + clockSkewSec) return { ok: false, reason: 'iat in future beyond clock skew' };
  }
  if ((payload as { owner?: unknown }).owner !== undefined) return { ok: false, reason: 'AgentSession must not carry an owner field (ADR-0016)' };

  return { ok: true, session: payload as AgentSession };
}

// ─── OIDC id_token + PKCE (spec 230) ──────────────────────────────────
//
// A standards-shaped OpenID Connect ID token, signed with the SAME broker key +
// verified via JWKS. DISTINCT from the AgentSession (which also carries
// principal/assurance/jti): the id_token is the boring-standard "who is this"
// assertion. `sub` + `canonical_agent_id` are the CAIP-10 canonical agent id
// (ADR-0010/0016 — NEVER an email); `agent_name` is the additive agent-native
// claim. Authority is NOT here — it rides a separate scoped grant (ADR-0019),
// kept out of this package by the vocabulary firewall.

export interface OidcIdToken {
  iss: string;
  sub: CanonicalAgentId;
  aud: string;
  iat: number;
  exp: number;
  nonce?: string;
  agent_name?: string;
  canonical_agent_id: CanonicalAgentId;
}

/**
 * @internal — broker-internal mint shape. **Do not call from relying-app
 * code** (app-level SEC-001/SEC-002 root cause). The bound surface is
 * {@link BoundMintIdTokenInput} + {@link mintBoundIdToken} (H7-B.5 closure
 * of PKG-connect-001-arch). The two-flow split keeps the broker's internal
 * mint distinct from any cross-origin enrollment mint a relying app might
 * attempt.
 */
export interface MintIdTokenInput {
  iss: string;
  sub: CanonicalAgentId;
  aud: string;
  ttlSeconds: number;
  nonce?: string;
  agentName?: string;
  now?: () => number;
}

/**
 * H7-B.5 (PKG-connect-001-arch closure) — the **bound** mint surface.
 *
 * Every id_token issued in response to a cross-origin enrollment grant MUST
 * carry binding fields tying the token to:
 *
 *   - `enrollmentGrantId` — the server-minted grant the user authorized
 *     (closes the SEC-001 app-level root cause: tokens issued without
 *     reference to an in-flight grant can be replayed to any registered RP).
 *   - `delegationHash` — keccak256 of the issued scoped delegation
 *     (closes SEC-002 lateral-movement: tokens become tied to the exact
 *     delegation, not just `{aud, sub}`).
 *
 * Relying apps verify these via {@link verifyEnrollmentGrantBinding} after
 * a standard {@link verifyIdToken} pass.
 */
export interface BoundMintIdTokenInput extends MintIdTokenInput {
  /** Server-minted grant id this mint is authorized by (spec 230 §4.2). */
  enrollmentGrantId: string;
  /** keccak256 of the scoped delegation accompanying this enrollment. */
  delegationHash: `0x${string}`;
}

/**
 * @internal — mints an OIDC id_token signed with the broker key. Used by
 * the broker's own re-auth path where no enrollment grant exists.
 *
 * Cross-origin enrollment **MUST** use {@link mintBoundIdToken} which
 * additionally encodes `enrollment_grant_id` + `delegation_hash` so the
 * relying app can verify the bind via {@link verifyEnrollmentGrantBinding}.
 *
 * `canonical_agent_id` mirrors `sub`.
 */
export async function mintIdToken(input: MintIdTokenInput, signer: BrokerSigner): Promise<string> {
  const nowSec = Math.floor((input.now?.() ?? Date.now()) / 1000);
  const payload: OidcIdToken = {
    iss: input.iss,
    sub: input.sub,
    aud: input.aud,
    iat: nowSec,
    exp: nowSec + input.ttlSeconds,
    canonical_agent_id: input.sub,
    ...(input.nonce ? { nonce: input.nonce } : {}),
    ...(input.agentName ? { agent_name: input.agentName } : {}),
  };
  const header = { alg: signer.alg, kid: signer.kid, typ: 'JWT' };
  const enc = new TextEncoder();
  const signingInput = `${base64urlEncode(enc.encode(JSON.stringify(header)))}.${base64urlEncode(enc.encode(JSON.stringify(payload)))}`;
  const sig = await globalThis.crypto.subtle.sign(sigParams(signer.alg) as AlgorithmIdentifier, signer.privateKey, enc.encode(signingInput));
  return `${signingInput}.${base64urlEncode(new Uint8Array(sig))}`;
}

/**
 * H7-B.5 — mint an id_token bound to a server-minted enrollment grant +
 * a scoped delegation hash. The two fields land on the wire as
 * `enrollment_grant_id` + `delegation_hash` claims. Closes the package-side
 * gap that let app-level SEC-001/SEC-002 ship.
 */
export async function mintBoundIdToken(
  input: BoundMintIdTokenInput,
  signer: BrokerSigner,
): Promise<string> {
  const nowSec = Math.floor((input.now?.() ?? Date.now()) / 1000);
  const payload: OidcIdToken & {
    enrollment_grant_id: string;
    delegation_hash: `0x${string}`;
  } = {
    iss: input.iss,
    sub: input.sub,
    aud: input.aud,
    iat: nowSec,
    exp: nowSec + input.ttlSeconds,
    canonical_agent_id: input.sub,
    enrollment_grant_id: input.enrollmentGrantId,
    delegation_hash: input.delegationHash,
    ...(input.nonce ? { nonce: input.nonce } : {}),
    ...(input.agentName ? { agent_name: input.agentName } : {}),
  };
  const header = { alg: signer.alg, kid: signer.kid, typ: 'JWT' };
  const enc = new TextEncoder();
  const signingInput = `${base64urlEncode(enc.encode(JSON.stringify(header)))}.${base64urlEncode(enc.encode(JSON.stringify(payload)))}`;
  const sig = await globalThis.crypto.subtle.sign(sigParams(signer.alg) as AlgorithmIdentifier, signer.privateKey, enc.encode(signingInput));
  return `${signingInput}.${base64urlEncode(new Uint8Array(sig))}`;
}

/**
 * H7-B.5 — relying-app helper. After a successful {@link verifyIdToken},
 * pass the verified token + the expected binding (the grant id the app
 * just consumed + the keccak256 of the scoped delegation it received).
 *
 * Returns `{ ok: true }` only when both bindings match. Off-chain replay
 * of a token issued for a different grant or against a different delegation
 * (the SEC-001 / SEC-002 vectors) fails with a precise reason.
 */
export function verifyEnrollmentGrantBinding(
  token: string,
  expected: { enrollmentGrantId: string; delegationHash: `0x${string}` },
):
  | { ok: true }
  | { ok: false; reason: 'malformed' | 'missing-grant-id' | 'grant-id-mismatch' | 'missing-delegation-hash' | 'delegation-hash-mismatch' } {
  const parts = token.split('.');
  if (parts.length !== 3) return { ok: false, reason: 'malformed' };
  let payload: { enrollment_grant_id?: unknown; delegation_hash?: unknown };
  try {
    payload = JSON.parse(new TextDecoder().decode(base64urlDecode(parts[1]!)));
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (typeof payload.enrollment_grant_id !== 'string') {
    return { ok: false, reason: 'missing-grant-id' };
  }
  if (payload.enrollment_grant_id !== expected.enrollmentGrantId) {
    return { ok: false, reason: 'grant-id-mismatch' };
  }
  if (typeof payload.delegation_hash !== 'string') {
    return { ok: false, reason: 'missing-delegation-hash' };
  }
  if ((payload.delegation_hash as string).toLowerCase() !== expected.delegationHash.toLowerCase()) {
    return { ok: false, reason: 'delegation-hash-mismatch' };
  }
  return { ok: true };
}

export type VerifyIdTokenResult = { ok: true; claims: OidcIdToken } | { ok: false; reason: string };

export interface VerifyIdTokenOpts {
  keys: VerifyKey[];
  expectedIss: string;
  expectedAud: string;
  expectedNonce?: string;
  now?: () => number;
}

/** Verify an OIDC id_token. Alg PINNED to the key by `kid` (rejects alg:none/confusion);
 *  `iss`/`aud` exact-match; `nonce` checked when expected; `exp` enforced. */
export async function verifyIdToken(token: string, opts: VerifyIdTokenOpts): Promise<VerifyIdTokenResult> {
  const parts = token.split('.');
  if (parts.length !== 3) return { ok: false, reason: 'not a 3-part JWT' };
  const [h, p, s] = parts as [string, string, string];
  let header: { alg?: string; kid?: string };
  let claims: OidcIdToken;
  try {
    header = JSON.parse(new TextDecoder().decode(base64urlDecode(h)));
    claims = JSON.parse(new TextDecoder().decode(base64urlDecode(p)));
  } catch {
    return { ok: false, reason: 'header/payload not valid JSON' };
  }
  const key = opts.keys.find((k) => k.kid === header.kid);
  if (!key) return { ok: false, reason: `no key for kid "${header.kid}"` };
  if (header.alg !== key.alg) return { ok: false, reason: `alg "${header.alg}" does not match key alg "${key.alg}"` };
  if (claims.iss !== opts.expectedIss) return { ok: false, reason: 'iss mismatch' };
  const valid = await globalThis.crypto.subtle.verify(
    sigParams(key.alg) as AlgorithmIdentifier,
    key.publicKey,
    freshBytes(base64urlDecode(s)),
    new TextEncoder().encode(`${h}.${p}`),
  );
  if (!valid) return { ok: false, reason: 'signature invalid' };
  if (claims.aud !== opts.expectedAud) return { ok: false, reason: 'aud mismatch' };
  if (opts.expectedNonce !== undefined && claims.nonce !== opts.expectedNonce) return { ok: false, reason: 'nonce mismatch' };
  const nowSec = Math.floor((opts.now?.() ?? Date.now()) / 1000);
  if (typeof claims.exp !== 'number' || claims.exp <= nowSec) return { ok: false, reason: 'expired' };
  return { ok: true, claims };
}

/** PKCE S256 verification (RFC 7636): `base64url(SHA-256(verifier)) === challenge`.
 *  Used at the token endpoint to bind a code to the client's `code_verifier`. */
export async function verifyPkceS256(codeVerifier: string, codeChallenge: string): Promise<boolean> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(codeVerifier));
  return base64urlEncode(new Uint8Array(digest)) === codeChallenge;
}

type PublicJwk = JsonWebKey & { kid: string; alg: string; use: string };

/** Export a signer's public key as a JWKS entry. */
export async function exportPublicJwk(k: { kid: string; alg: BrokerAlg; publicKey: CryptoKey }): Promise<PublicJwk> {
  const jwk = await globalThis.crypto.subtle.exportKey('jwk', k.publicKey);
  return { ...jwk, kid: k.kid, alg: k.alg, use: 'sig' };
}

/** Publish a JWKS document for relying sites to fetch + verify against. */
export async function publishJwks(keys: Array<{ kid: string; alg: BrokerAlg; publicKey: CryptoKey }>): Promise<{ keys: PublicJwk[] }> {
  return { keys: await Promise.all(keys.map(exportPublicJwk)) };
}

/** Import a JWKS document into verification keys (relying-site side). */
export async function importJwks(jwks: { keys: Array<JsonWebKey & { kid?: string; alg?: string }> }): Promise<VerifyKey[]> {
  const out: VerifyKey[] = [];
  for (const jwk of jwks.keys) {
    const alg = jwk.alg;
    if (alg !== 'EdDSA' && alg !== 'ES256') continue; // only the broker's algs
    const publicKey = await globalThis.crypto.subtle.importKey(
      'jwk',
      jwk,
      importParams(alg) as AlgorithmIdentifier,
      false,
      ['verify'],
    );
    out.push({ kid: jwk.kid ?? '', alg, publicKey });
  }
  return out;
}
