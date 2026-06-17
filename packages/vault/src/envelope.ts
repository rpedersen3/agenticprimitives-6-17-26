// Vault envelope encryption (spec 277 Phase 2 / §13.5–13.7). WebCrypto AES-256-GCM
// with AAD binding — storage-agnostic: `sealEnvelope` returns the ciphertext +
// wrapped-DEK bytes + envelope metadata, and the storage adapter persists them
// wherever (R2 blob / D1 column) and records the refs. `openEnvelope` reverses it.
//
// Key wrapping (the DEK → wrapped-DEK step) is INJECTED via `DekWrapper`, whose
// shape matches `key-custody`'s `A2AKeyProvider` envelope methods — so a
// key-custody provider (LocalAes for dev, KMS for prod) IS a DekWrapper
// structurally, and this package stays dependency-free.
//
// AAD discipline (spec 277 §13.7): the AES-GCM additional-authenticated-data
// binds owner + resource + classification + keyVersion, so a ciphertext can't be
// replayed under a different owner/resource/class. The SAME canonical AAD is
// passed to the DEK wrapper's EncryptionContext, so tampering trips both layers.

import type { VaultClassification, VaultObjectEnvelopeV1 } from './types.js';

/** Injected key-wrapping backend. Structurally satisfied by `key-custody`'s
 *  `A2AKeyProvider` (generateSessionDataKey / decryptSessionDataKey). */
export interface DekWrapper {
  generateSessionDataKey(input: { aadContext: Record<string, string> }): Promise<{
    plaintextDataKey: Uint8Array;
    encryptedDataKey: Uint8Array;
    keyId: string;
    keyVersion: string;
  }>;
  decryptSessionDataKey(input: {
    encryptedDataKey: Uint8Array;
    aadContext: Record<string, string>;
    keyId: string;
    keyVersion: string;
  }): Promise<Uint8Array>;
}

/** The crypto material a sealed envelope yields, for the storage adapter to persist. */
export interface SealedEnvelope {
  /** Envelope metadata (no plaintext, no key material) — the adapter records refs into `crypto`. */
  envelope: Omit<VaultObjectEnvelopeV1, 'plaintext'> & {
    crypto: NonNullable<VaultObjectEnvelopeV1['crypto']>;
  };
  /** AES-GCM ciphertext (iv-prefixed) — persist to R2/D1; its location becomes `crypto.ciphertextRef`. */
  ciphertext: Uint8Array;
  /** KMS-wrapped DEK — persist; its location becomes `crypto.wrappedDekRef`. */
  wrappedDek: Uint8Array;
}

const IV_BYTES = 12;
const enc = new TextEncoder();
const dec = new TextDecoder();

/** Canonical AAD context bound into BOTH the AES-GCM AAD and the DEK EncryptionContext.
 *  Stable key order so seal/open derive byte-identical AAD. */
function aadContext(owner: string, resource: string, classification: VaultClassification, keyVersion: string): Record<string, string> {
  return {
    owner: owner.toLowerCase(),
    resource,
    classification,
    keyVersion,
    profile: 'agentic-delegated-vault-v1',
  };
}

function canonicalAadBytes(ctx: Record<string, string>): Uint8Array {
  const keys = Object.keys(ctx).sort();
  const canonical = keys.map((k) => `${k}=${ctx[k]}`).join('\n');
  return enc.encode(canonical);
}

async function sha256Hex(bytes: Uint8Array): Promise<`sha256:${string}`> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes as unknown as ArrayBuffer);
  const hex = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
  return `sha256:${hex}`;
}

/** Encrypt a payload into a vault envelope. The DEK is generated+wrapped by the
 *  injected `wrapper`; the payload is AES-256-GCM sealed under that DEK with the
 *  canonical AAD. Returns the (plaintext-free) envelope + ciphertext + wrapped DEK. */
export async function sealEnvelope<T = unknown>(opts: {
  owner: string;
  resource: string;
  classification: VaultClassification;
  data: T;
  wrapper: DekWrapper;
  now?: () => string;
}): Promise<SealedEnvelope> {
  const now = opts.now ?? (() => new Date().toISOString());
  const owner = opts.owner.toLowerCase();
  const createdAt = now();

  // 1. Generate + wrap a fresh DEK, bound to the AAD context (keyVersion known after).
  //    We pass a provisional AAD without keyVersion to the wrapper, then bind the
  //    real keyVersion into the AES-GCM AAD (the wrapper returns the version it used).
  const provisional = aadContext(owner, opts.resource, opts.classification, '');
  const dk = await opts.wrapper.generateSessionDataKey({ aadContext: provisional });
  const ctx = aadContext(owner, opts.resource, opts.classification, dk.keyVersion);
  const aadBytes = canonicalAadBytes(ctx);

  // 2. AES-256-GCM the payload under the plaintext DEK, AAD-bound.
  const key = await globalThis.crypto.subtle.importKey('raw', dk.plaintextDataKey as unknown as ArrayBuffer, 'AES-GCM', false, ['encrypt']);
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const plaintextBytes = enc.encode(JSON.stringify(opts.data));
  const ct = new Uint8Array(
    await globalThis.crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aadBytes as unknown as ArrayBuffer }, key, plaintextBytes as unknown as ArrayBuffer),
  );
  const ciphertext = new Uint8Array(IV_BYTES + ct.length);
  ciphertext.set(iv, 0);
  ciphertext.set(ct, IV_BYTES);

  const aadHash = await sha256Hex(aadBytes);

  return {
    envelope: {
      type: 'VaultObjectEnvelopeV1',
      owner,
      resource: opts.resource,
      classification: opts.classification,
      crypto: {
        alg: 'A256GCM',
        ciphertextRef: '', // adapter fills after persisting `ciphertext`
        wrappedDekRef: '', // adapter fills after persisting `wrappedDek`
        dekKid: dk.keyId,
        keyVersion: dk.keyVersion,
        aadHash,
      },
      createdAt,
      updatedAt: createdAt,
      deletedAt: null,
    },
    ciphertext,
    wrappedDek: dk.encryptedDataKey,
  };
}

/** Decrypt a sealed envelope back to its payload. Re-derives the canonical AAD,
 *  unwraps the DEK, and AES-GCM-decrypts. Throws on AAD mismatch / tamper. */
export async function openEnvelope<T = unknown>(opts: {
  envelope: Pick<VaultObjectEnvelopeV1, 'owner' | 'resource' | 'classification' | 'crypto'>;
  ciphertext: Uint8Array;
  wrappedDek: Uint8Array;
  wrapper: DekWrapper;
}): Promise<T> {
  const c = opts.envelope.crypto;
  if (!c) throw new Error('openEnvelope: envelope has no crypto block (plaintext envelope?)');
  if (c.alg !== 'A256GCM') throw new Error(`openEnvelope: unsupported alg ${c.alg}`);

  const ctx = aadContext(opts.envelope.owner, opts.envelope.resource, opts.envelope.classification, c.keyVersion);
  const aadBytes = canonicalAadBytes(ctx);
  const expectedAadHash = await sha256Hex(aadBytes);
  if (expectedAadHash !== c.aadHash) {
    throw new Error('openEnvelope: AAD hash mismatch (owner/resource/classification/keyVersion tampered)');
  }

  const plaintextDek = await opts.wrapper.decryptSessionDataKey({
    encryptedDataKey: opts.wrappedDek,
    aadContext: ctx,
    keyId: c.dekKid,
    keyVersion: c.keyVersion,
  });

  const key = await globalThis.crypto.subtle.importKey('raw', plaintextDek as unknown as ArrayBuffer, 'AES-GCM', false, ['decrypt']);
  const iv = opts.ciphertext.slice(0, IV_BYTES);
  const ct = opts.ciphertext.slice(IV_BYTES);
  const ptBytes = new Uint8Array(
    await globalThis.crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv as unknown as ArrayBuffer, additionalData: aadBytes as unknown as ArrayBuffer }, key, ct as unknown as ArrayBuffer),
  );
  return JSON.parse(dec.decode(ptBytes)) as T;
}
