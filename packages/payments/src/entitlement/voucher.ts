/**
 * spec 272 §10 tier A3 — blind bearer vouchers (Privacy Pass / RFC 9497 VOPRF).
 *
 * Pay once → receive a pack of UNLINKABLE one-use vouchers → redeem each from a
 * separate context with no link back to the purchase. Built on ristretto255 VOPRF
 * (`@noble/curves`) — the issuer never sees the unblinded token at issuance, so the
 * blinded request it signs and the token presented at redemption cannot be linked.
 *
 * Flow:
 *   client  blindVoucherRequest()  → { request(blinded), secret(tokenId,blind,blinded) }
 *   issuer  issueVoucher(key, request) → { evaluated, proof }            (VOPRF blind-evaluate)
 *   client  unblindVoucher(secret, issued, pubKey) → Voucher            (verifies the issuer proof)
 *   issuer  redeemVoucher(key, voucher, spentSet) → ok | reason         (VOPRF verify + double-spend)
 *
 * One-use is enforced by the spent-set keyed on `voucherId = keccak(tokenId)`.
 */

import { ristretto255_oprf } from '@noble/curves/ed25519.js';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { keccak256 } from 'viem';
import type { Hex } from '@agenticprimitives/types';
import type { Hex32 } from '../index.js';

const voprf = ristretto255_oprf.voprf as unknown as {
  generateKeyPair(): { secretKey: Uint8Array; publicKey: Uint8Array };
  deriveKeyPair(seed: Uint8Array, info: Uint8Array): { secretKey: Uint8Array; publicKey: Uint8Array };
  blind(input: Uint8Array): { blind: Uint8Array; blinded: Uint8Array };
  blindEvaluate(secretKey: Uint8Array, publicKey: Uint8Array, blinded: Uint8Array): { evaluated: Uint8Array; proof: Uint8Array };
  finalize(input: Uint8Array, blind: Uint8Array, evaluated: Uint8Array, blinded: Uint8Array, publicKey: Uint8Array, proof: Uint8Array): Uint8Array;
  evaluate(secretKey: Uint8Array, input: Uint8Array): Uint8Array;
};

const enc = new TextEncoder();
// @noble bytesToHex returns NO `0x` prefix; add it so values are real `Hex` and `.slice(2)` strips it.
const hx = (b: Uint8Array): Hex => ('0x' + bytesToHex(b)) as Hex;

export interface VoucherIssuerKey {
  secretKey: Hex;
  publicKey: Hex;
}
export interface BlindedVoucherRequest {
  blinded: Hex;
}
/** The client's unblinding state — kept private until `unblindVoucher`. */
export interface VoucherSecret {
  tokenId: Hex;
  blind: Hex;
  blinded: Hex;
}
export interface IssuedVoucher {
  evaluated: Hex;
  proof: Hex;
}
/** A redeemable one-use bearer token. */
export interface Voucher {
  voucherId: Hex32;
  tokenId: Hex;
  output: Hex;
}

export function generateVoucherIssuerKey(): VoucherIssuerKey {
  const kp = voprf.generateKeyPair();
  return { secretKey: hx(kp.secretKey), publicKey: hx(kp.publicKey) };
}

/** Deterministic issuer key from a 32-byte seed (stable across processes). */
export function deriveVoucherIssuerKey(seed: Hex, info = 'agentic-voucher-issuer'): VoucherIssuerKey {
  const kp = voprf.deriveKeyPair(hexToBytes(seed.slice(2)), enc.encode(info));
  return { secretKey: hx(kp.secretKey), publicKey: hx(kp.publicKey) };
}

/** `voucherId` — the public, spent-set key derived from the token (no link to the blinded request). */
export function voucherIdOf(tokenId: Hex): Hex32 {
  return keccak256(tokenId) as Hex32;
}

/** Client: blind a fresh random token (or a supplied one) for issuance. */
export function blindVoucherRequest(tokenId?: Hex): { request: BlindedVoucherRequest; secret: VoucherSecret } {
  const tok = tokenId ? hexToBytes(tokenId.slice(2)) : globalThis.crypto.getRandomValues(new Uint8Array(32));
  const { blind, blinded } = voprf.blind(tok);
  return {
    request: { blinded: hx(blinded) },
    secret: { tokenId: hx(tok), blind: hx(blind), blinded: hx(blinded) },
  };
}

/** Issuer: blind-evaluate one request (VOPRF — issuer learns nothing about the token). */
export function issueVoucher(key: VoucherIssuerKey, request: BlindedVoucherRequest): IssuedVoucher {
  const be = voprf.blindEvaluate(hexToBytes(key.secretKey.slice(2)), hexToBytes(key.publicKey.slice(2)), hexToBytes(request.blinded.slice(2)));
  return { evaluated: hx(be.evaluated), proof: hx(be.proof) };
}

/** Issuer: issue a whole pack. */
export function issueVouchers(key: VoucherIssuerKey, requests: BlindedVoucherRequest[]): IssuedVoucher[] {
  return requests.map((r) => issueVoucher(key, r));
}

/**
 * Client: unblind into a finished voucher. Throws if the issuer's VOPRF proof fails
 * (a malicious issuer using the wrong key is detected here — verifiability).
 */
export function unblindVoucher(secret: VoucherSecret, issued: IssuedVoucher, issuerPublicKey: Hex): Voucher {
  const output = voprf.finalize(
    hexToBytes(secret.tokenId.slice(2)),
    hexToBytes(secret.blind.slice(2)),
    hexToBytes(issued.evaluated.slice(2)),
    hexToBytes(secret.blinded.slice(2)),
    hexToBytes(issuerPublicKey.slice(2)),
    hexToBytes(issued.proof.slice(2)),
  );
  return { voucherId: voucherIdOf(secret.tokenId), tokenId: secret.tokenId, output: hx(output) };
}

function ctEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i]! ^ b[i]!;
  return d === 0;
}

/** Issuer: VOPRF validity of a presented voucher (does NOT check double-spend). Fail-closed. */
export function verifyVoucher(key: VoucherIssuerKey, voucher: Voucher): { ok: boolean; reason?: string } {
  try {
    if (voucher.voucherId.toLowerCase() !== voucherIdOf(voucher.tokenId).toLowerCase()) {
      return { ok: false, reason: 'voucherId does not match tokenId' };
    }
    const expected = voprf.evaluate(hexToBytes(key.secretKey.slice(2)), hexToBytes(voucher.tokenId.slice(2)));
    return ctEqual(expected, hexToBytes(voucher.output.slice(2))) ? { ok: true } : { ok: false, reason: 'invalid voucher' };
  } catch {
    return { ok: false, reason: 'malformed voucher' };
  }
}

export interface SpentSet {
  has(id: Hex32): boolean | Promise<boolean>;
  add(id: Hex32): void | Promise<void>;
}

export function createMemorySpentSet(): SpentSet & { size(): number } {
  const set = new Set<string>();
  return {
    has: (id) => set.has(id.toLowerCase()),
    add: (id) => { set.add(id.toLowerCase()); },
    size: () => set.size,
  };
}

/** Issuer: verify + one-shot redeem. Rejects an invalid voucher and a replayed one. */
export async function redeemVoucher(key: VoucherIssuerKey, voucher: Voucher, spent: SpentSet): Promise<{ ok: boolean; reason?: string }> {
  const v = verifyVoucher(key, voucher);
  if (!v.ok) return v;
  if (await spent.has(voucher.voucherId)) return { ok: false, reason: 'voucher already spent' };
  await spent.add(voucher.voucherId);
  return { ok: true };
}
