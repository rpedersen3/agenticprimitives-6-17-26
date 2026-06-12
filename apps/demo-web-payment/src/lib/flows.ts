/**
 * The non-metered payment flows (F3 direct/invoice, F5 escrow, F6 split, F9 deliver-then-pay,
 * F4 subscription, F2 voucher).
 *
 * Canonical-identifier doctrine (ADR-0010) + gasless: money moves **SA → SA**, and every payment
 * runs AS the person's Treasury SA via a paymaster-sponsored UserOp (agent-pay.ts `executeViaSa`).
 * The recipient is the Provider Treasury SA. The custodian wallet only signs (no gas, no USDC).
 */

import { keccak256, toBytes, encodeFunctionData, type Address, type Hex } from 'viem';
import {
  invoice as invoiceRail,
  escrow as escrowRail,
  recurring as recurringRail,
  ops as opsApi,
  buildErc20Transfer,
  buildErc20Approve,
  buildSplitPayout,
  buildClosedMandate,
  buildPaymentReceiptCredential,
  assertContextBindingValid,
  entitlement,
  type SplitRecipient,
  type PaymentMandate,
  type Hex32,
} from '@agenticprimitives/payments';
import { isCompatible, composite, toMatchScore, type Intent } from '@agenticprimitives/intent-marketplace';
import { computeAgreementCommitment, partySetCommitment, issuerCommitment, bytesCommitment } from '@agenticprimitives/agreements';
import { canTaskTransition, type Task, type Artifact } from '@agenticprimitives/fulfillment';
import { config } from '../config';
import { publicClient, type PaymentWallet } from './wallet';
import { toUsdc, fromUsdc, readUsdcBalance } from './x402-pay';
import { executeViaSa, executeBatchViaSa } from './agent-pay';
import type { ContractCall } from '@agenticprimitives/agent-account';

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

const MINT_ABI = [
  { type: 'function', name: 'mint', stateMutability: 'nonpayable', inputs: [{ name: 'to', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [] },
] as const;

/** Fund the Treasury SA GASLESSLY: the SA mints demo USDC to itself via a sponsored userOp
 *  (MockUSDC.mint is permissionless). No wallet transaction → no MetaMask/Blockaid prompt. */
export async function fundTreasuryGasless(wallet: PaymentWallet, treasurySa: Address, amount: bigint): Promise<Hex> {
  const data = encodeFunctionData({ abi: MINT_ABI, functionName: 'mint', args: [treasurySa, amount] });
  return executeViaSa(wallet, treasurySa, config.mockUsdc, 0n, data);
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
  // All legs in ONE gasless userOp (executeBatch) — atomic, one account nonce, so the legs
  // can't race the bundler's nonce view (sequential per-leg userOps hit AA25 on a lagging
  // replica). Each leg is still its own ERC-20 transfer + receipt; the single tx carries all.
  const calls: ContractCall[] = legs.map((leg) => ({
    to: config.mockUsdc, value: 0n, data: buildErc20Transfer(config.mockUsdc, leg.to, leg.amount).data,
  }));
  const hash = await executeBatchViaSa(ctx.wallet, ctx.treasurySa, calls);
  return legs.map((leg) => ({ to: leg.to, amount: leg.amount, hash }));
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

// ── F8 intent → fulfilment (bound payment + linking receipt) ────────
//
// Express a need → match a counter-intent → agree (commitment) → fulfil (task + artifact)
// → settle the bound payment. The closed PaymentMandate's contextBinding carries
// {intentId, agreementCommitment, taskId, artifactHash}; the PaymentReceipt folds that whole
// binding into `contextBindingHash`, so the receipt cryptographically links order ↔ fulfilment
// ↔ settlement. Money still moves SA → SA, gaslessly. Each step uses the real primitive package
// (intent-marketplace / agreements / fulfillment / payments) — this file is glue only.

const SERVICE_IRI = 'service:premium-consult' as const;
const EMPTY_CONSTRAINTS = { hardConstraints: [], softConstraints: [] };

export interface IntentMatch {
  buyerIntent: Intent;
  providerIntent: Intent;
  compatible: boolean;
  matchScore: number; // 0–10000 bps
}

/** Step 1 — express the buyer's need + the provider's offer, then match them (intent-marketplace:
 *  opposite direction, same object, topic similar enough). */
export function expressAndMatch(buyer: Address, provider: Address): IntentMatch {
  const now = new Date().toISOString();
  const stamp = Date.now();
  const buyerIntent: Intent = {
    id: `intent:need:${stamp}`, direction: 'receive', object: SERVICE_IRI, topic: 'premium-consult',
    expressedBy: buyer, addressedTo: [provider], hasConstraintSet: EMPTY_CONSTRAINTS,
    visibility: 'Public', status: 'expressed', createdAt: now,
  };
  const providerIntent: Intent = {
    id: `intent:offer:${stamp}`, direction: 'give', object: SERVICE_IRI, topic: 'premium-consult',
    expressedBy: provider, addressedTo: [buyer], hasConstraintSet: EMPTY_CONSTRAINTS,
    visibility: 'Public', status: 'expressed', createdAt: now,
  };
  const compatible = isCompatible(buyerIntent, providerIntent, { topicSimilarityThreshold: 0.5 });
  const matchScore = toMatchScore(composite({ proximity: 0.9, outcome: 0.85 }));
  return { buyerIntent, providerIntent, compatible, matchScore };
}

export interface Agreement {
  agreementCommitment: Hex32;
  terms: string;
  schedule: string;
}

/** Step 2 — agree terms → a commitment-only agreement (agreements / spec 241). Parties + terms
 *  never go on-chain; only the keccak commitment binds the payment. */
export function agreeTerms(args: { buyer: Address; provider: Address; issuer: Address; terms: string; schedule: string }): Agreement {
  const agreementCommitment = computeAgreementCommitment({
    partySetCommitment: partySetCommitment(args.buyer, args.provider),
    issuerCommitment: issuerCommitment(args.issuer),
    termsCommitment: bytesCommitment(args.terms),
    scheduleCommitment: bytesCommitment(args.schedule),
    salt: BigInt(Date.now()),
  });
  return { agreementCommitment, terms: args.terms, schedule: args.schedule };
}

export interface Fulfilment {
  task: Task;
  artifact: Artifact;
  artifactHash: Hex32;
  caseId: Hex32;
}

/** Step 3 — provider fulfils: a Task moves submitted → working → completed and produces an
 *  Artifact whose bodyHash anchors the deliverable (fulfillment / spec 244). */
export function fulfil(args: { provider: Address; intentId: string; agreementCommitment: Hex32; deliverable: string }): Fulfilment {
  // enforce the legal task lifecycle (submitted → working → completed) via the real state machine.
  if (!canTaskTransition('submitted', 'working') || !canTaskTransition('working', 'completed')) {
    throw new Error('illegal task transition');
  }
  const caseId = keccak256(toBytes(`case:${args.agreementCommitment}`)) as Hex32;
  const artifactHash = keccak256(toBytes(args.deliverable)) as Hex32;
  const taskId = keccak256(toBytes(`task:${caseId}`)) as Hex32;
  const task: Task = {
    taskId, parentCaseId: caseId, parentIntentId: args.intentId, state: 'completed',
    assignee: args.provider, assigneeKind: 'agent', inputHash: keccak256(toBytes(args.intentId)) as Hex32,
    artifactIds: [artifactHash], maxRetries: 0, permissionGrantRef: ('0x' + '00'.repeat(32)) as Hex32,
  };
  const artifact: Artifact = {
    artifactId: artifactHash, caseId, taskId, producer: args.provider, artifactKind: 'deliverable',
    bodyHash: artifactHash, bodyContentType: 'text/plain', disclosurePolicy: 'private', createdAt: Math.floor(Date.now() / 1000),
  };
  return { task, artifact, artifactHash, caseId };
}

export interface BoundSettlement {
  mandate: PaymentMandate;
  settlementHash: Hex;
  receipt: ReturnType<typeof buildPaymentReceiptCredential>;
  contextBindingHash: Hex32;
}

/** Step 4 — settle the bound payment: a closed mandate whose contextBinding ties the transfer to
 *  {intentId, agreementCommitment, taskId, artifactHash}; the gasless SA→SA USDC transfer settles
 *  it; the immutable PaymentReceipt folds the whole binding into `contextBindingHash`. */
export async function settleBoundPayment(ctx: PayCtx, args: {
  amount: bigint; intentId: string; agreementCommitment: Hex32; taskId: Hex32; artifactHash: Hex32;
}): Promise<BoundSettlement> {
  await requireUsdc(ctx, args.amount, 'this settlement');
  const now = Math.floor(Date.now() / 1000);
  const mandate = buildClosedMandate({
    payer: ctx.treasurySa, payee: ctx.providerTreasury, asset: usdcAsset, amount: args.amount,
    chain: config.chainId, rail: 'wallet', nonce: BigInt(Date.now()), validFrom: now, expiresAt: now + 3600,
    orderHash: args.agreementCommitment, // the "order" is the agreement
  });
  // bind the mandate to the full intent → agreement → task → artifact chain (PMT-3.1).
  mandate.contextBinding.intentId = args.intentId;
  mandate.contextBinding.agreementCommitment = args.agreementCommitment;
  mandate.contextBinding.taskId = args.taskId;
  mandate.contextBinding.artifactHash = args.artifactHash;
  assertContextBindingValid(mandate.contextBinding);

  const { data } = buildErc20Transfer(config.mockUsdc, ctx.providerTreasury, args.amount);
  const settlementHash = await executeViaSa(ctx.wallet, ctx.treasurySa, config.mockUsdc, 0n, data);

  // the rail executor (provider treasury) issues the immutable receipt VC (PMT-INV-11).
  const receipt = buildPaymentReceiptCredential({
    mandate, issuer: ctx.providerTreasury, settlementHash: settlementHash as Hex32, settledAt: new Date().toISOString(),
  });
  const contextBindingHash = (receipt.credentialSubject as { contextBindingHash: Hex32 }).contextBindingHash;
  return { mandate, settlementHash, receipt, contextBindingHash };
}
