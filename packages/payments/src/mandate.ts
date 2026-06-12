/**
 * `buildClosedMandate` — construct an unsigned closed (one-shot) PaymentMandate.
 *
 * The wallet + invoice rails (and the demo) build a closed mandate, sign it via
 * `signPaymentMandate`, then settle it with a single transfer. Closed + one-shot per
 * PMT-10 / PMT-INV-14. `orderHash`/`legId` (EXC-R2) bind the leg to an ExchangeOrder.
 */

import type { Address } from '@agenticprimitives/types';
import { computeMandateId, type PaymentMandate, type PaymentRail, type AssetRef, type Hex32 } from './index.js';

const ZERO32 = ('0x' + '00'.repeat(32)) as Hex32;

export interface ClosedMandateInput {
  payer: Address;
  payee: Address;
  asset: AssetRef;
  amount: bigint;
  chain: number;
  rail: PaymentRail;
  nonce: bigint;
  expiresAt: number;
  validFrom?: number;
  granter?: Address;
  orderHash?: Hex32;
  legId?: Hex32;
  reasonHash?: Hex32;
  resource?: { method: string; url: string; requestBodyHash: Hex32 };
  delegationRef?: Hex32;
}

/** Build the unsigned closed mandate (signature `'0x'`); sign with `signPaymentMandate`. */
export function buildClosedMandate(input: ClosedMandateInput): PaymentMandate {
  const validFrom = input.validFrom ?? 0;
  return {
    mandateId: computeMandateId({ payer: input.payer, nonce: input.nonce, rail: input.rail, chain: input.chain }),
    payer: input.payer,
    payee: input.payee,
    granter: input.granter ?? input.payer,
    rail: input.rail,
    amountPolicy: { kind: 'exact', amount: input.amount, asset: input.asset, chain: input.chain },
    nonce: input.nonce,
    maxRedemptions: 1,
    validFrom,
    expiresAt: input.expiresAt,
    contextBinding: {
      ...(input.resource ? { resource: input.resource } : {}),
      orderHash: input.orderHash,
      legId: input.legId,
      chain: input.chain,
      asset: input.asset,
      nonce: input.nonce,
      validFrom,
      expiresAt: input.expiresAt,
    },
    delegationRef: input.delegationRef,
    mode: 'closed',
    reasonHash: input.reasonHash ?? ZERO32,
    signature: '0x',
  };
}
