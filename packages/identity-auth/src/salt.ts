// Salt derivation for deterministic ERC-4337 smart-account addressing.
// Per spec 200 §4:
//   Passkey: BigInt(keccak256(label).slice(0, 18))      → 0x + 16 hex chars = 8 bytes
//   Google:  same, hashed over `${email}:${rotation}`

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

export function deriveSaltFromEmail(email: string, rotation: number): bigint {
  if (typeof email !== 'string' || email.length === 0) {
    throw new Error('deriveSaltFromEmail: email must be a non-empty string');
  }
  if (!Number.isInteger(rotation) || rotation < 0) {
    throw new Error('deriveSaltFromEmail: rotation must be a non-negative integer');
  }
  return BigInt(keccakHex(`${email}:${rotation}`).slice(0, 18));
}
