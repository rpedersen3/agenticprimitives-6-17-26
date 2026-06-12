/**
 * The non-metered payment flows (F3 direct/invoice, F5 escrow, F6 split, F9 deliver-then-pay,
 * F4 subscription, F2 voucher).
 *
 * Canonical-identifier doctrine (ADR-0010) + gasless: money moves **SA → SA**, and every payment
 * runs AS the person's Treasury SA via a paymaster-sponsored UserOp (agent-pay.ts `executeViaSa`).
 * The recipient is the Provider Treasury SA. The custodian wallet only signs (no gas, no USDC).
 */

import { keccak256, toBytes, type Address, type Hex } from 'viem';
import {
  invoice as invoiceRail,
  escrow as escrowRail,
  recurring as recurringRail,
  ops as opsApi,
  buildErc20Transfer,
  buildErc20Approve,
  buildSplitPayout,
  entitlement,
  type SplitRecipient,
  type Hex32,
} from '@agenticprimitives/payments';
import { config } from '../config';
import { publicClient, type PaymentWallet } from './wallet';
import { toUsdc, fromUsdc, readUsdcBalance } from './x402-pay';
import { executeViaSa } from './agent-pay';

/** Everything a flow needs to pay gaslessly from the Treasury SA. */
export interface PayCtx {
  wallet: PaymentWallet;
  treasurySa: Address;       // payer (holds USDC, executes the userOp)
  providerTreasury: Address; // payee
}

/** Pre-check the TREASURY SA's USDC so an insufficient-balance revert reads clearly. */
async function requireUsdc(ctx: PayCtx, amount: bigint, label: string): Promise<void> {
  const bal = await readUsdcBalance(ctx.treasurySa);
  if (bal < amount) throw new Error(`Treasury SA holds ${fromUsdc(bal)} USDC but ${label} needs ${fromUsdc(amount)} — fund the treasury first.`);
}

export function orderHashOf(label: string): Hex32 {
  return keccak256(toBytes(`order:${label}:${Math.floor(Date.now() / 1000)}`)) as Hex32;
}

const usdcAsset = { id: config.mockUsdc, symbol: 'USDC', decimals: 6 };

// ── F3 direct pay + invoice (Treasury SA → Provider SA, gasless) ─────

export async function directPay(ctx: PayCtx, amount: bigint): Promise<Hex> {
  await requireUsdc(ctx, amount, 'this payment');
  const { data } = buildErc20Transfer(config.mockUsdc, ctx.providerTreasury, amount);
  return executeViaSa(ctx.wallet, ctx.treasurySa, config.mockUsdc, 0n, data);
}

export function createInvoice(args: { issuer: Address; payTo: Address; lineItems: { description: string; amount: bigint }[]; memo?: string; dueInSeconds?: number }): invoiceRail.Invoice {
  return invoiceRail.buildInvoice({
    issuer: args.issuer, payTo: args.payTo, asset: usdcAsset, chain: config.chainId,
    dueAt: Math.floor(Date.now() / 1000) + (args.dueInSeconds ?? 86_400), nonce: BigInt(Date.now()),
    lineItems: args.lineItems, memo: args.memo,
  });
}

export async function payInvoice(ctx: PayCtx, invoice: invoiceRail.Invoice): Promise<Hex> {
  await requireUsdc(ctx, invoice.amount, 'this invoice');
  const { data } = buildErc20Transfer(config.mockUsdc, invoice.payTo, invoice.amount);
  return executeViaSa(ctx.wallet, ctx.treasurySa, config.mockUsdc, 0n, data);
}

// ── F5 / F9 escrow (hold → release | reclaim), payer = Treasury SA ───

export async function escrowDeposit(ctx: PayCtx, p: { orderHash: Hex32; amount: bigint; expiresInSeconds?: number }): Promise<{ approveHash: Hex; depositHash: Hex }> {
  await requireUsdc(ctx, p.amount, 'the escrow deposit');
  // Treasury SA approves the escrow, then deposits (deposit pulls from msg.sender = the Treasury SA).
  const approveHash = await executeViaSa(ctx.wallet, ctx.treasurySa, config.mockUsdc, 0n, buildErc20Approve(config.mockUsdc, config.paymentEscrow, p.amount).data);
  const depositData = escrowRail.buildEscrowDeposit({
    escrow: config.paymentEscrow, orderHash: p.orderHash, asset: config.mockUsdc, amount: p.amount,
    payee: ctx.providerTreasury, refundTo: ctx.treasurySa, releaser: ctx.treasurySa,
    expiry: Math.floor(Date.now() / 1000) + (p.expiresInSeconds ?? 120),
  }).data;
  const depositHash = await executeViaSa(ctx.wallet, ctx.treasurySa, config.paymentEscrow, 0n, depositData);
  return { approveHash, depositHash };
}

export async function escrowRelease(ctx: PayCtx, orderHash: Hex32): Promise<Hex> {
  return executeViaSa(ctx.wallet, ctx.treasurySa, config.paymentEscrow, 0n, escrowRail.buildEscrowRelease(config.paymentEscrow, orderHash).data);
}
export async function escrowReclaim(ctx: PayCtx, orderHash: Hex32): Promise<Hex> {
  return executeViaSa(ctx.wallet, ctx.treasurySa, config.paymentEscrow, 0n, escrowRail.buildEscrowReclaim(config.paymentEscrow, orderHash).data);
}

export interface EscrowHold {
  payer: Address; asset: Address; amount: bigint; payee: Address;
  refundTo: Address; releaser: Address; expiry: bigint; status: number;
}
export async function readEscrowHold(orderHash: Hex32): Promise<EscrowHold> {
  return (await publicClient.readContract({ address: config.paymentEscrow, abi: escrowRail.ESCROW_ABI, functionName: 'getHold', args: [orderHash] })) as unknown as EscrowHold;
}
export const ESCROW_STATUS_LABEL: Record<number, string> = { 0: 'none', 1: 'held', 2: 'captured', 3: 'refunded', 4: 'reclaimed' };

// ── F6 split payout (from Treasury SA) ──────────────────────────────

export async function splitPay(ctx: PayCtx, amount: bigint, recipients: SplitRecipient[]): Promise<{ to: Address; amount: bigint; hash: Hex }[]> {
  await requireUsdc(ctx, amount, 'the split');
  const legs = buildSplitPayout({ asset: config.mockUsdc, amount, recipients });
  const out: { to: Address; amount: bigint; hash: Hex }[] = [];
  for (const leg of legs) {
    const { data } = buildErc20Transfer(config.mockUsdc, leg.to, leg.amount);
    out.push({ to: leg.to, amount: leg.amount, hash: await executeViaSa(ctx.wallet, ctx.treasurySa, config.mockUsdc, 0n, data) });
  }
  return out;
}

// ── entitlement (pay-after-fulfillment, F9) ─────────────────────────

export const SERVICE_SCOPE = entitlement.scopeHashOf('premium-service');
export function grantEntitlement(args: { subject: Address; mandateId: Hex32; settlementHash: Hex32; maxUses?: number; ttlSeconds?: number }): entitlement.EntitlementRecord {
  return entitlement.mintEntitlementOnPayment({
    binding: 'sa', scopeHash: SERVICE_SCOPE, subject: args.subject,
    ttl: Math.floor(Date.now() / 1000) + (args.ttlSeconds ?? 3600), maxUses: args.maxUses ?? 3,
    mandateId: args.mandateId, settlementHash: args.settlementHash,
  });
}

// ── F4 subscription (recurring profile) ─────────────────────────────

export type Subscription = ReturnType<typeof recurringRail.buildRecurringTemplate>;
export function buildSubscription(payer: Address, treasury: Address): Subscription {
  const now = Math.floor(Date.now() / 1000);
  return recurringRail.buildRecurringTemplate({
    payer, payee: treasury, asset: usdcAsset, chain: config.chainId,
    amountPerPeriod: toUsdc(1), windowSeconds: 60, totalCap: toUsdc(4),
    validFrom: now, validUntil: now + 3600, startNonce: BigInt(Date.now()),
  });
}
export function subscriptionWindow(sub: Subscription, period: number) { return recurringRail.periodWindow(sub, period); }

export async function settlePeriod(ctx: PayCtx, sub: Subscription, period: number): Promise<Hex> {
  await requireUsdc(ctx, sub.amountPerPeriod, 'this subscription charge');
  recurringRail.deriveScheduledCharge(sub, period); // validates the period/window
  const { data } = buildErc20Transfer(config.mockUsdc, ctx.providerTreasury, sub.amountPerPeriod);
  return executeViaSa(ctx.wallet, ctx.treasurySa, config.mockUsdc, 0n, data);
}

// ── F2 anonymous (VOPRF blind voucher pack) ─────────────────────────

export type Voucher = ReturnType<typeof entitlement.voucher.unblindVoucher>;
const VOUCHER_ISSUER = entitlement.voucher.deriveVoucherIssuerKey(('0x' + 'a7'.repeat(32)) as Hex);
const voucherSpent = entitlement.voucher.createMemorySpentSet();

export interface VoucherPack { payHash: Hex; vouchers: Voucher[]; blinded: string[]; }

export async function buyVoucherPack(ctx: PayCtx, count: number): Promise<VoucherPack> {
  const payHash = await directPay(ctx, toUsdc(0.1 * count));
  const reqs = Array.from({ length: count }, () => entitlement.voucher.blindVoucherRequest());
  const issued = entitlement.voucher.issueVouchers(VOUCHER_ISSUER, reqs.map((r) => r.request));
  const vouchers = issued.map((iss, i) => entitlement.voucher.unblindVoucher(reqs[i]!.secret, iss, VOUCHER_ISSUER.publicKey));
  return { payHash, vouchers, blinded: reqs.map((r) => r.request.blinded) };
}
export async function redeemVoucher(voucher: Voucher): Promise<{ ok: boolean; reason?: string }> {
  return entitlement.voucher.redeemVoucher(VOUCHER_ISSUER, voucher, voucherSpent);
}

// ── F7 ops ──────────────────────────────────────────────────────────

export const eventLog = opsApi.createPaymentEventLog();
export type ReceiptRow = opsApi.ReceiptRow;
export const opsHelpers = {
  balanceDelta: opsApi.balanceDelta, isOrderPaid: opsApi.isOrderPaid, listReceiptsBy: opsApi.listReceiptsBy,
  exportReceiptsCSV: opsApi.exportReceiptsCSV, exportReceiptsJSON: opsApi.exportReceiptsJSON,
};
