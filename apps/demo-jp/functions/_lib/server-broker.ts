// Server-side (Pages Function) broker for demo-org — the relying-site IdP.
//
// The broker SIGNING KEY lives server-side here (an env secret), never in the
// browser (ADR-0014). demo-org is name-first + on-chain custody only: it mints
// `aud='demo-jp'` AgentSessions after verifying a credential is a custodian of
// the named agent. No directory / OIDC / PII machinery (spec 229).
import { publishJwks, type BrokerSigner, type BrokerAlg } from '@agenticprimitives/connect';

/** Minimal Cloudflare KV surface (avoids a @cloudflare/workers-types dep). */
export interface KVNamespace {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface Env {
  /** ES256 (ECDSA P-256) PRIVATE JWK (JSON string). Secret: `wrangler pages secret put BROKER_PRIVATE_JWK`. */
  BROKER_PRIVATE_JWK: string;
  /** Key id published in the JWKS. */
  BROKER_KID?: string;
  /** Single-use nonce / passkey-challenge store. `[[kv_namespaces]]` binding in wrangler.toml. */
  AUTH_CODES: KVNamespace;
  /** Base Sepolia RPC for on-chain resolution. Defaults to the public endpoint. */
  RPC_URL?: string;
}

/** Pages Function context (the subset these handlers use). */
export interface FnContext {
  request: Request;
  env: Env;
}

/** Build a Web Crypto signer from the ES256 private JWK (Workers-safe; no Ed25519 on workerd). */
async function signerFromPrivateJwk(
  jwk: JsonWebKey & { x?: string; y?: string },
  kid: string,
): Promise<BrokerSigner> {
  const alg: BrokerAlg = 'ES256';
  const params: EcKeyImportParams = { name: 'ECDSA', namedCurve: 'P-256' };
  const privateKey = await crypto.subtle.importKey('jwk', jwk, params, false, ['sign']);
  const publicKey = await crypto.subtle.importKey(
    'jwk',
    { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y } as JsonWebKey,
    params,
    true,
    ['verify'],
  );
  return { kid, alg, privateKey, publicKey };
}

export async function getServer(env: Env) {
  if (!env.BROKER_PRIVATE_JWK) {
    throw new Error('BROKER_PRIVATE_JWK is not set. Generate one (see CLAUDE.md) and `wrangler pages secret put BROKER_PRIVATE_JWK`.');
  }
  const signer = await signerFromPrivateJwk(JSON.parse(env.BROKER_PRIVATE_JWK), env.BROKER_KID ?? 'broker-1');
  const jwks = await publishJwks([signer]);
  return { signer, jwks };
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
