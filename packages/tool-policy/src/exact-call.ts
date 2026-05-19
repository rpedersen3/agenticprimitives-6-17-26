// Exact-call DSL: a delegation can authorize EXACTLY one call
// (target + selector + optional calldata hash + optional value cap).
//
// Used for critical-tier operations where the user should authorize the
// exact intent and nothing else.

import { keccak_256 } from '@noble/hashes/sha3';
import type { Address, Hex } from '@agenticprimitives/types';
import type { ExactCallPolicy } from './types';

function keccak256OfHex(hex: Hex): Hex {
  const cleaned = hex.startsWith('0x') ? hex.slice(2) : hex;
  const bytes = new Uint8Array(cleaned.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(cleaned.slice(i * 2, i * 2 + 2), 16);
  const out = keccak_256(bytes);
  let s = '0x';
  for (const b of out) s += b.toString(16).padStart(2, '0');
  return s as Hex;
}

export function exactCall(
  target: Address,
  selector: Hex,
  opts?: { calldataHash?: Hex; valueLimit?: bigint },
): ExactCallPolicy {
  if (!/^0x[0-9a-fA-F]{8}$/.test(selector)) {
    throw new Error(`exactCall: selector must be 4 bytes (0x + 8 hex chars); got "${selector}"`);
  }
  if (opts?.calldataHash && !/^0x[0-9a-fA-F]{64}$/.test(opts.calldataHash)) {
    throw new Error(`exactCall: calldataHash must be 32 bytes (0x + 64 hex chars); got "${opts.calldataHash}"`);
  }
  return {
    target,
    selector,
    calldataHash: opts?.calldataHash,
    valueLimit: opts?.valueLimit,
  };
}

export function matchesExactCall(
  call: { to: Address; data: Hex; value: bigint },
  policy: ExactCallPolicy,
): boolean {
  if (call.to.toLowerCase() !== policy.target.toLowerCase()) return false;

  if (!call.data.startsWith('0x') || call.data.length < 10) return false;
  const callSelector = call.data.slice(0, 10).toLowerCase();
  if (callSelector !== policy.selector.toLowerCase()) return false;

  if (policy.calldataHash) {
    const computed = keccak256OfHex(call.data);
    if (computed.toLowerCase() !== policy.calldataHash.toLowerCase()) return false;
  }

  if (policy.valueLimit !== undefined && call.value > policy.valueLimit) return false;

  return true;
}
