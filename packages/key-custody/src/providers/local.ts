// LocalAesProvider / LocalSecp256k1Signer — DEV ONLY backends.
//
// Refuses to instantiate when NODE_ENV=production. Production guard per spec.
//
// LocalAesProvider:
//   - "Wraps" data keys via HKDF derivation. encryptedDataKey is a random salt;
//     the data key is HKDF(masterSecret, salt, infoBytes(aadContext)).
//   - To "decrypt", re-derives from masterSecret + salt + AAD. Tampering with
//     AAD changes the derived key, which surfaces as a tag mismatch when the
//     caller AES-GCM-decrypts the payload.
//
// LocalSecp256k1Signer:
//   - Holds a hardcoded private key from env (A2A_MASTER_PRIVATE_KEY).
//   - secp256k1 signs a 32-byte digest; returns 65-byte (r,s,v) signature.

import { hmac } from '@noble/hashes/hmac';
import { sha256 } from '@noble/hashes/sha256';
import { hkdf } from '@noble/hashes/hkdf';
import { secp256k1 } from '@noble/curves/secp256k1';
import { keccak_256 } from '@noble/hashes/sha3';
import { hexToBytes, bytesToHex, toHex, type Address, type Hex } from 'viem';
import type { A2AKeyProvider, KmsAccountBackend } from '../types';
import { canonicalContextBytes } from '../aad';
import { buildEvent, type AuditSink } from '@agenticprimitives/audit';

const HKDF_INFO = 'agenticprimitives/local-aes:v1';
const SALT_BYTES = 16;

/**
 * Fail-closed default: refuse to start when NODE_ENV=production, but let a
 * deliberate deployment opt into a local in-memory primitive with an explicit
 * acknowledgement env var. Use case: demo / staging stacks that want to
 * run the full A2A flow without standing up a real KMS first.
 *
 * Each override emits a loud one-time warning at boot. Production preflight
 * (`scripts/check-production-deploy.ts`) is the load-bearing check that
 * these opt-ins do not coexist with real-value keys.
 *
 * Two opt-ins exist because the threat models differ:
 * - `A2A_ALLOW_LOCAL_MASTER_KEY` — in-memory secp256k1 signer (relayer,
 *   bundler, paymaster envelope). Compromise = forge bundler txs.
 * - `A2A_ALLOW_LOCAL_ENVELOPE_KEY` — HKDF-derived AES-GCM session-data-key
 *   wrap. Compromise = decrypt session keypairs at rest = forge delegations.
 */
const warnedOptIns = new Set<string>();

/**
 * H7-B.9 / XPKG-005 — production guard. Previously keyed off
 * `process.env.NODE_ENV !== 'production'` to SKIP — which silently
 * allowed local providers on runtimes that don't set NODE_ENV
 * (Cloudflare Workers, Deno, SES). Fix: inferred environment defaults
 * to `'production'` when NODE_ENV is unreadable or missing, matching
 * `inferEnvironment` in `factories.ts` / sibling-package inferEnvironment functions.
 */
function isProductionEnvironment(): boolean {
  try {
    if (typeof process !== 'undefined' && process.env?.NODE_ENV) {
      return process.env.NODE_ENV === 'production';
    }
  } catch {
    /* SES / Workers may throw on process access */
  }
  // Ambiguous runtime → assume production (fail-closed).
  return true;
}

function assertLocalProviderAllowedInProduction(label: string, optInEnvVar: string): void {
  if (!isProductionEnvironment()) return;
  let optIn = false;
  try {
    optIn = process.env?.[optInEnvVar] === 'true';
  } catch {
    /* SES / Workers — opt-in not readable, treat as not-set */
  }
  if (optIn) {
    if (!warnedOptIns.has(optInEnvVar)) {
      warnedOptIns.add(optInEnvVar);
      // eslint-disable-next-line no-console
      console.warn(
        `[key-custody] ${label}: running in production via ${optInEnvVar}=true. ` +
          `A managed KMS backend (gcp-kms / aws-kms) MUST replace this before any real-value keys land.`,
      );
    }
    return;
  }
  throw new Error(
    `${label} refuses to start in production (or in a runtime where NODE_ENV is unset). ` +
      `Configure a managed KMS backend (gcp-kms / aws-kms), or set ` +
      `${optInEnvVar}=true to acknowledge running with local key material (demo / staging only).`,
  );
}

function loadMasterSecret(envOverride?: string): Uint8Array {
  const hex = envOverride ?? process.env.A2A_SESSION_SECRET;
  if (!hex) {
    throw new Error(
      'LocalAesProvider: A2A_SESSION_SECRET (hex) is required. Generate one for dev: openssl rand -hex 32',
    );
  }
  const bytes = hexToBytes(hex.startsWith('0x') ? (hex as `0x${string}`) : (`0x${hex}` as `0x${string}`));
  if (bytes.length < 32) {
    throw new Error(`A2A_SESSION_SECRET must be at least 32 bytes (64 hex chars); got ${bytes.length}.`);
  }
  return bytes;
}

function loadPrivateKey(envOverride?: string): Uint8Array {
  const hex = envOverride ?? process.env.A2A_MASTER_PRIVATE_KEY;
  if (!hex) {
    throw new Error(
      'LocalSecp256k1Signer: A2A_MASTER_PRIVATE_KEY (0x-prefixed hex) is required.',
    );
  }
  const cleaned = hex.startsWith('0x') ? (hex as `0x${string}`) : (`0x${hex}` as `0x${string}`);
  const bytes = hexToBytes(cleaned);
  if (bytes.length !== 32) {
    throw new Error(`A2A_MASTER_PRIVATE_KEY must be 32 bytes; got ${bytes.length}.`);
  }
  return bytes;
}

function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  // Node 20+ and modern browsers both expose globalThis.crypto.getRandomValues
  globalThis.crypto.getRandomValues(out);
  return out;
}

function publicKeyToAddress(pubKey: Uint8Array): Address {
  // pubKey: 64-byte uncompressed (no 0x04 prefix)
  const raw = pubKey.length === 65 ? pubKey.slice(1) : pubKey;
  const hash = keccak_256(raw);
  // viem's bytesToHex already prefixes with 0x — don't double it.
  return bytesToHex(hash.slice(12)) as Address;
}

export class LocalAesProvider implements A2AKeyProvider {
  readonly keyVersion = 'local-v1';
  private readonly master: Uint8Array;

  constructor(opts?: { sessionSecretHex?: string }) {
    // Production guard moved from the constructor to the
    // envelope-encryption methods (generateSessionDataKey /
    // decryptSessionDataKey). Rationale: the production posture
    // requires a real KMS for SESSION DATA KEY material (encrypt /
    // decrypt of session payloads) — HKDF-from-a-local-secret is the
    // dev-only path that gets refused in prod. The MAC primitive
    // (generateMac, below) is just HMAC-SHA256 over a wrangler-secret-
    // loaded value, which is a legitimate production pattern for
    // service-to-service auth (audit C1). Splitting the guard lets
    // generateMac work in production without weakening the encryption
    // posture.
    this.master = loadMasterSecret(opts?.sessionSecretHex);
  }

  async generateSessionDataKey(input: { aadContext: Record<string, string> }) {
    assertLocalProviderAllowedInProduction(
      'LocalAesProvider.generateSessionDataKey',
      'A2A_ALLOW_LOCAL_ENVELOPE_KEY',
    );
    const salt = randomBytes(SALT_BYTES);
    const info = canonicalContextBytes(input.aadContext);
    // Derive 32-byte data key. encryptedDataKey == salt (the master is held in process memory).
    const dk = hkdf(sha256, this.master, salt, new Uint8Array([...new TextEncoder().encode(HKDF_INFO + '|'), ...info]), 32);
    return {
      plaintextDataKey: dk,
      encryptedDataKey: salt,
      keyId: 'local-master',
      keyVersion: this.keyVersion,
    };
  }

  async decryptSessionDataKey(input: {
    encryptedDataKey: Uint8Array;
    aadContext: Record<string, string>;
    keyId: string;
    keyVersion: string;
  }) {
    assertLocalProviderAllowedInProduction(
      'LocalAesProvider.decryptSessionDataKey',
      'A2A_ALLOW_LOCAL_ENVELOPE_KEY',
    );
    if (input.keyVersion !== this.keyVersion) {
      throw new Error(`LocalAesProvider: keyVersion mismatch (got "${input.keyVersion}", expected "${this.keyVersion}").`);
    }
    const info = canonicalContextBytes(input.aadContext);
    const dk = hkdf(
      sha256,
      this.master,
      input.encryptedDataKey,
      new Uint8Array([...new TextEncoder().encode(HKDF_INFO + '|'), ...info]),
      32,
    );
    return dk;
  }

  async generateMac(input: { canonicalMessage: Uint8Array; service: string; audience: string }) {
    // Permitted in production: this is HMAC-SHA256 with a wrangler-
    // secret-loaded shared key, which is a legitimate production
    // pattern for service-to-service auth. Production should migrate
    // to a managed KMS HMAC key for key rotation + IAM scoping, but
    // the LocalAesProvider MAC path is structurally safe.
    const ctx = `mac|${input.service}|${input.audience}`;
    const subkey = hmac(sha256, this.master, new TextEncoder().encode(ctx));
    const mac = hmac(sha256, subkey, input.canonicalMessage);
    return { mac, keyId: `local-mac:${input.service}:${input.audience}` };
  }
}

export class LocalSecp256k1Signer implements KmsAccountBackend {
  readonly provider = 'local-aes' as const;
  private readonly priv: Uint8Array;
  private readonly addr: Address;
  private readonly auditSink?: AuditSink;

  constructor(opts?: { privateKeyHex?: string; auditSink?: AuditSink }) {
    assertLocalProviderAllowedInProduction('LocalSecp256k1Signer', 'A2A_ALLOW_LOCAL_MASTER_KEY');
    this.priv = loadPrivateKey(opts?.privateKeyHex);
    const pub = secp256k1.getPublicKey(this.priv, false); // uncompressed (65 bytes)
    this.addr = publicKeyToAddress(pub);
    this.auditSink = opts?.auditSink;
  }

  async signA2AAction(input: {
    digest: Uint8Array;
    auditContext?: { toolId?: string; sessionId?: string; actionId?: string };
  }) {
    if (input.digest.length !== 32) {
      throw new Error(`signA2AAction expects a 32-byte digest; got ${input.digest.length}.`);
    }
    const sig = secp256k1.sign(input.digest, this.priv);
    // viem-compatible signature: r (32) | s (32) | v (1, 27 or 28)
    const out = new Uint8Array(65);
    out.set(numberTo32Bytes(sig.r), 0);
    out.set(numberTo32Bytes(sig.s), 32);
    out[64] = (sig.recovery ?? 0) + 27;
    // Audit emit (C3 pass 3c). Per CLAUDE.md security invariant:
    //   "Every Decrypt and signing op emits an audit row with
    //    keyVersion, hashed sessionId, optional toolId/actionId.
    //    Raw sessionId MUST NEVER be logged."
    if (this.auditSink) {
      const ctx = input.auditContext ?? {};
      try {
        await this.auditSink.write(
          buildEvent({
            action: 'key-custody.sign',
            outcome: 'success',
            actor: { type: 'system', id: 'local-secp256k1-signer' },
            subject: { type: 'sign-digest', id: bytesToHex(input.digest) },
            context: {
              keyId: 'local-master-secp256k1',
              signerAddress: this.addr,
              toolId: ctx.toolId ?? null,
              actionId: ctx.actionId ?? null,
              // Hash sessionId — never log raw.
              sessionHash: ctx.sessionId
                ? toHex(keccak_256(new TextEncoder().encode(ctx.sessionId))).slice(0, 18)
                : null,
            },
          }),
        );
      } catch {
        /* fail-soft */
      }
    }
    return {
      signature: out,
      keyId: 'local-master-secp256k1',
      signerAddress: this.addr,
    };
  }

  async getSignerAddress(): Promise<Address> {
    return this.addr;
  }

  /** Internal: returns the address as a hex string for use by adapters. */
  addressHex(): Address {
    return this.addr;
  }
}

function numberTo32Bytes(n: bigint): Uint8Array {
  const out = new Uint8Array(32);
  let value = n;
  for (let i = 31; i >= 0; i--) {
    out[i] = Number(value & 0xffn);
    value >>= 8n;
  }
  return out;
}

// Type aliases re-exported for the package index.
export type { Address, Hex };
export { hexToBytes, bytesToHex, toHex };
