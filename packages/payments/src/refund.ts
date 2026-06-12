/**
 * Refunds (spec 243 §5.5) — a receipt-linked reverse leg, no enforcer.
 *
 * The treasury (payee) signs a transfer payee → payer carrying `provenance.refunds`
 * pointing at the original charge's mandateId. It emits its OWN PaymentReceipt
 * (audit-equal evidence, 273 EXC-D3). Build the refund receipt with
 * `buildPaymentReceiptCredential({ ..., refundsMandateId })`.
 */

import type { Address } from '@agenticprimitives/types';
import { buildErc20Transfer, type TransferPlan } from './transfer.js';
import type { Hex32 } from './index.js';

export interface RefundInput {
  asset: Address;
  /** refund amount — MUST be ≤ the original charge (caller-enforced) */
  amount: bigint;
  /** where the refund returns — the original charge's payer */
  payer: Address;
  /** the original charge this reverses (provenance) */
  originalMandateId: Hex32;
}

export interface RefundPlan {
  plan: TransferPlan;
  provenance: { refunds: Hex32 };
}

/** Build the reverse leg: the treasury executes a transfer back to the original payer. */
export function buildRefund(input: RefundInput): RefundPlan {
  if (input.amount <= 0n) throw new Error('[refund] amount must be > 0');
  return {
    plan: buildErc20Transfer(input.asset, input.payer, input.amount),
    provenance: { refunds: input.originalMandateId },
  };
}
