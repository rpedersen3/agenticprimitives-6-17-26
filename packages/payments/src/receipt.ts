/**
 * X402-D9.3 / spec 243 §7 — PaymentReceipt verifiable credential.
 *
 * Every successful redemption (charge, refund, split-out, escrow release) produces
 * an immutable `PaymentReceipt` VC (PMT-INV-11 — no revoke entrypoint; settlement is
 * final). The receipt is evidence-symmetric (273 EXC-D3): a refund leg is the same
 * shape as the charge it reverses, linked by `provenance.refunds`.
 *
 * This builds the UNSIGNED credential (vc envelope is type-only here per the package
 * boundary); the app/rail signs it via `@agenticprimitives/verifiable-credentials`
 * `signCredential` and asserts it via the `attestations` client.
 */

import type { UnsignedCredential } from '@agenticprimitives/verifiable-credentials';
import type { Address } from '@agenticprimitives/types';
import { hashContextBinding, mandateAmount } from './mandate-sign.js';
import type { PaymentMandate, Hex32 } from './index.js';

export const PAYMENT_RECEIPT_TYPE = 'PaymentReceipt';
const CREDENTIALS_V2_CONTEXT = 'https://www.w3.org/ns/credentials/v2';

/** Coarsen a settlement time to a UTC-day bucket — receipts leak no finer timing (privacy posture §6). */
export function settlementEpochBucket(settledAtSeconds: number): number {
  return Math.floor(settledAtSeconds / 86_400);
}

export interface PaymentReceiptInput {
  /** the settled mandate */
  mandate: PaymentMandate;
  /** the rail executor's SA (VC issuer) */
  issuer: Address;
  /** tx hash, or off-chain settlement id */
  settlementHash: Hex32;
  /** ISO-8601 settlement time */
  settledAt: string;
  /** provenance — set on a refund leg to the original charge's mandateId (EXC-D3) */
  refundsMandateId?: Hex32;
}

/**
 * Build the unsigned `PaymentReceipt` credential. The subject id is the payer SA; the
 * full context binding is folded into `contextBindingHash` (never the body — privacy §6).
 */
export function buildPaymentReceiptCredential(input: PaymentReceiptInput): UnsignedCredential {
  const { mandate } = input;
  const settledSeconds = Math.floor(Date.parse(input.settledAt) / 1000);
  const credential = {
    '@context': [CREDENTIALS_V2_CONTEXT],
    type: ['VerifiableCredential', PAYMENT_RECEIPT_TYPE],
    issuer: input.issuer,
    validFrom: input.settledAt,
    credentialSubject: {
      id: mandate.payer,
      mandateId: mandate.mandateId,
      rail: mandate.rail,
      payee: mandate.payee,
      amount: mandateAmount(mandate).toString(),
      asset: mandate.amountPolicy.asset.id,
      chain: mandate.contextBinding.chain,
      orderHash: mandate.contextBinding.orderHash ?? null,
      legId: mandate.contextBinding.legId ?? null,
      contextBindingHash: hashContextBinding(mandate.contextBinding),
      settlementHash: input.settlementHash,
      settlementEpochBucket: settlementEpochBucket(settledSeconds),
      ...(input.refundsMandateId ? { provenance: { refunds: input.refundsMandateId } } : {}),
    },
  };
  return credential as unknown as UnsignedCredential;
}
