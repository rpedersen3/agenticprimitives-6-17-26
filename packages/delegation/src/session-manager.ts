// SessionManager — owns the session lifecycle per spec 202 §5.
//
// Lifecycle: init → package → resolve → revoke / expired.
//   init     generates a fresh session keypair, persists encrypted-pending
//            row via the SessionStore (data key generated through the
//            A2AKeyProvider from @agenticprimitives/key-custody).
//   package  caller submits a user-signed Delegation; SessionManager
//            re-encrypts {sessionPrivateKey, delegation} as the full
//            package, marks the row active.
//   resolve  decrypts the package, hands back a viem-compatible signer
//            over the session private key, plus the bound delegation.
//   revoke   marks the row revoked; callers must mint a new session.

import { secp256k1 } from '@noble/curves/secp256k1.js';
import { keccak_256 } from '@noble/hashes/sha3.js';
import {
  bytesToHex,
  hexToBytes,
  keccak256,
  toBytes,
  type Address,
  type Hex,
} from 'viem';
import type { A2AKeyProvider } from '@agenticprimitives/key-custody';
import { canonicalContextBytes } from '@agenticprimitives/key-custody';
import type {
  Delegation,
  SessionMeta,
  SessionPackage,
  SessionRow,
  SessionStore,
} from './types';

function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  globalThis.crypto.getRandomValues(out);
  return out;
}

function generateSessionId(): string {
  const buf = randomBytes(16);
  let s = 'sa_';
  for (const b of buf) s += b.toString(16).padStart(2, '0');
  return s;
}

function publicKeyToAddress(pub: Uint8Array): Address {
  const raw = pub.length === 65 ? pub.slice(1) : pub;
  const hash = keccak_256(raw);
  return bytesToHex(hash.slice(12)) as Address;
}

function sessionIdHash(sessionId: string): string {
  const h = keccak_256(new TextEncoder().encode(sessionId));
  let s = '';
  for (const b of h.slice(0, 16)) s += b.toString(16).padStart(2, '0');
  return s;
}

function buildAad(meta: SessionMeta, keyVersion: string): Record<string, string> {
  return {
    session_id_h: sessionIdHash(meta.sessionId),
    account_address: meta.accountAddress.toLowerCase(),
    chain_id: String(meta.chainId),
    expires_at: meta.expiresAt,
    key_version: keyVersion,
  };
}

// TS strict-mode quirk: Web Crypto types want ArrayBuffer specifically; Uint8Array
// over a ArrayBufferLike (could be SharedArrayBuffer) doesn't fit. Cast through
// BufferSource — these are all locally-allocated, never shared.
function asBufferSource(b: Uint8Array): BufferSource {
  return b as unknown as BufferSource;
}

async function aesGcmEncrypt(
  key: Uint8Array,
  iv: Uint8Array,
  plaintext: Uint8Array,
  aad: Uint8Array,
): Promise<Uint8Array> {
  const cryptoKey = await globalThis.crypto.subtle.importKey('raw', asBufferSource(key), 'AES-GCM', false, ['encrypt']);
  const ct = await globalThis.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: asBufferSource(iv), additionalData: asBufferSource(aad) },
    cryptoKey,
    asBufferSource(plaintext),
  );
  return new Uint8Array(ct);
}

async function aesGcmDecrypt(
  key: Uint8Array,
  iv: Uint8Array,
  ciphertext: Uint8Array,
  aad: Uint8Array,
): Promise<Uint8Array> {
  const cryptoKey = await globalThis.crypto.subtle.importKey('raw', asBufferSource(key), 'AES-GCM', false, ['decrypt']);
  const pt = await globalThis.crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: asBufferSource(iv), additionalData: asBufferSource(aad) },
    cryptoKey,
    asBufferSource(ciphertext),
  );
  return new Uint8Array(pt);
}

export interface SessionResolveResult {
  meta: SessionMeta;
  delegation: Delegation | null;
  signer: {
    address: Address;
    // KC-001 (audit 2026-06-09): the raw session private key is NOT exposed. It is a token-forging
    // secret; surfacing it alongside `signMessage` (which already encapsulates it) meant any logging
    // or serialization of the result leaked it. Use `signMessage` — the key never leaves this closure.
    signMessage(msg: string | { raw: Hex }): Promise<Hex>;
  };
}

export class SessionManager {
  constructor(
    private readonly opts: {
      keyCustody: A2AKeyProvider;
      store: SessionStore;
      ttlSeconds?: number;
      /** Allow tests/clock injection. Default: Date.now() */
      now?: () => number;
    },
  ) {}

  private nowMs(): number {
    return (this.opts.now ?? Date.now)();
  }

  /**
   * Generate a fresh session keypair, encrypt {sessionPrivateKey} (no
   * delegation yet) at rest, persist as pending. Returns the sessionId and
   * sessionKeyAddress to hand back to the user/web app.
   */
  async init(
    accountAddress: Address,
    chainId: number,
  ): Promise<{ sessionId: string; sessionKeyAddress: Address }> {
    const sessionId = generateSessionId();
    const ttl = (this.opts.ttlSeconds ?? 24 * 60 * 60) * 1000;
    const expiresAt = new Date(this.nowMs() + ttl).toISOString();

    // Fresh secp256k1 keypair
    const priv = randomBytes(32);
    // secp256k1 priv keys MUST be in [1, n-1]. Retry on rare overflow / zero.
    if (!secp256k1.utils.isValidSecretKey(priv)) {
      return this.init(accountAddress, chainId); // recurse — vanishingly rare
    }
    const pub = secp256k1.getPublicKey(priv, false);
    const sessionKeyAddress = publicKeyToAddress(pub);

    const meta: SessionMeta = { sessionId, accountAddress, chainId, expiresAt };

    // Encrypt the partial package (only sessionPrivateKey for now; delegation
    // joins at /package).
    const partialPayload = new TextEncoder().encode(
      JSON.stringify({ sessionPrivateKey: bytesToHex(priv) }),
    );
    const aadCtx = buildAad(meta, this.opts.keyCustody.keyVersion);
    const aadBytes = canonicalContextBytes(aadCtx);
    const wrap = await this.opts.keyCustody.generateSessionDataKey({ aadContext: aadCtx });
    const iv = randomBytes(12);
    const encryptedPackage = await aesGcmEncrypt(wrap.plaintextDataKey, iv, partialPayload, aadBytes);

    const row: SessionRow = {
      id: sessionId,
      accountAddress,
      chainId,
      sessionKeyAddress,
      status: 'pending',
      encryptedPackage,
      iv,
      encryptedDataKey: wrap.encryptedDataKey,
      keyVersion: wrap.keyVersion,
      expiresAt,
      createdAt: new Date(this.nowMs()).toISOString(),
    };
    await this.opts.store.save(row);
    return { sessionId, sessionKeyAddress };
  }

  /**
   * Receive a fully-signed Delegation, unwrap the pending session, re-encrypt
   * the full {sessionPrivateKey, delegation} package, mark active.
   */
  async package(sessionId: string, delegation: Delegation): Promise<void> {
    const row = await this.requirePending(sessionId);
    const meta: SessionMeta = {
      sessionId,
      accountAddress: row.accountAddress,
      chainId: row.chainId,
      expiresAt: row.expiresAt,
    };
    // Decrypt the current partial payload to extract the sessionPrivateKey.
    const aadCtx = buildAad(meta, row.keyVersion);
    const aadBytes = canonicalContextBytes(aadCtx);
    const dk = await this.opts.keyCustody.decryptSessionDataKey({
      encryptedDataKey: row.encryptedDataKey,
      aadContext: aadCtx,
      keyId: 'local-master',
      keyVersion: row.keyVersion,
    });
    const partial = await aesGcmDecrypt(dk, row.iv, row.encryptedPackage, aadBytes);
    const parsed = JSON.parse(new TextDecoder().decode(partial)) as { sessionPrivateKey: Hex };

    // Re-encrypt the full package with a fresh IV (data key stays the same).
    const fullPayload = new TextEncoder().encode(
      JSON.stringify({
        sessionPrivateKey: parsed.sessionPrivateKey,
        delegation: serializableDelegation(delegation),
      }),
    );
    const newIv = randomBytes(12);
    const encryptedPackage = await aesGcmEncrypt(dk, newIv, fullPayload, aadBytes);

    const updated: SessionRow = {
      ...row,
      status: 'active',
      encryptedPackage,
      iv: newIv,
    };
    await this.opts.store.save(updated);
  }

  /**
   * Decrypt an active session and return the session signer + delegation.
   * Refuses pending/revoked/expired rows. Signer never holds the private
   * key longer than this call; callers should mint tokens with it
   * immediately and drop the reference.
   */
  async resolve(sessionId: string): Promise<SessionResolveResult> {
    const row = await this.opts.store.get(sessionId);
    if (!row) throw new Error(`SessionManager.resolve: session "${sessionId}" not found`);
    if (row.status !== 'active') {
      throw new Error(`SessionManager.resolve: session is "${row.status}"`);
    }
    const now = this.nowMs();
    if (Date.parse(row.expiresAt) < now) {
      throw new Error('SessionManager.resolve: session expired');
    }
    const meta: SessionMeta = {
      sessionId,
      accountAddress: row.accountAddress,
      chainId: row.chainId,
      expiresAt: row.expiresAt,
    };
    const aadCtx = buildAad(meta, row.keyVersion);
    const aadBytes = canonicalContextBytes(aadCtx);
    const dk = await this.opts.keyCustody.decryptSessionDataKey({
      encryptedDataKey: row.encryptedDataKey,
      aadContext: aadCtx,
      keyId: 'local-master',
      keyVersion: row.keyVersion,
    });
    const pt = await aesGcmDecrypt(dk, row.iv, row.encryptedPackage, aadBytes);
    const pkg = JSON.parse(new TextDecoder().decode(pt)) as {
      sessionPrivateKey: Hex;
      delegation: SerializableDelegation | null;
    };
    const priv = hexToBytes(pkg.sessionPrivateKey);
    const address = publicKeyToAddress(secp256k1.getPublicKey(priv, false));

    return {
      meta,
      delegation: pkg.delegation ? deserializeDelegation(pkg.delegation) : null,
      signer: {
        address,
        signMessage: async (msg) => {
          let digest: Uint8Array;
          if (typeof msg === 'string') {
            const bytes = new TextEncoder().encode(msg);
            const prefix = new TextEncoder().encode(`\x19Ethereum Signed Message:\n${bytes.length}`);
            const combined = new Uint8Array(prefix.length + bytes.length);
            combined.set(prefix, 0);
            combined.set(bytes, prefix.length);
            digest = keccak_256(combined);
          } else {
            digest = toBytes(msg.raw);
          }
          // R5.3 / PKG-DELEGATION-004 closure — enforce low-s canonical
          // form explicitly. noble defaults to `lowS: true` today; the
          // audit calls out the implicit dependency that a future bump
          // could silently regress signature malleability. JTI tracking
          // uses `claims.jti` not token bytes, so replay-tracking holds
          // either way, but every signing path makes the invariant
          // load-bearing at the call site so future auditors don't
          // have to read noble release notes.
          // noble v2: sign() returns raw bytes; request recovered form and
          // parse into an r/s/recovery object.
          const sig = secp256k1.Signature.fromBytes(
            secp256k1.sign(digest, priv, { lowS: true, prehash: false, format: "recovered" }),
            "recovered",
          );
          const r = sig.r.toString(16).padStart(64, '0');
          const s = sig.s.toString(16).padStart(64, '0');
          const v = (sig.recovery ?? 0) + 27;
          return ('0x' + r + s + v.toString(16).padStart(2, '0')) as Hex;
        },
      },
    };
  }

  async revoke(sessionId: string): Promise<void> {
    await this.opts.store.revoke(sessionId);
  }

  private async requirePending(sessionId: string): Promise<SessionRow> {
    const row = await this.opts.store.get(sessionId);
    if (!row) throw new Error(`SessionManager: session "${sessionId}" not found`);
    if (row.status !== 'pending') {
      throw new Error(`SessionManager.package: session is "${row.status}", expected "pending"`);
    }
    return row;
  }
}

// ─── Memory store ─────────────────────────────────────────────────────────

export function createMemorySessionStore(): SessionStore {
  const rows = new Map<string, SessionRow>();
  return {
    async save(row) {
      rows.set(row.id, row);
    },
    async get(id) {
      return rows.get(id) ?? null;
    },
    async list(accountAddress) {
      return [...rows.values()].filter((r) => r.accountAddress.toLowerCase() === accountAddress.toLowerCase());
    },
    async revoke(id) {
      const row = rows.get(id);
      if (!row) return;
      rows.set(id, { ...row, status: 'revoked', revokedAt: new Date().toISOString() });
    },
  };
}

// ─── JSON-safe (de)serialization helpers — BigInt → string ────────────────

type SerializableDelegation = Omit<Delegation, 'salt'> & { salt: string };

function serializableDelegation(d: Delegation): SerializableDelegation {
  return { ...d, salt: d.salt.toString() };
}

function deserializeDelegation(d: SerializableDelegation): Delegation {
  return { ...d, salt: BigInt(d.salt) };
}

// keccak256 is exported for convenience to keep the contract clean for tests
export { keccak256 };
