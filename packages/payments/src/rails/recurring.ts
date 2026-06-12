/**
 * Recurring profile (spec 243 §5.5 / PMT-10) — NOT a rail, a mandate pattern.
 *
 * The payer authorizes ONCE (an open payment delegation whose caveats carry the per-charge
 * cap + the frequency window + the aggregate cap); each period derives a CLOSED per-charge
 * mandate settled via the wallet rail. The `PaymentEnforcer`'s on-chain frequency window +
 * aggregate cap do the real enforcement — `recurringCaveatParams` returns the values the app
 * feeds to `delegation.buildPaymentMandateCaveats` (payments doesn't runtime-import delegation).
 */

import type { Address } from '@agenticprimitives/types';
import { keccak256, encodeAbiParameters } from 'viem';
import { buildClosedMandate } from '../mandate.js';
import { buildWalletTransferPlan } from './wallet.js';
import type { TransferPlan } from '../transfer.js';
import type { PaymentMandate, AssetRef, Hex32 } from '../index.js';

export interface RecurringInput {
  payer: Address;
  payee: Address;
  asset: AssetRef;
  chain: number;
  amountPerPeriod: bigint;
  windowSeconds: number;
  /** total spend ceiling across all periods (aggregate cap) */
  totalCap: bigint;
  validFrom: number;
  validUntil: number;
  /** base nonce; period N's charge uses `startNonce + N` */
  startNonce: bigint;
}

export interface RecurringTemplate extends RecurringInput {
  templateId: Hex32;
  /** number of periods the totalCap covers at amountPerPeriod */
  periods: number;
}

export function buildRecurringTemplate(input: RecurringInput): RecurringTemplate {
  if (input.amountPerPeriod <= 0n) throw new Error('[recurring] amountPerPeriod must be > 0');
  if (input.totalCap < input.amountPerPeriod) throw new Error('[recurring] totalCap must be >= amountPerPeriod');
  if (input.windowSeconds <= 0) throw new Error('[recurring] windowSeconds must be > 0');
  const templateId = keccak256(
    encodeAbiParameters(
      [{ type: 'address' }, { type: 'address' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }],
      [input.payer, input.payee, input.amountPerPeriod, BigInt(input.windowSeconds), input.startNonce],
    ),
  ) as Hex32;
  return { ...input, templateId, periods: Number(input.totalCap / input.amountPerPeriod) };
}

export interface RecurringCaveatParams {
  maxAmountPerCharge: bigint;
  maxAggregate: bigint;
  maxRedemptionsPerWindow: number;
  windowSeconds: number;
  validUntil: number;
}

/** The values the app feeds to `delegation.buildPaymentMandateCaveats` for the one-time authorization. */
export function recurringCaveatParams(t: RecurringTemplate): RecurringCaveatParams {
  return {
    maxAmountPerCharge: t.amountPerPeriod,
    maxAggregate: t.totalCap,
    maxRedemptionsPerWindow: 1, // one charge per window
    windowSeconds: t.windowSeconds,
    validUntil: t.validUntil,
  };
}

/** The time window in which period N may be charged (the enforcer rejects an early re-charge). */
export function periodWindow(t: RecurringTemplate, period: number): { start: number; end: number } {
  const start = t.validFrom + period * t.windowSeconds;
  return { start, end: start + t.windowSeconds };
}

/** Derive the closed per-charge mandate + transfer plan for period N. Sign the mandate, then settle. */
export function deriveScheduledCharge(t: RecurringTemplate, period: number): { mandate: PaymentMandate; plan: TransferPlan; window: { start: number; end: number } } {
  if (period < 0 || period >= t.periods) throw new Error(`[recurring] period out of range [0, ${t.periods})`);
  const window = periodWindow(t, period);
  const mandate = buildClosedMandate({
    rail: 'wallet',
    payer: t.payer,
    payee: t.payee,
    asset: t.asset,
    amount: t.amountPerPeriod,
    chain: t.chain,
    nonce: t.startNonce + BigInt(period),
    validFrom: window.start,
    expiresAt: window.end,
    orderHash: t.templateId,
    legId: (('0x' + period.toString(16).padStart(64, '0')) as Hex32),
  });
  return { mandate, plan: buildWalletTransferPlan(mandate), window };
}
