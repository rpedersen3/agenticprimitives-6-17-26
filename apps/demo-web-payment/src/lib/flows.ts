/**
 * The non-metered payment flows (F3 direct/invoice, F5 escrow, F6 split, F9 deliver-then-pay).
 *
 * These use the connected WALLET EOA as the payer (direct txs) — simplest, and each is a single
 * tiny L2 tx so testing stays cheap. The x402 metered flow (F1) keeps its SA + delegation model
 * in x402-pay.ts. Demo amounts are cents of MockUSDC.
 */

import { keccak256, toBytes, type Address, type Hex } from 'viem';
import { baseSepolia } from 'viem/chains';
import {
  invoice as invoiceRail,
  escrow as escrowRail,
  buildErc20Transfer,
  buildErc20Approve,
  buildSplitPayout,
  entitlement,
  type SplitRecipient,
  type Hex32,
} from '@agenticprimitives/payments';
import { config } from '../config';
import { publicClient, type PaymentWallet } from './wallet';

export type TransferPlan = { to: Address; value: bigint; data: Hex };

async function submit(wallet: PaymentWallet, plan: TransferPlan): Promise<Hex> {
  const account = wallet.account?.address;
  if (!account) throw new Error('wallet not connected');
  return wallet.sendTransaction({ account, to: plan.to, data: plan.data, value: plan.value, chain: baseSepolia });
}

export function orderHashOf(label: string): Hex32 {
  // unique per (label, wallet-session) — keccak of label + a random-ish suffix
  return keccak256(toBytes(`order:${label}:${Math.floor(Date.now() / 1000)}`)) as Hex32;
}

// ── F3 direct pay + invoice ─────────────────────────────────────────

/** Direct checkout: the wallet transfers USDC straight to a treasury. */
export async function directPay(wallet: PaymentWallet, treasury: Address, amount: bigint): Promise<Hex> {
  return submit(wallet, buildErc20Transfer(config.mockUsdc, treasury, amount));
}

const usdcAsset = { id: config.mockUsdc, symbol: 'USDC', decimals: 6 };

/** Provider issues an invoice (off-chain request-for-payment object). */
export function createInvoice(args: { issuer: Address; payTo: Address; lineItems: { description: string; amount: bigint }[]; memo?: string; dueInSeconds?: number }): invoiceRail.Invoice {
  return invoiceRail.buildInvoice({
    issuer: args.issuer,
    payTo: args.payTo,
    asset: usdcAsset,
    chain: config.chainId,
    dueAt: Math.floor(Date.now() / 1000) + (args.dueInSeconds ?? 86_400),
    nonce: BigInt(Date.now()),
    lineItems: args.lineItems,
    memo: args.memo,
  });
}

/** Reader reviews + pays the invoice (wallet transfer to the invoice's payTo). */
export async function payInvoice(wallet: PaymentWallet, invoice: invoiceRail.Invoice): Promise<Hex> {
  return submit(wallet, buildErc20Transfer(config.mockUsdc, invoice.payTo, invoice.amount));
}

// ── F5 / F9 escrow (hold → release | reclaim) ───────────────────────

export interface EscrowParams {
  orderHash: Hex32;
  amount: bigint;
  payee: Address;
  /** who can release (defaults to the wallet — user confirms delivery) */
  releaser?: Address;
  /** seconds until the payer may reclaim (short for the demo) */
  expiresInSeconds?: number;
}

/** Deposit into escrow: approve the escrow then deposit (two tiny txs). Payer = wallet. */
export async function escrowDeposit(wallet: PaymentWallet, p: EscrowParams): Promise<{ approveHash: Hex; depositHash: Hex }> {
  const payer = wallet.account!.address;
  const approveHash = await submit(wallet, buildErc20Approve(config.mockUsdc, config.paymentEscrow, p.amount));
  await new Promise((r) => setTimeout(r, 2500)); // let the approve land before deposit pulls
  const depositHash = await submit(
    wallet,
    escrowRail.buildEscrowDeposit({
      escrow: config.paymentEscrow,
      orderHash: p.orderHash,
      asset: config.mockUsdc,
      amount: p.amount,
      payee: p.payee,
      refundTo: payer,
      releaser: p.releaser ?? payer,
      expiry: Math.floor(Date.now() / 1000) + (p.expiresInSeconds ?? 120),
    }),
  );
  return { approveHash, depositHash };
}

/** Capture the hold to the payee (releaser executes — the wallet). */
export async function escrowRelease(wallet: PaymentWallet, orderHash: Hex32): Promise<Hex> {
  return submit(wallet, escrowRail.buildEscrowRelease(config.paymentEscrow, orderHash));
}

/** Reclaim the hold after expiry (payer = wallet) — the "refund if it failed" path. */
export async function escrowReclaim(wallet: PaymentWallet, orderHash: Hex32): Promise<Hex> {
  return submit(wallet, escrowRail.buildEscrowReclaim(config.paymentEscrow, orderHash));
}

export interface EscrowHold {
  payer: Address; asset: Address; amount: bigint; payee: Address;
  refundTo: Address; releaser: Address; expiry: bigint; status: number;
}

export async function readEscrowHold(orderHash: Hex32): Promise<EscrowHold> {
  return (await publicClient.readContract({
    address: config.paymentEscrow,
    abi: escrowRail.ESCROW_ABI,
    functionName: 'getHold',
    args: [orderHash],
  })) as unknown as EscrowHold;
}

export const ESCROW_STATUS_LABEL: Record<number, string> = {
  0: 'none', 1: 'held', 2: 'captured', 3: 'refunded', 4: 'reclaimed',
};

// ── F6 split payout ─────────────────────────────────────────────────

/** Split one amount across recipients by bps; submits one transfer per leg. */
export async function splitPay(wallet: PaymentWallet, amount: bigint, recipients: SplitRecipient[]): Promise<{ to: Address; amount: bigint; hash: Hex }[]> {
  const legs = buildSplitPayout({ asset: config.mockUsdc, amount, recipients });
  const out: { to: Address; amount: bigint; hash: Hex }[] = [];
  for (const leg of legs) {
    const hash = await submit(wallet, leg.plan);
    out.push({ to: leg.to, amount: leg.amount, hash });
  }
  return out;
}

// ── entitlement (pay-after-fulfillment, F9) ─────────────────────────

export const SERVICE_SCOPE = entitlement.scopeHashOf('premium-service');

/** Mint an SA-bound entitlement once a payment/release settles (granted AFTER fulfillment). */
export function grantEntitlement(args: { subject: Address; mandateId: Hex32; settlementHash: Hex32; maxUses?: number; ttlSeconds?: number }): entitlement.EntitlementRecord {
  return entitlement.mintEntitlementOnPayment({
    binding: 'sa',
    scopeHash: SERVICE_SCOPE,
    subject: args.subject,
    ttl: Math.floor(Date.now() / 1000) + (args.ttlSeconds ?? 3600),
    maxUses: args.maxUses ?? 3,
    mandateId: args.mandateId,
    settlementHash: args.settlementHash,
  });
}
