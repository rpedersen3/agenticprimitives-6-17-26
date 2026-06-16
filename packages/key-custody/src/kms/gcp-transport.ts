// GCP Cloud KMS REST transport — the CONSUMER-SAFE, peer-dependency-free transport (spec 276 KCS-D1).
//
// Cloudflare-Workers-compatible: drives the Cloud KMS REST API via fetch +
// Web Crypto for the service-account JWT-bearer flow. The @google-cloud/kms
// SDK uses gRPC and won't run on Workers; this avoids gRPC entirely.
//
// HARD CONSTRAINT (same as secp256k1-core): only Web/Node built-ins +
// `secp256k1-core` (itself @noble-only). NO viem / @agenticprimitives/*.

import { base64UrlEncode, base64Decode, base64Encode, pemToDer, signDigestWithKms, type Hex } from './secp256k1-core.js';

// ── Constants ────────────────────────────────────────────────────────
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const CLOUDKMS_SCOPE = 'https://www.googleapis.com/auth/cloudkms';
const CLOUDKMS_BASE = 'https://cloudkms.googleapis.com/v1/';
const TOKEN_EXPIRY_BUFFER_SECONDS = 60;

// ── Types ──────────────────────────────────────────────────────────────
export interface ServiceAccount {
  client_email: string;
  /** PEM-encoded PKCS#8 RSA private key. */
  private_key: string;
  project_id?: string;
}

export interface CachedToken {
  accessToken: string;
  /** Unix seconds at which the token must be refreshed (already minus buffer). */
  expiresAt: number;
}

interface PublicKeyResponse {
  pem: string;
  algorithm: string;
}

interface AsymmetricSignResponse {
  /** Base64-encoded DER ECDSA signature. */
  signature: string;
}

// ── JWT signing + token exchange ─────────────────────────────────────

export async function signJwt(serviceAccount: ServiceAccount, scope: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = { iss: serviceAccount.client_email, scope, aud: GOOGLE_TOKEN_URL, iat: now, exp: now + 3600 };
  const encoder = new TextEncoder();
  const headerB64 = base64UrlEncode(encoder.encode(JSON.stringify(header)));
  const payloadB64 = base64UrlEncode(encoder.encode(JSON.stringify(payload)));
  const signingInput = `${headerB64}.${payloadB64}`;

  const keyDer = pemToDer(serviceAccount.private_key);
  // Copy into a fresh ArrayBuffer so the typing satisfies BufferSource
  // (TS lib.dom narrowed Uint8Array.buffer to ArrayBufferLike in 5.7).
  const keyBuffer = new ArrayBuffer(keyDer.byteLength);
  new Uint8Array(keyBuffer).set(keyDer);
  const key = await globalThis.crypto.subtle.importKey(
    'pkcs8',
    keyBuffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await globalThis.crypto.subtle.sign({ name: 'RSASSA-PKCS1-v1_5' }, key, encoder.encode(signingInput));
  return `${signingInput}.${base64UrlEncode(new Uint8Array(signature))}`;
}

export async function fetchAccessToken(serviceAccount: ServiceAccount): Promise<CachedToken> {
  const assertion = await signJwt(serviceAccount, CLOUDKMS_SCOPE);
  const body = `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${encodeURIComponent(assertion)}`;
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GCP token exchange failed: HTTP ${res.status}: ${text.slice(0, 300)}`);
  }
  const json = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!json.access_token || typeof json.expires_in !== 'number') {
    throw new Error('GCP token exchange: response missing access_token or expires_in');
  }
  return {
    accessToken: json.access_token,
    expiresAt: Math.floor(Date.now() / 1000) + json.expires_in - TOKEN_EXPIRY_BUFFER_SECONDS,
  };
}

// ── Cloud KMS REST calls ─────────────────────────────────────────────

export async function callKms<T>(
  token: string,
  pathRelativeToBase: string,
  options: { method: 'GET' | 'POST'; body?: unknown } = { method: 'GET' },
): Promise<T> {
  const url = `${CLOUDKMS_BASE}${pathRelativeToBase}`;
  const init: RequestInit = {
    method: options.method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(options.body ? { 'content-type': 'application/json' } : {}),
    },
  };
  if (options.body) init.body = JSON.stringify(options.body);
  const res = await fetch(url, init);
  if (!res.ok) {
    const text = await res.text();
    // Don't leak the Authorization header. URL path is safe to include.
    throw new Error(`Cloud KMS API error: HTTP ${res.status} on ${pathRelativeToBase}: ${text.slice(0, 300)}`);
  }
  return (await res.json()) as T;
}

// ── A token-caching transport + one-shot signer (the ergonomic surface) ──

export interface GcpKmsTransport {
  /** Fetch the key version's SPKI PEM; asserts the secp256k1 algorithm. */
  getPublicKeyPem(cryptoKeyVersionName: string): Promise<string>;
  /** POST `:asymmetricSign` for a 32-byte digest; returns the DER signature bytes. */
  asymmetricSign(cryptoKeyVersionName: string, digest: Uint8Array): Promise<Uint8Array>;
}

/** Build a token-caching Cloud KMS transport from service-account JSON. Peer-dep-free. */
export function createGcpKmsTransport(serviceAccount: ServiceAccount): GcpKmsTransport {
  let cached: CachedToken | undefined;
  const token = async (): Promise<string> => {
    const now = Math.floor(Date.now() / 1000);
    if (cached && cached.expiresAt > now) return cached.accessToken;
    cached = await fetchAccessToken(serviceAccount);
    return cached.accessToken;
  };
  return {
    async getPublicKeyPem(keyName) {
      const res = await callKms<PublicKeyResponse>(await token(), `${keyName}/publicKey`);
      if (res.algorithm !== 'EC_SIGN_SECP256K1_SHA256') {
        throw new Error(
          `Cloud KMS key ${keyName} has algorithm "${res.algorithm}", but EC_SIGN_SECP256K1_SHA256 is ` +
            `required for Ethereum-compatible signing. Recreate with --default-algorithm=ec-sign-secp256k1-sha256 ` +
            `--protection-level=hsm (secp256k1 requires HSM in GCP).`,
        );
      }
      return res.pem;
    },
    async asymmetricSign(keyName, digest) {
      const res = await callKms<AsymmetricSignResponse>(await token(), `${keyName}:asymmetricSign`, {
        method: 'POST',
        body: { digest: { sha256: base64Encode(digest) } },
      });
      return base64Decode(res.signature);
    },
  };
}

/** One-shot: sign a 32-byte digest with a Cloud KMS secp256k1 key → Ethereum `(r,s,v)` 0x hex.
 *  This is the surface an external consumer imports instead of inlining a KMS signer (spec 276). */
export async function gcpSignDigest(opts: {
  serviceAccount: ServiceAccount;
  cryptoKeyVersionName: string;
  digest: Uint8Array;
  /** Pass a cached transport to reuse the access token across calls. */
  transport?: GcpKmsTransport;
}): Promise<Hex> {
  const transport = opts.transport ?? createGcpKmsTransport(opts.serviceAccount);
  const publicKeyPem = await transport.getPublicKeyPem(opts.cryptoKeyVersionName);
  return signDigestWithKms({
    digest: opts.digest,
    publicKeyPem,
    asymmetricSign: (d) => transport.asymmetricSign(opts.cryptoKeyVersionName, d),
  });
}
