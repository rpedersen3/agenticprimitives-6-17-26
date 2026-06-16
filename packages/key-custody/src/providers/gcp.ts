// GcpKmsSigner / GcpKmsProvider — production GCP Cloud KMS backends.
//
// The signing CRYPTO + REST transport now live in the consumer-safe, peer-
// dependency-free core (`../kms/secp256k1-core`, `../kms/gcp-transport`,
// barrel `../kms/kms-core`) so external apps can import the primitive instead
// of inlining it (spec 276). THIS file is the thin, audited, viem-typed
// wrapper: it adds the `KmsAccountBackend` shape, viem `Address` typing, and
// the optional audit sink (`key-custody.sign`). One implementation, two
// surfaces — no second KMS path.
//
// GcpKmsProvider (envelope encryption via GCP KMS Encrypt/Decrypt) remains a
// stub — that's a separate v0.2 follow-up. The signer covers the production
// path for the agent's master-key requirement.

import { keccak_256 } from '@noble/hashes/sha3.js';
import type { Address } from 'viem';
import { buildEvent, type AuditSink } from '@agenticprimitives/audit';
import type { A2AKeyProvider, KmsAccountBackend } from '../types';
import { canonicalContextBytes } from '../aad';
import {
  bytesToHex,
  base64Decode,
  base64Encode,
  pemToDer,
  bigIntTo32Bytes,
  parseDerEcdsa,
  normalizeLowS,
  parseSpkiUncompressedSecp256k1PubKey,
  publicKeyToAddress,
  findRecoveryByte,
} from '../kms/secp256k1-core.js';
import {
  type ServiceAccount,
  type CachedToken,
  type GcpKmsTransport,
  fetchAccessToken,
  callKms,
  createGcpKmsTransport,
} from '../kms/gcp-transport.js';

// Re-export the consumer-safe helpers under their established names so existing
// importers (unit tests + any downstream) keep resolving them from this module.
// New code should prefer the `@agenticprimitives/key-custody/kms-core` subpath.
export {
  base64UrlEncode,
  pemToDer,
  parseDerEcdsa,
  normalizeLowS,
  bigIntTo32Bytes,
  parseSpkiUncompressedSecp256k1PubKey,
  publicKeyToAddress,
  findRecoveryByte,
} from '../kms/secp256k1-core.js';
export { signJwt, fetchAccessToken } from '../kms/gcp-transport.js';

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
// GcpKmsSigner — the public class (thin wrapper over the kms-core)
// ─────────────────────────────────────────────────────────────────────

export class GcpKmsSigner implements KmsAccountBackend {
  readonly provider = 'gcp-kms' as const;
  private readonly keyName: string;
  private readonly transport: GcpKmsTransport;
  private readonly auditSink?: AuditSink;
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
    this.transport = createGcpKmsTransport(parsed);
  }

  private async getPublicKeyBytes(): Promise<Uint8Array> {
    if (this.cachedPubKey65) return this.cachedPubKey65;
    // The transport asserts the EC_SIGN_SECP256K1_SHA256 algorithm at fetch time.
    const pem = await this.transport.getPublicKeyPem(this.keyName);
    this.cachedPubKey65 = parseSpkiUncompressedSecp256k1PubKey(pemToDer(pem));
    return this.cachedPubKey65;
  }

  async getSignerAddress(): Promise<Address> {
    if (this.cachedAddress) return this.cachedAddress;
    const pub = await this.getPublicKeyBytes();
    this.cachedAddress = publicKeyToAddress(pub) as Address;
    return this.cachedAddress;
  }

  async signA2AAction(input: {
    digest: Uint8Array;
    auditContext?: { toolId?: string; sessionId?: string; actionId?: string };
  }): Promise<{ signature: Uint8Array; keyId: string; signerAddress: Address }> {
    if (input.digest.length !== 32) {
      throw new Error(`GcpKmsSigner.signA2AAction expects a 32-byte digest; got ${input.digest.length}.`);
    }
    const pubKey = await this.getPublicKeyBytes();
    const der = await this.transport.asymmetricSign(this.keyName, input.digest);
    const parsed = parseDerEcdsa(der);
    const s = normalizeLowS(parsed.s);
    const v = findRecoveryByte(parsed.r, s, input.digest, pubKey);

    const sig65 = new Uint8Array(65);
    sig65.set(bigIntTo32Bytes(parsed.r), 0);
    sig65.set(bigIntTo32Bytes(s), 32);
    sig65[64] = v;

    const signerAddress = await this.getSignerAddress();
    // Audit emit. Per key-custody CLAUDE.md invariant: raw sessionId MUST NEVER be logged — hash it.
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

    return { signature: sig65, keyId: this.keyName, signerAddress };
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
// from the secp256k1 signing key. Configure via GCP_KMS_ENCRYPT_KEY_NAME.
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

/**
 * H7-F.4 / PKG-KEY-CUSTODY-008 — derive `keyVersion` from the GCP encrypt
 * response (`name` = the full versioned resource path) instead of a hardcoded
 * string, so a GCP key rotation is reflected in the marker rather than being
 * silently conflated with the old version.
 */
function parseCryptoKeyVersion(responseName: string | undefined): string | null {
  if (!responseName) return null;
  const m = /\/cryptoKeyVersions\/(\d+)$/.exec(responseName);
  return m ? `gcp-kms:v${m[1]}` : null;
}

export class GcpKmsProvider implements A2AKeyProvider {
  /** Only used when the GCP encrypt response doesn't carry a `name` (test fixtures). */
  readonly keyVersion = 'gcp-kms:unknown';
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
    const keyVersion = parseCryptoKeyVersion(res.name) ?? this.keyVersion;

    return { plaintextDataKey, encryptedDataKey, keyId: this.keyName, keyVersion };
  }

  async decryptSessionDataKey(input: {
    encryptedDataKey: Uint8Array;
    aadContext: Record<string, string>;
    keyId: string;
    keyVersion: string;
  }): Promise<Uint8Array> {
    // The marker is operational ("which version produced this payload?"), not a
    // security gate (GCP resolves the version from the ciphertext). A null /
    // arbitrary value signals cross-backend confusion — fail fast.
    if (!/^gcp-kms:(v\d+|unknown)$/.test(input.keyVersion)) {
      throw new Error(
        `GcpKmsProvider: input.keyVersion "${input.keyVersion}" doesn't match the expected ` +
          `'gcp-kms:v<N>' or 'gcp-kms:unknown' shape (H7-F.4).`,
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
