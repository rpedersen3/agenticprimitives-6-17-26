// Quorum-slot packing + passkey-identity derivation (audit P2-2).
//
// `packQuorumSigs` produces the Safe-style multi-slot blob the
// CustodyPolicy verifier consumes. The byte layout is non-trivial:
// 65 bytes per slot, dynamic tails appended after the slot table,
// slots sorted by signer to enable on-chain dedup.
//
// `passkeyIdentity(x, y) = address(uint160(uint256(keccak256(abi.encode(x, y)))))`
// MUST match the on-chain derivation byte-for-byte; mismatch silently
// produces the wrong custodian address.

import { describe, it, expect } from 'vitest';
import { encodeAbiParameters, keccak256, type Address } from 'viem';
import {
  packQuorumSigs,
  passkeyIdentity,
  type EcdsaSlot,
  type ApprovedHashSlot,
  type QuorumSlot,
} from '../src';

const SIGNER_A: Address = '0x31ed17fb99e82e02085ab4b3cbdab05489098b44';
const SIGNER_B: Address = '0x9cfc7e44757529769a28747f86425c682fe64653';

describe('passkeyIdentity', () => {
  it('derives the PIA from a P-256 pubkey deterministically', () => {
    const x = 0x64a72a4f45f6c724e379a54efa3dbfe14c04fa12eddc44f7830aca98ee0f5cf7n;
    const y = 0x0c7dfbe96e6d041812e831c4f2e8597209c103508a3f3b53466713fd1f64197fn;
    const pia = passkeyIdentity(x, y);
    // Same input twice → identical output.
    expect(passkeyIdentity(x, y)).toBe(pia);
    expect(pia).toMatch(/^0x[0-9a-f]{40}$/);
  });

  it('matches the canonical Solidity derivation manually', () => {
    const x = 1n;
    const y = 2n;
    const packed = encodeAbiParameters([{ type: 'uint256' }, { type: 'uint256' }], [x, y]);
    const hash = keccak256(packed);
    const expected = `0x${hash.slice(-40)}`;
    expect(passkeyIdentity(x, y).toLowerCase()).toBe(expected.toLowerCase());
  });

  it('different (x, y) → different PIA', () => {
    expect(passkeyIdentity(1n, 2n)).not.toBe(passkeyIdentity(2n, 1n));
    expect(passkeyIdentity(1n, 2n)).not.toBe(passkeyIdentity(1n, 3n));
  });
});

describe('packQuorumSigs — single ECDSA slot', () => {
  it('returns a raw 65-byte signature for one ecdsa slot (no tail)', () => {
    const slot: EcdsaSlot = {
      type: 'ecdsa',
      signer: SIGNER_A,
      signature: ('0x' + 'ab'.repeat(64) + '1b') as `0x${string}`, // 65 bytes
    };
    const packed = packQuorumSigs([slot]);
    expect(packed.length).toBe(2 + 65 * 2);
    expect(packed.toLowerCase()).toBe('0x' + 'ab'.repeat(64) + '1b');
  });

  it('rejects an ecdsa signature that is not 65 bytes', () => {
    const slot: EcdsaSlot = {
      type: 'ecdsa',
      signer: SIGNER_A,
      signature: ('0x' + '00'.repeat(64)) as `0x${string}`, // 64 bytes (missing v)
    };
    expect(() => packQuorumSigs([slot])).toThrow(/65 bytes/);
  });
});

describe('packQuorumSigs — sort + dedup', () => {
  it('sorts slots by signer address (Safe convention)', () => {
    // SIGNER_A starts with 0x31ed, SIGNER_B with 0x9cfc — A < B.
    // Submit in B, A order; expect A's slot bytes first in output.
    const slotA: ApprovedHashSlot = { type: 'approved-hash', signer: SIGNER_A };
    const slotB: ApprovedHashSlot = { type: 'approved-hash', signer: SIGNER_B };
    const packed = packQuorumSigs([slotB, slotA]);
    // First slot starts at byte 0; signer is left-padded into r.
    const firstSlotR = packed.slice(2, 2 + 64);
    expect(firstSlotR.toLowerCase()).toContain(SIGNER_A.slice(2).toLowerCase());
  });

  it('rejects duplicate signers (would let one party double-vote on chain)', () => {
    const a1: ApprovedHashSlot = { type: 'approved-hash', signer: SIGNER_A };
    const a2: ApprovedHashSlot = { type: 'approved-hash', signer: SIGNER_A };
    expect(() => packQuorumSigs([a1, a2])).toThrow(/duplicate signer/i);
  });

  it('refuses an empty slot list', () => {
    expect(() => packQuorumSigs([] as QuorumSlot[])).toThrow(/at least one slot/i);
  });
});

describe('packQuorumSigs — multi-slot composition', () => {
  it('two slots produce 130 bytes of slot table (no dynamic tails for ecdsa+approved)', () => {
    const slotA: EcdsaSlot = {
      type: 'ecdsa',
      signer: SIGNER_A,
      signature: ('0x' + '11'.repeat(64) + '1b') as `0x${string}`,
    };
    const slotB: ApprovedHashSlot = { type: 'approved-hash', signer: SIGNER_B };
    const packed = packQuorumSigs([slotA, slotB]);
    // 2 * 65 = 130 bytes = 260 hex chars + "0x".
    expect(packed.length).toBe(2 + 130 * 2);
  });
});
