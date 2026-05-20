// GcpKmsSigner — production GCP Cloud KMS asymmetric-sign backend.
//
// Cloudflare-Workers-compatible: drives the Cloud KMS REST API directly via
// fetch + Web Crypto for JWT auth. The @google-cloud/kms SDK uses gRPC and
// won't run on Workers; this implementation avoids gRPC entirely.
//
// Auth: service-account JSON → RS256 JWT (signed via crypto.subtle) →
//   exchanged for an OAuth access token at oauth2.googleapis.com/token.
//   Token cached with expiry buffer.
//
// Signing: POST cryptoKeyVersions/N:asymmetricSign with `digest.sha256`
//   carrying our 32-byte keccak256 digest. Cloud KMS signs it as-is
//   (does NOT re-hash) for `EC_SIGN_SECP256K1_SHA256` keys. Response is
//   DER-encoded ECDSA (r,s). We:
//     1. parse DER → (r, s)
//     2. normalize s to low-s form (EIP-2)
//     3. search recovery byte by trying v∈{27,28} against the known pubkey
//       (Cloud KMS doesn't return the recovery bit)
//
// Public key: GET cryptoKeyVersions/N/publicKey returns PEM SPKI. We parse
//   the trailing 65-byte uncompressed point (0x04||X||Y), compute
//   keccak256(X||Y), take last 20 bytes → Ethereum address. Cached forever.
//
// GcpKmsProvider (envelope encryption via GCP KMS Encrypt/Decrypt) remains a
// stub — that's a separate v0.2 follow-up. The signer covers the production
// path for the agent's master-key requirement.

import { secp256k1 } from '@noble/curves/secp256k1';
import { keccak_256 } from '@noble/hashes/sha3';
import { bytesToHex, type Address } from 'viem';
import { buildEvent, type AuditSink } from '@agenticprimitives/audit';
import type { A2AKeyProvider, KmsAccountBackend } from '../types';
import { canonicalContextBytes } from '../aad';

// ─────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const CLOUDKMS_SCOPE = 'https://www.googleapis.com/auth/cloudkms';
const CLOUDKMS_BASE = 'https://cloudkms.googleapis.com/v1/';
const TOKEN_EXPIRY_BUFFER_SECONDS = 60;
const SECP256K1_N = secp256k1.CURVE.n;
const SECP256K1_HALF_N = SECP256K1_N >> 1n;

// ─────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────

interface ServiceAccount {
  client_email: string;
  /** PEM-encoded PKCS#8 RSA private key. */
  private_key: string;
  project_id?: string;
}

interface CachedToken {
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

export interface GcpKmsSignerOpts {
  /**
   * Full Cloud KMS resource name of the key version to sign with, e.g.
   * `projects/<P>/locations/<L>/keyRings/<R>/cryptoKeys/<K>/cryptoKeyVersions/<V>`.
   * Algorithm must be `EC_SIGN_SECP256K1_SHA256`.
   */
  cryptoKeyVersionName: string;
  /** Raw JSON string of the service-account key file. */
  serviceAccountJson: string;
}

// ─────────────────────────────────────────────────────────────────────
// Base64 / PEM helpers
// ─────────────────────────────────────────────────────────────────────

export function base64UrlEncode(bytes: Uint8Array): string {
  let str = '';
  for (let i = 0; i < bytes.length; i++) str += String.fromCharCode(bytes[i]!);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64Decode(s: string): Uint8Array {
  const binary = atob(s);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

function base64Encode(bytes: Uint8Array): string {
  let str = '';
  for (let i = 0; i < bytes.length; i++) str += String.fromCharCode(bytes[i]!);
  return btoa(str);
}

export function pemToDer(pem: string): Uint8Array {
  const lines = pem
    .split('\n')
    .filter((l) => !l.startsWith('-----') && l.trim().length > 0)
    .join('');
  return base64Decode(lines);
}

// ─────────────────────────────────────────────────────────────────────
// JWT signing + token exchange
// ─────────────────────────────────────────────────────────────────────

export async function signJwt(serviceAccount: ServiceAccount, scope: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const payload = {
    iss: serviceAccount.client_email,
    scope,
    aud: GOOGLE_TOKEN_URL,
    iat: now,
    exp: now + 3600,
  };
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
  const signature = await globalThis.crypto.subtle.sign(
    { name: 'RSASSA-PKCS1-v1_5' },
    key,
    encoder.encode(signingInput),
  );
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

// ─────────────────────────────────────────────────────────────────────
// Cloud KMS REST calls
// ─────────────────────────────────────────────────────────────────────

async function callKms<T>(
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

// ─────────────────────────────────────────────────────────────────────
// SPKI public-key parsing (uncompressed secp256k1 point extraction)
// ─────────────────────────────────────────────────────────────────────

export function parseSpkiUncompressedSecp256k1PubKey(spkiDer: Uint8Array): Uint8Array {
  // The SPKI structure ends with a BIT STRING containing the public key.
  // For secp256k1, the public key is 65 bytes: 0x04 || X(32) || Y(32).
  // The BIT STRING wrapping adds a single zero "unused bits" byte before
  // the 0x04 marker. So the last 66 bytes of the DER should be:
  //   [0x00 (unused bits)] [0x04 (uncompressed marker)] [X 32 bytes] [Y 32 bytes]
  if (spkiDer.length < 66) {
    throw new Error(`SPKI too short to contain uncompressed secp256k1 pubkey: ${spkiDer.length} bytes`);
  }
  const tail = spkiDer.slice(spkiDer.length - 65);
  const marker = tail[0];
  if (marker !== 0x04) {
    throw new Error(
      `SPKI does not end with uncompressed point marker (0x04). Wrong key algorithm? ` +
        `Found 0x${(marker ?? 0).toString(16).padStart(2, '0')} at position ${spkiDer.length - 65}.`,
    );
  }
  return tail;
}

export function publicKeyToAddress(pubKey65: Uint8Array): Address {
  // pubKey65: 0x04 || X(32) || Y(32). Strip prefix; keccak256 over X||Y; last 20 bytes.
  const raw = pubKey65.slice(1);
  const hash = keccak_256(raw);
  return bytesToHex(hash.slice(12)) as Address;
}

// ─────────────────────────────────────────────────────────────────────
// DER signature parsing + low-s + recovery byte search
// ─────────────────────────────────────────────────────────────────────

export function parseDerEcdsa(der: Uint8Array): { r: bigint; s: bigint } {
  const at = (idx: number): number => {
    const b = der[idx];
    if (b === undefined) throw new Error(`DER: unexpected end of buffer at offset ${idx}`);
    return b;
  };
  let i = 0;
  if (at(i++) !== 0x30) throw new Error('DER: expected SEQUENCE tag (0x30)');
  // Skip length. Handle short and long form.
  const lenByte = at(i++);
  if (lenByte & 0x80) {
    const lenBytes = lenByte & 0x7f;
    i += lenBytes;
  }
  if (at(i++) !== 0x02) throw new Error('DER: expected INTEGER tag for r');
  const rLen = at(i++);
  const rBytes = der.slice(i, i + rLen);
  i += rLen;
  if (at(i++) !== 0x02) throw new Error('DER: expected INTEGER tag for s');
  const sLen = at(i++);
  const sBytes = der.slice(i, i + sLen);
  return { r: bytesToBigInt(rBytes), s: bytesToBigInt(sBytes) };
}

function bytesToBigInt(bytes: Uint8Array): bigint {
  let n = 0n;
  for (const b of bytes) n = (n << 8n) | BigInt(b);
  return n;
}

export function bigIntTo32Bytes(n: bigint): Uint8Array {
  const out = new Uint8Array(32);
  let v = n;
  for (let i = 31; i >= 0; i--) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}

export function normalizeLowS(s: bigint): bigint {
  return s > SECP256K1_HALF_N ? SECP256K1_N - s : s;
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export function findRecoveryByte(
  r: bigint,
  s: bigint,
  digest: Uint8Array,
  knownPubKey65: Uint8Array,
): number {
  const rBytes = bigIntTo32Bytes(r);
  const sBytes = bigIntTo32Bytes(s);
  const compact = new Uint8Array(64);
  compact.set(rBytes, 0);
  compact.set(sBytes, 32);
  const attempts: string[] = [];
  for (let recovery = 0; recovery < 2; recovery++) {
    try {
      const sig = secp256k1.Signature.fromCompact(compact).addRecoveryBit(recovery);
      const recovered = sig.recoverPublicKey(digest).toRawBytes(false);
      attempts.push(`v=${recovery + 27} recovered=${bytesToHex(recovered)}`);
      if (bytesEqual(recovered, knownPubKey65)) return recovery + 27;
    } catch (e) {
      attempts.push(`v=${recovery + 27} threw ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  // eslint-disable-next-line no-console
  console.error('[gcp-kms findRecoveryByte] mismatch:', {
    digest: bytesToHex(digest),
    r: bytesToHex(rBytes),
    s: bytesToHex(sBytes),
    knownPubKey: bytesToHex(knownPubKey65),
    attempts,
  });
  throw new Error(
    'Recovery byte search failed: neither v=27 nor v=28 recovers the known public key. ' +
      attempts.join(' | '),
  );
}

// ─────────────────────────────────────────────────────────────────────
// GcpKmsSigner — the public class
// ─────────────────────────────────────────────────────────────────────

export class GcpKmsSigner implements KmsAccountBackend {
  private readonly keyName: string;
  private readonly serviceAccount: ServiceAccount;
  private readonly auditSink?: AuditSink;
  private cachedToken?: CachedToken;
  private cachedPubKey65?: Uint8Array;
  private cachedAddress?: Address;

  constructor(opts?: Partial<GcpKmsSignerOpts> & { auditSink?: AuditSink }) {
    const keyName = opts?.cryptoKeyVersionName ?? process.env.GCP_KMS_KEY_NAME;
    const jsonStr = opts?.serviceAccountJson ?? process.env.GCP_SERVICE_ACCOUNT_JSON;
    this.auditSink = opts?.auditSink;
    if (!keyName) {
      throw new Error(
        'GcpKmsSigner: GCP_KMS_KEY_NAME (projects/<P>/locations/<L>/keyRings/<R>/cryptoKeys/<K>/cryptoKeyVersions/<V>) is required.',
      );
    }
    if (!jsonStr) {
      throw new Error('GcpKmsSigner: GCP_SERVICE_ACCOUNT_JSON (service-account JSON string) is required.');
    }
    let parsed: ServiceAccount;
    try {
      parsed = JSON.parse(jsonStr) as ServiceAccount;
    } catch {
      throw new Error('GcpKmsSigner: GCP_SERVICE_ACCOUNT_JSON is not valid JSON.');
    }
    if (!parsed.client_email || !parsed.private_key) {
      throw new Error('GcpKmsSigner: service-account JSON missing client_email or private_key.');
    }
    this.keyName = keyName;
    this.serviceAccount = parsed;
  }

  private async getAccessToken(): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    if (this.cachedToken && this.cachedToken.expiresAt > now) {
      return this.cachedToken.accessToken;
    }
    this.cachedToken = await fetchAccessToken(this.serviceAccount);
    return this.cachedToken.accessToken;
  }

  private async getPublicKeyBytes(): Promise<Uint8Array> {
    if (this.cachedPubKey65) return this.cachedPubKey65;
    const token = await this.getAccessToken();
    const res = await callKms<PublicKeyResponse>(token, `${this.keyName}/publicKey`);
    // Algorithm guard: signatures from any other curve (e.g. P-256) won't
    // recover to an Ethereum-compatible pubkey. Catch the mistake at first
    // pubkey fetch instead of producing nonsense signatures later.
    if (res.algorithm !== 'EC_SIGN_SECP256K1_SHA256') {
      throw new Error(
        `GcpKmsSigner: key ${this.keyName} has algorithm "${res.algorithm}", but ` +
          `EC_SIGN_SECP256K1_SHA256 is required for Ethereum-compatible signing. ` +
          `Recreate with: gcloud kms keys create <NAME> --purpose=asymmetric-signing ` +
          `--default-algorithm=ec-sign-secp256k1-sha256 --protection-level=hsm. ` +
          `Note: secp256k1 in GCP requires --protection-level=hsm; Software is not ` +
          `supported. The Console dropdown greys out secp256k1 when Software is ` +
          `selected. GCP doesn't allow changing the algorithm or protection level ` +
          `of an existing key.`,
      );
    }
    const spkiDer = pemToDer(res.pem);
    this.cachedPubKey65 = parseSpkiUncompressedSecp256k1PubKey(spkiDer);
    return this.cachedPubKey65;
  }

  async getSignerAddress(): Promise<Address> {
    if (this.cachedAddress) return this.cachedAddress;
    const pub = await this.getPublicKeyBytes();
    this.cachedAddress = publicKeyToAddress(pub);
    return this.cachedAddress;
  }

  async signA2AAction(input: {
    digest: Uint8Array;
    auditContext?: { toolId?: string; sessionId?: string; actionId?: string };
  }): Promise<{ signature: Uint8Array; keyId: string; signerAddress: Address }> {
    if (input.digest.length !== 32) {
      throw new Error(`GcpKmsSigner.signA2AAction expects a 32-byte digest; got ${input.digest.length}.`);
    }
    const [token, pubKey] = await Promise.all([this.getAccessToken(), this.getPublicKeyBytes()]);

    const res = await callKms<AsymmetricSignResponse>(token, `${this.keyName}:asymmetricSign`, {
      method: 'POST',
      body: { digest: { sha256: base64Encode(input.digest) } },
    });
    const derBytes = base64Decode(res.signature);
    const parsed = parseDerEcdsa(derBytes);
    const s = normalizeLowS(parsed.s);
    const v = findRecoveryByte(parsed.r, s, input.digest, pubKey);

    const sig65 = new Uint8Array(65);
    sig65.set(bigIntTo32Bytes(parsed.r), 0);
    sig65.set(bigIntTo32Bytes(s), 32);
    sig65[64] = v;

    const signerAddress = await this.getSignerAddress();
    // Audit emit. Per key-custody CLAUDE.md invariant:
    //   raw sessionId MUST NEVER be logged — hash it.
    if (this.auditSink) {
      const ctx = input.auditContext ?? {};
      try {
        await this.auditSink.write(
          buildEvent({
            action: 'key-custody.sign',
            outcome: 'success',
            actor: { type: 'system', id: 'gcp-kms-signer' },
            subject: { type: 'sign-digest', id: bytesToHex(input.digest) },
            context: {
              keyId: this.keyName,
              signerAddress,
              toolId: ctx.toolId ?? null,
              actionId: ctx.actionId ?? null,
              sessionHash: ctx.sessionId
                ? bytesToHex(keccak_256(new TextEncoder().encode(ctx.sessionId))).slice(0, 18)
                : null,
            },
          }),
        );
      } catch {
        /* fail-soft */
      }
    }

    return {
      signature: sig65,
      keyId: this.keyName,
      signerAddress,
    };
  }
}

// ─────────────────────────────────────────────────────────────────────
// GcpKmsProvider — envelope encryption via Cloud KMS Encrypt/Decrypt.
//
// Generates a 32-byte session data key locally (Web Crypto random), wraps
// it with Cloud KMS :encrypt under the AAD-bound EncryptionContext, returns
// the ciphertext as encryptedDataKey. Decrypt unwraps with the SAME AAD —
// any tampering surfaces as a Cloud KMS error.
//
// Symmetric encrypt-decrypt key (purpose=ENCRYPT_DECRYPT,
// algorithm=GOOGLE_SYMMETRIC_ENCRYPTION). Note this is a DIFFERENT KMS key
// from the secp256k1 signing key — they have different purposes and
// algorithms in GCP. Configure via GCP_KMS_ENCRYPT_KEY_NAME.
//
// Service-account credentials reused from the signer config (same SA needs
// roles/cloudkms.cryptoKeyEncrypterDecrypter on this key).
// ─────────────────────────────────────────────────────────────────────

export interface GcpKmsProviderOpts {
  /**
   * Full Cloud KMS resource name of the symmetric encrypt-decrypt key, e.g.
   * `projects/<P>/locations/<L>/keyRings/<R>/cryptoKeys/<K>`. Note: NO
   * `/cryptoKeyVersions/N` suffix — GCP picks the active version.
   */
  cryptoKeyName: string;
  /** Raw JSON string of the service-account key file. */
  serviceAccountJson: string;
}

interface EncryptResponse {
  ciphertext: string;
  name: string;
}

interface DecryptResponse {
  plaintext: string;
}

export class GcpKmsProvider implements A2AKeyProvider {
  readonly keyVersion = 'gcp-kms:v1';
  private readonly keyName: string;
  private readonly serviceAccount: ServiceAccount;
  private cachedToken?: CachedToken;

  constructor(opts?: Partial<GcpKmsProviderOpts>) {
    const keyName = opts?.cryptoKeyName ?? process.env.GCP_KMS_ENCRYPT_KEY_NAME;
    const jsonStr = opts?.serviceAccountJson ?? process.env.GCP_SERVICE_ACCOUNT_JSON;
    if (!keyName) {
      throw new Error(
        'GcpKmsProvider: GCP_KMS_ENCRYPT_KEY_NAME (projects/<P>/locations/<L>/keyRings/<R>/cryptoKeys/<K>) is required.',
      );
    }
    if (!jsonStr) {
      throw new Error('GcpKmsProvider: GCP_SERVICE_ACCOUNT_JSON (service-account JSON string) is required.');
    }
    let parsed: ServiceAccount;
    try {
      parsed = JSON.parse(jsonStr) as ServiceAccount;
    } catch {
      throw new Error('GcpKmsProvider: GCP_SERVICE_ACCOUNT_JSON is not valid JSON.');
    }
    if (!parsed.client_email || !parsed.private_key) {
      throw new Error('GcpKmsProvider: service-account JSON missing client_email or private_key.');
    }
    this.keyName = keyName;
    this.serviceAccount = parsed;
  }

  private async getAccessToken(): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    if (this.cachedToken && this.cachedToken.expiresAt > now) {
      return this.cachedToken.accessToken;
    }
    this.cachedToken = await fetchAccessToken(this.serviceAccount);
    return this.cachedToken.accessToken;
  }

  async generateSessionDataKey(input: {
    aadContext: Record<string, string>;
  }): Promise<{
    plaintextDataKey: Uint8Array;
    encryptedDataKey: Uint8Array;
    keyId: string;
    keyVersion: string;
  }> {
    const plaintextDataKey = new Uint8Array(32);
    globalThis.crypto.getRandomValues(plaintextDataKey);
    const aadBytes = canonicalContextBytes(input.aadContext);

    const token = await this.getAccessToken();
    const res = await callKms<EncryptResponse>(token, `${this.keyName}:encrypt`, {
      method: 'POST',
      body: {
        plaintext: base64Encode(plaintextDataKey),
        additionalAuthenticatedData: base64Encode(aadBytes),
      },
    });
    const encryptedDataKey = base64Decode(res.ciphertext);

    return {
      plaintextDataKey,
      encryptedDataKey,
      keyId: this.keyName,
      keyVersion: this.keyVersion,
    };
  }

  async decryptSessionDataKey(input: {
    encryptedDataKey: Uint8Array;
    aadContext: Record<string, string>;
    keyId: string;
    keyVersion: string;
  }): Promise<Uint8Array> {
    if (input.keyVersion !== this.keyVersion) {
      throw new Error(
        `GcpKmsProvider: keyVersion mismatch (got "${input.keyVersion}", expected "${this.keyVersion}").`,
      );
    }
    const aadBytes = canonicalContextBytes(input.aadContext);
    const token = await this.getAccessToken();
    const res = await callKms<DecryptResponse>(token, `${this.keyName}:decrypt`, {
      method: 'POST',
      body: {
        ciphertext: base64Encode(input.encryptedDataKey),
        additionalAuthenticatedData: base64Encode(aadBytes),
      },
    });
    return base64Decode(res.plaintext);
  }
}
