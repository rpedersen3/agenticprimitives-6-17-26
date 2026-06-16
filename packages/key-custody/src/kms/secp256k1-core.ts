// secp256k1 KMS signing core — the CONSUMER-SAFE, peer-dependency-free surface (spec 276 KCS-D1).
//
// This module contains the raw cryptography for turning a Cloud-KMS-style
// secp256k1 asymmetric signature into an Ethereum-compatible 65-byte
// `(r,s,v)` signature, plus SPKI public-key → address derivation. It is the
// extract that lets an external consumer import the primitive instead of
// inlining a copy (the demo-validator `kms-signer.ts` problem).
//
// HARD CONSTRAINT (enforced by test/unit/kms-core-import-graph.test.ts):
//   This file and everything it imports MUST depend ONLY on `@noble/curves`,
//   `@noble/hashes`, and Web/Node built-ins. NO `viem`, NO `@agenticprimitives/*`.
//   That is the entire point — a standalone external app can import
//   `@agenticprimitives/key-custody/kms-core` with no viem / audit / connect-auth peer install.
//
// The audited, viem-typed `GcpKmsSigner` (providers/gcp.ts) is a thin wrapper
// over this core — one implementation, two surfaces (no second KMS path).

import { secp256k1 } from '@noble/curves/secp256k1.js';
import { keccak_256 } from '@noble/hashes/sha3.js';

// ── secp256k1 constants ──────────────────────────────────────────────
const SECP256K1_N = secp256k1.Point.Fn.ORDER;
const SECP256K1_HALF_N = SECP256K1_N >> 1n;

/** A 0x-prefixed lowercase hex string (structurally compatible with viem's `Hex`/`Address`). */
export type Hex = `0x${string}`;

// ── hex / base64 / PEM helpers (viem-free) ───────────────────────────

/** Bytes → `0x`-prefixed lowercase hex. Byte-for-byte compatible with viem's `bytesToHex`. */
export function bytesToHex(bytes: Uint8Array): Hex {
  let h = '';
  for (let i = 0; i < bytes.length; i++) h += bytes[i]!.toString(16).padStart(2, '0');
  return `0x${h}`;
}

export function base64UrlEncode(bytes: Uint8Array): string {
  let str = '';
  for (let i = 0; i < bytes.length; i++) str += String.fromCharCode(bytes[i]!);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function base64Decode(s: string): Uint8Array {
  const binary = atob(s);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

export function base64Encode(bytes: Uint8Array): string {
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

// ── bigint <-> bytes ─────────────────────────────────────────────────

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

// ── DER ECDSA signature parsing ──────────────────────────────────────

/** Parse a DER-encoded ECDSA signature → `(r, s)`. Range-validates `0 < r,s < n`
 *  (audit F-7): a degenerate KMS response (r/s = 0 or ≥ n) is never valid — fail closed. */
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
  const r = bytesToBigInt(rBytes);
  const s = bytesToBigInt(sBytes);
  if (r <= 0n || r >= SECP256K1_N || s <= 0n || s >= SECP256K1_N) {
    throw new Error('DER: r/s out of range (require 0 < r,s < n)');
  }
  return { r, s };
}

/** spec-276 alias for {@link parseDerEcdsa}. */
export const parseDerEcdsaSignature = parseDerEcdsa;

/** Normalize `s` to its low-s form (EIP-2): malleability-canonical signatures only. */
export function normalizeLowS(s: bigint): bigint {
  return s > SECP256K1_HALF_N ? SECP256K1_N - s : s;
}

/** spec-276 alias for {@link normalizeLowS}. */
export const toLowS = normalizeLowS;

// ── SPKI public-key parsing + address derivation ─────────────────────

/** Extract the trailing 65-byte uncompressed secp256k1 point (`0x04||X||Y`) from an SPKI DER blob. */
export function parseSpkiUncompressedSecp256k1PubKey(spkiDer: Uint8Array): Uint8Array {
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

/** `0x04||X||Y` (65 bytes) → EVM address (`keccak256(X||Y)[-20:]`). */
export function publicKeyToAddress(pubKey65: Uint8Array): Hex {
  const raw = pubKey65.slice(1);
  const hash = keccak_256(raw);
  return bytesToHex(hash.slice(12));
}

/** Convenience: SPKI PEM (the Cloud KMS `publicKey` response) → EVM address. */
export function addressFromSpkiPem(pem: string): Hex {
  return publicKeyToAddress(parseSpkiUncompressedSecp256k1PubKey(pemToDer(pem)));
}

// ── recovery-byte search ─────────────────────────────────────────────

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Cloud KMS does not return the recovery bit; recover it by trying v∈{27,28}
 *  against the known uncompressed public key. Throws (redacted error) if neither matches. */
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
      const sig = secp256k1.Signature.fromBytes(compact).addRecoveryBit(recovery);
      const recovered = sig.recoverPublicKey(digest).toBytes(false);
      attempts.push(`v=${recovery + 27} recovered=${bytesToHex(recovered)}`);
      if (bytesEqual(recovered, knownPubKey65)) return recovery + 27;
    } catch (e) {
      attempts.push(`v=${recovery + 27} threw ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  // Redact operational fingerprints (digest/pubkey are chain-correlatable / long-lived
  // identity) to keccak-prefix-8 — still actionable, no raw values leaked (PKG-KEY-CUSTODY-004).
  const tag = (label: string, b: Uint8Array): string => `${label}=${bytesToHex(keccak_256(b)).slice(0, 8)}`;
  // eslint-disable-next-line no-console
  console.error('[gcp-kms findRecoveryByte] mismatch:', {
    digestTag: tag('k', digest),
    rTag: tag('k', rBytes),
    sTag: tag('k', sBytes),
    knownPubKeyTag: tag('k', knownPubKey65),
    attempts,
  });
  throw new Error(
    'Recovery byte search failed: neither v=27 nor v=28 recovers the known public key. ' + attempts.join(' | '),
  );
}

/** spec-276 ordering of {@link findRecoveryByte}: `(digest, r, s, knownPubKey65)`. */
export function recoverV(digest: Uint8Array, r: bigint, s: bigint, knownPubKey65: Uint8Array): 27 | 28 {
  return findRecoveryByte(r, s, digest, knownPubKey65) as 27 | 28;
}

/** Assemble an Ethereum 65-byte `(r,s,v)` signature as 0x hex. */
export function assembleEthSignature(r: bigint, s: bigint, v: number): Hex {
  const sig65 = new Uint8Array(65);
  sig65.set(bigIntTo32Bytes(r), 0);
  sig65.set(bigIntTo32Bytes(s), 32);
  sig65[64] = v;
  return bytesToHex(sig65);
}

// ── high-level: digest → eth signature, transport injected ───────────

/** Turn a raw KMS asymmetric-sign (DER output) into an Ethereum `(r,s,v)` signature.
 *  Transport is INJECTED (`asymmetricSign`) so this stays peer-dependency-free and
 *  testable: the caller supplies however it reaches Cloud KMS. Returns 0x-hex 65 bytes. */
export async function signDigestWithKms(opts: {
  /** The 32-byte keccak digest to sign. */
  digest: Uint8Array;
  /** The signing key's SPKI PEM (the Cloud KMS `publicKey` response `.pem`). Cached by the caller. */
  publicKeyPem: string;
  /** Calls Cloud KMS `:asymmetricSign` for the digest; returns the DER-encoded signature bytes. */
  asymmetricSign: (digest: Uint8Array) => Promise<Uint8Array>;
}): Promise<Hex> {
  if (opts.digest.length !== 32) {
    throw new Error(`signDigestWithKms expects a 32-byte digest; got ${opts.digest.length}.`);
  }
  const pub65 = parseSpkiUncompressedSecp256k1PubKey(pemToDer(opts.publicKeyPem));
  const der = await opts.asymmetricSign(opts.digest);
  const { r, s: rawS } = parseDerEcdsa(der);
  const s = normalizeLowS(rawS);
  const v = recoverV(opts.digest, r, s, pub65);
  return assembleEthSignature(r, s, v);
}
