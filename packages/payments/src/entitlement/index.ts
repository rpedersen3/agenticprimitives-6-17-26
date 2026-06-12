/**
 * spec 272 §10 — entitlements: pay-once-then-access.
 *
 * A successful settlement mints an `EntitlementRecord`. Later access reads CONSUME
 * the entitlement (decrement `usesLeft`) with NO new settlement — one access lane
 * (X402-D8): a request is served against {a fresh charge} OR {a live entitlement},
 * never both. **Prepaid credits = an entitlement with `maxUses: N`** — same machinery.
 *
 * Two bindings:
 *  - `'sa'`    — held by a specific SA; the presenter MUST be that SA.
 *  - `'bearer'`— held by whoever presents the matching voucher (tier A3, unlinkable);
 *                this module gates on `voucherId`, the voucher crypto lives in `./voucher`.
 *
 * Fail-closed: an unknown binding, scope mismatch, expiry, or exhausted uses all DENY.
 * Pure (no store): `consumeEntitlement` returns the decremented record; the app persists.
 */

import { keccak256, encodeAbiParameters, toBytes, type Address } from 'viem';
import type { Hex32 } from '../index.js';

export type EntitlementBinding = 'sa' | 'bearer';

export interface EntitlementRecord {
  entitlementId: Hex32;
  binding: EntitlementBinding;
  /** what this grants access to (e.g. keccak of the resource/skill scope) */
  scopeHash: Hex32;
  /** for `'sa'` binding — the SA that may present it */
  subject?: Address;
  /** for `'bearer'` binding — the voucher this entitlement is tied to */
  voucherId?: Hex32;
  /** expiry (unix seconds) */
  ttl: number;
  maxUses: number;
  usesLeft: number;
  provenance: { mandateId: Hex32; settlementHash: Hex32 };
}

const ZERO32 = ('0x' + '00'.repeat(32)) as Hex32;

function entitlementId(args: {
  binding: EntitlementBinding;
  scopeHash: Hex32;
  subject?: Address;
  voucherId?: Hex32;
  mandateId: Hex32;
}): Hex32 {
  return keccak256(
    encodeAbiParameters(
      [{ type: 'string' }, { type: 'bytes32' }, { type: 'bytes32' }, { type: 'bytes32' }],
      [
        args.binding,
        args.scopeHash,
        args.binding === 'sa'
          ? (keccak256(toBytes(args.subject ?? '0x')) as Hex32)
          : (args.voucherId ?? ZERO32),
        args.mandateId,
      ],
    ),
  ) as Hex32;
}

export interface MintEntitlementInput {
  binding: EntitlementBinding;
  scopeHash: Hex32;
  ttl: number;
  maxUses: number;
  mandateId: Hex32;
  settlementHash: Hex32;
  /** required for `'sa'` binding */
  subject?: Address;
  /** required for `'bearer'` binding */
  voucherId?: Hex32;
}

/** Mint an entitlement from a settled payment. Throws if the binding's required handle is missing. */
export function mintEntitlementOnPayment(input: MintEntitlementInput): EntitlementRecord {
  if (input.binding === 'sa' && !input.subject) throw new Error("[entitlement] 'sa' binding requires subject");
  if (input.binding === 'bearer' && !input.voucherId) throw new Error("[entitlement] 'bearer' binding requires voucherId");
  if (input.maxUses < 1) throw new Error('[entitlement] maxUses must be >= 1');
  return {
    entitlementId: entitlementId(input),
    binding: input.binding,
    scopeHash: input.scopeHash,
    subject: input.subject,
    voucherId: input.voucherId,
    ttl: input.ttl,
    maxUses: input.maxUses,
    usesLeft: input.maxUses,
    provenance: { mandateId: input.mandateId, settlementHash: input.settlementHash },
  };
}

/** Prepaid credit pack = an SA-bound entitlement with `maxUses = count`. */
export function mintCredits(input: Omit<MintEntitlementInput, 'binding' | 'maxUses'> & { subject: Address; count: number }): EntitlementRecord {
  return mintEntitlementOnPayment({ ...input, binding: 'sa', maxUses: input.count });
}

export interface EntitlementContext {
  scopeHash: Hex32;
  now: number;
  /** the SA presenting (required to match an `'sa'` binding) */
  presenter?: Address;
  /** the voucher id presented (required to match a `'bearer'` binding) */
  voucherId?: Hex32;
}

export type EntitlementCheck = { ok: true } | { ok: false; reason: string };

/** Fail-closed validity check (does NOT consume). */
export function checkEntitlement(record: EntitlementRecord, ctx: EntitlementContext): EntitlementCheck {
  if (record.binding !== 'sa' && record.binding !== 'bearer') return { ok: false, reason: 'unknown entitlement binding' };
  if (record.scopeHash.toLowerCase() !== ctx.scopeHash.toLowerCase()) return { ok: false, reason: 'scope mismatch' };
  if (ctx.now >= record.ttl) return { ok: false, reason: 'entitlement expired' };
  if (record.usesLeft <= 0) return { ok: false, reason: 'entitlement exhausted' };
  if (record.binding === 'sa') {
    if (!ctx.presenter || !record.subject || ctx.presenter.toLowerCase() !== record.subject.toLowerCase()) {
      return { ok: false, reason: 'presenter is not the entitlement subject' };
    }
  } else {
    if (!ctx.voucherId || !record.voucherId || ctx.voucherId.toLowerCase() !== record.voucherId.toLowerCase()) {
      return { ok: false, reason: 'voucher mismatch' };
    }
  }
  return { ok: true };
}

export interface ConsumptionReceipt {
  entitlementId: Hex32;
  scopeHash: Hex32;
  usesLeftAfter: number;
  at: number;
}

export type ConsumeResult =
  | { ok: true; record: EntitlementRecord; consumption: ConsumptionReceipt }
  | { ok: false; reason: string };

/** Validate + decrement. Returns the updated record (immutable) + a consumption receipt. */
export function consumeEntitlement(record: EntitlementRecord, ctx: EntitlementContext): ConsumeResult {
  const v = checkEntitlement(record, ctx);
  if (!v.ok) return v;
  const updated: EntitlementRecord = { ...record, usesLeft: record.usesLeft - 1 };
  return {
    ok: true,
    record: updated,
    consumption: { entitlementId: record.entitlementId, scopeHash: record.scopeHash, usesLeftAfter: updated.usesLeft, at: ctx.now },
  };
}

/** Convenience: keccak of a resource/skill scope string → `scopeHash`. */
export function scopeHashOf(scope: string): Hex32 {
  return keccak256(toBytes(`entitlement-scope:${scope}`)) as Hex32;
}
