/**
 * Split payouts (spec 243 §5.5) — app-triggered payout fan-out.
 *
 * One amount split to N recipients by basis points (Seaport recipient-specific-consideration
 * pattern). `bps` MUST sum to 10000; the rounding remainder is assigned to the first recipient
 * so the legs total EXACTLY `amount` (no dust left in the treasury). Each leg is its own
 * transfer plan (and its own receipt). Connected-account onboarding / KYB stays app layer.
 */

import type { Address } from '@agenticprimitives/types';
import { buildErc20Transfer, type TransferPlan } from './transfer.js';

export interface SplitRecipient {
  to: Address;
  bps: number;
}

export interface SplitLeg {
  to: Address;
  bps: number;
  amount: bigint;
  plan: TransferPlan;
}

export const BPS_DENOMINATOR = 10_000;

export function buildSplitPayout(input: { asset: Address; amount: bigint; recipients: SplitRecipient[] }): SplitLeg[] {
  const { asset, amount, recipients } = input;
  if (recipients.length === 0) throw new Error('[split] at least one recipient required');
  if (amount <= 0n) throw new Error('[split] amount must be > 0');
  const totalBps = recipients.reduce((s, r) => s + r.bps, 0);
  if (totalBps !== BPS_DENOMINATOR) throw new Error(`[split] bps must sum to ${BPS_DENOMINATOR}, got ${totalBps}`);
  for (const r of recipients) if (r.bps <= 0) throw new Error('[split] each recipient bps must be > 0');

  const amounts = recipients.map((r) => (amount * BigInt(r.bps)) / BigInt(BPS_DENOMINATOR));
  const remainder = amount - amounts.reduce((s, a) => s + a, 0n);
  amounts[0]! += remainder; // assign rounding dust to the first recipient → legs total exactly `amount`

  return recipients.map((r, i) => ({
    to: r.to,
    bps: r.bps,
    amount: amounts[i]!,
    plan: buildErc20Transfer(asset, r.to, amounts[i]!),
  }));
}
