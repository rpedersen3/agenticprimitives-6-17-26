/**
 * @agenticprimitives/payments — PaymentMandate + rail abstraction.
 * Spine Layer 9b.
 *
 * Authoritative spec: specs/243-payments.md
 */

import { keccak_256 } from '@noble/hashes/sha3.js';
import { utf8ToBytes } from '@noble/hashes/utils.js';
import type { Address, Hex } from '@agenticprimitives/types';

export const PACKAGE_NAME = '@agenticprimitives/payments';
export const PACKAGE_STATUS = 'w1-foundational' as const;
export const SPEC_REF = 'specs/243-payments.md';

export type Hex32 = `0x${string}`;

export type PaymentRail =
  | 'x402'
  | 'wallet'
  | 'sponsored-userop'
  | 'escrow'
  | 'invoice'
  | 'confidential-aztec'
  | 'confidential-zcash'
  | 'confidential-zk-paymaster';

export interface AssetRef {
  id: string;
  symbol?: string;
  decimals?: number;
}

export type AmountPolicy =
  | { kind: 'exact'; amount: bigint; asset: AssetRef; chain: number }
  | { kind: 'range'; minAmount: bigint; maxAmount: bigint; asset: AssetRef; chain: number }
  | { kind: 'formula'; formulaId: Hex32; maxAmount: bigint; asset: AssetRef; chain: number };

export interface MandateConstraints {
  maxAggregateAmount?: bigint;
  frequency?: { maxRedemptionsPerWindow: number; windowSeconds: number };
  categories?: string[];
  excludedCategories?: string[];
  geoFence?: string[];
}

export interface ContextBinding {
  intentId?: string;
  agreementCommitment?: Hex32;
  taskId?: Hex32;
  artifactHash?: Hex32;
  resource?: { method: string; url: string; requestBodyHash: Hex32 };
  /** EXC-R2 — the ExchangeOrder this payment leg belongs to (273/274). x402 sets `orderHash = quoteId`. */
  orderHash?: Hex32;
  /** EXC-R2 — distinguishes legs within one order (charge / refund / split-out / escrow-release). */
  legId?: Hex32;
  chain: number;
  asset: AssetRef;
  nonce: bigint;
  validFrom: number;
  expiresAt: number;
}

export type PaymentMandateMode = 'open' | 'closed';

export interface PaymentMandate {
  mandateId: Hex32;
  payer: Address;
  payee: Address;
  granter: Address;
  rail: PaymentRail;
  railConfig?: Record<string, unknown>;
  amountPolicy: AmountPolicy;
  mandateConstraints?: MandateConstraints;
  nonce: bigint;
  maxRedemptions: number;
  validFrom: number;
  expiresAt: number;
  contextBinding: ContextBinding;
  delegationRef?: Hex32;
  mode: PaymentMandateMode;
  requiresClosedMandateForFinalCharge?: boolean;
  reasonHash: Hex32;
  signature: Hex;
}

/** PMT-3.1: at least one context-binding handle MUST be populated. */
export function assertContextBindingValid(cb: ContextBinding): void {
  const any = cb.intentId || cb.agreementCommitment || cb.taskId || cb.artifactHash || cb.resource;
  if (!any) {
    throw new Error(
      '[payments/PMT-3.1] ContextBinding MUST populate at least one of intentId / agreementCommitment / taskId / artifactHash / resource',
    );
  }
}

/** PMT-INV-14 / PMT-10.1: closed mandates are always one-shot. */
export function assertClosedMandateInvariants(mandate: PaymentMandate): void {
  if (mandate.mode === 'closed' && mandate.maxRedemptions !== 1) {
    throw new Error(`[payments/PMT-INV-14] closed mandate MUST have maxRedemptions = 1`);
  }
}

export function computeMandateId(args: {
  payer: Address;
  nonce: bigint;
  rail: PaymentRail;
  chain: number;
}): Hex32 {
  const blob = `${args.payer.toLowerCase()}:${args.nonce}:${args.rail}:${args.chain}`;
  const digest = keccak_256(utf8ToBytes(blob));
  let hex = '0x';
  for (const v of digest) hex += v.toString(16).padStart(2, '0');
  return hex as Hex32;
}

export interface PaymentRailExecutor {
  rail: PaymentRail;
  verifyMandate(mandate: PaymentMandate): Promise<{ valid: boolean; reason?: string }>;
  prepareRedemption(mandate: PaymentMandate): Promise<{ planId: Hex32; details: Record<string, unknown> }>;
  executeRedemption(plan: { planId: Hex32 }): Promise<{ receiptHash: Hex32; settlementHash: Hex32 }>;
}

const _rails = new Map<PaymentRail, PaymentRailExecutor>();
export function registerRail(executor: PaymentRailExecutor): void {
  _rails.set(executor.rail, executor);
}
export function getRail(rail: PaymentRail): PaymentRailExecutor | undefined {
  return _rails.get(rail);
}

// Spec 243 §4.2 / PMT-INV-02/12 — EIP-712 mandate signing + ERC-1271 verification.
export {
  PAYMENT_MANDATE_DOMAIN_NAME,
  PAYMENT_MANDATE_DOMAIN_VERSION,
  PAYMENT_MANDATE_EIP712_TYPES,
  ERC1271_MAGIC,
  mandateAmount,
  hashContextBinding,
  paymentMandateDomain,
  buildPaymentMandateTypedData,
  paymentMandateDigest,
  signPaymentMandate,
  verifyPaymentMandateSignature,
} from './mandate-sign.js';
export type { MandateDomainOpts, MandateSigner, Erc1271Reader } from './mandate-sign.js';

// Spec 243 §7 / X402-D9.3 — PaymentReceipt verifiable credential.
export { PAYMENT_RECEIPT_TYPE, settlementEpochBucket, buildPaymentReceiptCredential } from './receipt.js';
export type { PaymentReceiptInput } from './receipt.js';

// Spec 272 — the x402 rail (staged executor + v2 wire + nonce store + resource binding).
export * as x402 from './rails/x402/index.js';

// Spec 272 §10 — entitlements (pay-once-then-access; credits = maxUses:N).
export * as entitlement from './entitlement/index.js';
