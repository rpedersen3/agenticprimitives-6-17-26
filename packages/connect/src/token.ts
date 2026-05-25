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
  expectedIss?: string;
  expectedAud?: string;
  now?: () => number;
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

  if (opts.expectedAud && payload.aud !== opts.expectedAud) return { ok: false, reason: 'aud mismatch' };
  const nowSec = Math.floor((opts.now?.() ?? Date.now()) / 1000);
  if (typeof payload.exp !== 'number' || payload.exp <= nowSec) return { ok: false, reason: 'expired' };
  if ((payload as { owner?: unknown }).owner !== undefined) return { ok: false, reason: 'AgentSession must not carry an owner field (ADR-0016)' };

  return { ok: true, session: payload as AgentSession };
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
