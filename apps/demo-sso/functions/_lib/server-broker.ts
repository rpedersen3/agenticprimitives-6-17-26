// Shared helper for the server-side (Pages Function) Connect broker. Files/dirs
// starting with `_` are NOT routed by Pages, so this is a plain module.
//
// The broker SIGNING KEY lives server-side here (an env secret), never in the
// browser — that is the whole point of the broker being a server (ADR-0014).
// The directory + issuance/verification logic is the SAME broker-core the
// in-browser demo uses; only the key source + the transport differ.

import { publishJwks } from '@agenticprimitives/connect';
import { signerFromPrivateJwk } from '../../src/lib/broker-core';
import { buildRealDirectory } from '../../src/lib/real-directory';
import { createKvIndexer } from '../../src/lib/kv-indexer';

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
  /** Single-use auth-code store (CN-9) + the persistent login-facet index
   *  (`facet:` keys; spec 227 §5). `[[kv_namespaces]]` binding in wrangler.toml. */
  AUTH_CODES: KVNamespace;
  /** Base Sepolia RPC for on-chain resolution. Defaults to the public endpoint. */
  RPC_URL?: string;
  /** Comma-separated exact-match relying-site redirect URIs (CN-1). */
  REDIRECT_URI_ALLOWLIST?: string;

  // ─── Google OIDC (real). See OIDC-SETUP.md. ────────────────────────
  /** Google OAuth 2.0 Client ID (public-ish; set as a Pages env var/secret). */
  GOOGLE_CLIENT_ID?: string;
  /** Google OAuth 2.0 Client SECRET — server-side only; `wrangler pages secret put`. */
  GOOGLE_CLIENT_SECRET?: string;
  /** Must EXACTLY match the redirect URI registered in Google Cloud Console,
   *  e.g. https://<your-connect-origin>/oidc/google/callback */
  GOOGLE_REDIRECT_URI?: string;
}

/** Pages Function context (the subset these handlers use). */
export interface FnContext {
  request: Request;
  env: Env;
}

export async function getServer(env: Env) {
  if (!env.BROKER_PRIVATE_JWK) {
    throw new Error('BROKER_PRIVATE_JWK is not set. Generate one (see CLAUDE.md) and `wrangler pages secret put BROKER_PRIVATE_JWK`.');
  }
  const signer = await signerFromPrivateJwk(JSON.parse(env.BROKER_PRIVATE_JWK), env.BROKER_KID ?? 'broker-1');
  // Real Base Sepolia resolution (spec 227 §5): live naming + on-chain custody +
  // a persistent KV login-facet index. Replaces the in-memory demo directory.
  const directory = buildRealDirectory({ rpcUrl: env.RPC_URL, indexer: createKvIndexer(env.AUTH_CODES) });
  const jwks = await publishJwks([signer]);
  return { signer, directory, jwks };
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
