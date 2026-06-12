/**
 * Invoice rail (spec 243 §5.5, new) — request-for-payment (Request-Network pattern).
 *
 * A push artifact: the issuer publishes an `Invoice` (line items + total + payee + due);
 * the payer reviews and pays it via the wallet rail, deriving a closed mandate bound to
 * `invoiceId`/`orderHash`. The receipt links invoice ↔ settlement; "is this invoice paid?"
 * resolves from receipts, never `eth_getLogs` (ADR-0012). No protocol dependency.
 */

import { keccak256, encodeAbiParameters, toBytes, type Address } from 'viem';
import { buildClosedMandate } from '../mandate.js';
import { buildWalletTransferPlan } from './wallet.js';
import type { TransferPlan } from '../transfer.js';
import type { PaymentMandate, AssetRef, Hex32 } from '../index.js';

const ZERO32 = ('0x' + '00'.repeat(32)) as Hex32;

export interface InvoiceLineItem {
  description: string;
  amount: bigint;
}

export interface Invoice {
  invoiceId: Hex32;
  issuer: Address;
  /** treasury that receives payment — MAY differ from the issuer */
  payTo: Address;
  lineItems: InvoiceLineItem[];
  amount: bigint;
  asset: AssetRef;
  chain: number;
  /** due time (unix seconds) — becomes the mandate's expiry at pay time */
  dueAt: number;
  /** hash of the memo body (body lives in a vault — privacy §6) */
  memoHash: Hex32;
  /** optional ExchangeOrder linkage (273/274); defaults to `invoiceId` at pay time */
  orderHash?: Hex32;
}

export interface InvoiceInput {
  issuer: Address;
  payTo: Address;
  lineItems: InvoiceLineItem[];
  asset: AssetRef;
  chain: number;
  dueAt: number;
  nonce: bigint;
  memo?: string;
  orderHash?: Hex32;
}

export function computeInvoiceId(args: { issuer: Address; payTo: Address; amount: bigint; asset: Address; chain: number; nonce: bigint }): Hex32 {
  return keccak256(
    encodeAbiParameters(
      [{ type: 'address' }, { type: 'address' }, { type: 'uint256' }, { type: 'address' }, { type: 'uint256' }, { type: 'uint256' }],
      [args.issuer, args.payTo, args.amount, args.asset as Address, BigInt(args.chain), args.nonce],
    ),
  ) as Hex32;
}

/** Build an invoice; `amount` = sum of line items. */
export function buildInvoice(input: InvoiceInput): Invoice {
  const amount = input.lineItems.reduce((s, li) => s + li.amount, 0n);
  if (amount <= 0n) throw new Error('[invoice] amount must be > 0');
  return {
    invoiceId: computeInvoiceId({ issuer: input.issuer, payTo: input.payTo, amount, asset: input.asset.id as Address, chain: input.chain, nonce: input.nonce }),
    issuer: input.issuer,
    payTo: input.payTo,
    lineItems: input.lineItems,
    amount,
    asset: input.asset,
    chain: input.chain,
    dueAt: input.dueAt,
    memoHash: input.memo ? (keccak256(toBytes(input.memo)) as Hex32) : ZERO32,
    orderHash: input.orderHash,
  };
}

/**
 * Pay an invoice via the wallet rail. Derives a closed mandate bound to the invoice
 * (`orderHash = invoice.orderHash ?? invoiceId`) + the transfer plan. Sign the returned
 * mandate with `signPaymentMandate`, then submit `plan`.
 */
export function payInvoice(invoice: Invoice, payer: Address, opts: { nonce: bigint; validFrom?: number }): { mandate: PaymentMandate; plan: TransferPlan } {
  const orderHash = invoice.orderHash ?? invoice.invoiceId;
  const mandate = buildClosedMandate({
    rail: 'wallet',
    payer,
    payee: invoice.payTo,
    asset: invoice.asset,
    amount: invoice.amount,
    chain: invoice.chain,
    nonce: opts.nonce,
    validFrom: opts.validFrom,
    expiresAt: invoice.dueAt,
    orderHash,
    legId: invoice.invoiceId,
    reasonHash: invoice.memoHash,
  });
  return { mandate, plan: buildWalletTransferPlan(mandate) };
}
