// Salt derivation for deterministic ERC-4337 smart-account addressing.
// Per spec 200 §4 (updated by H7-B.10 / PKG-CONNECT-AUTH-002 / EXT-030):
//   Passkey: BigInt(keccak256(label).slice(0, 18))                     → 8-byte salt
//   Google:  BigInt(keccak256(`${email}:${rotation}:${secret}`).slice(0, 18))
//
// **Why the secret matters (H7-B.10 / PKG-CONNECT-AUTH-002 closure):**
// the legacy `deriveSaltFromEmail(email, rotation)` made the canonical Smart
// Agent address a public deterministic function of the user's email — so
// anyone in possession of the email could pre-compute the SA address. That:
//   - lets adversaries pre-deploy / front-run target addresses,
//   - cross-correlates a user across every service / chain that adopts the
//     same package by hashing the same email,
//   - contradicts ADR-0010 (the SA address IS the canonical identity, not a
//     queryable derivative of a side-channel identifier).
// Mixing in a per-deployment secret breaks the public-function relation:
// the salt is still deterministic for the deployer (so address derivation
// stays reproducible), but external parties cannot enumerate addresses
// from emails alone.

import { keccak_256 } from '@noble/hashes/sha3';

function keccakHex(input: string): string {
  const hash = keccak_256(new TextEncoder().encode(input));
  let hex = '0x';
  for (const b of hash) hex += b.toString(16).padStart(2, '0');
  return hex;
}

export function deriveSaltFromLabel(label: string): bigint {
  if (typeof label !== 'string' || label.length === 0) {
    throw new Error('deriveSaltFromLabel: label must be a non-empty string');
  }
  return BigInt(keccakHex(label).slice(0, 18));
}

export interface DeriveSaltFromEmailOpts {
  /**
   * **Required (H7-B.10).** Per-deployment secret mixed into the salt so
   * the user's SA address is not a public function of their email alone.
   *
   * Source it from a deployment env var / KMS-managed secret. Do NOT
   * hardcode. Rotating this value rotates every Google-derived salt
   * irreversibly (existing accounts stay at the old address; new accounts
   * derive a new one) — treat it as a long-lived crypto credential.
   */
  secret: string;
}

/**
 * H7-B.10 — mix a per-deployment `secret` into the keccak preimage. The
 * positional legacy form `deriveSaltFromEmail(email, rotation)` is gone;
 * callers MUST pass `{ secret }` as the third arg.
 *
 * Closure: PKG-CONNECT-AUTH-002 / EXT-030.
 */
export function deriveSaltFromEmail(
  email: string,
  rotation: number,
  opts: DeriveSaltFromEmailOpts,
): bigint {
  if (typeof email !== 'string' || email.length === 0) {
    throw new Error('deriveSaltFromEmail: email must be a non-empty string');
  }
  if (!Number.isInteger(rotation) || rotation < 0) {
    throw new Error('deriveSaltFromEmail: rotation must be a non-negative integer');
  }
  if (!opts || typeof opts.secret !== 'string' || opts.secret.length < 16) {
    throw new Error(
      'deriveSaltFromEmail: { secret } is required (H7-B.10 / PKG-CONNECT-AUTH-002 closure) — ' +
        'pass a per-deployment secret (≥ 16 chars) so the SA address is not a public function ' +
        'of the user\'s email. Source from a deployment env var / KMS-managed secret.',
    );
  }
  return BigInt(keccakHex(`${email}:${rotation}:${opts.secret}`).slice(0, 18));
}
