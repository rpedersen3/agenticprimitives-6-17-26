import { describe, it, expect } from 'vitest';
import { decodeFunctionData } from 'viem';
import { escrow, recurring, ops, mandateAmount, type Hex32 } from '../../src/index.js';

const USDC = '0x00000000000000000000000000000000000005dc' as const;
const PAYER = '0x000000000000000000000000000000000000dead' as const;
const PAYEE = '0x0000000000000000000000000000000000007ee1' as const;
const ESCROW = '0x954Ba6B3A02E02c5a3Fcd570943126633071cbdD' as const;
const ORDER = ('0x' + 'ab'.repeat(32)) as Hex32;
const asset = { id: USDC, symbol: 'USDC', decimals: 6 };

const dec = (data: `0x${string}`) => decodeFunctionData({ abi: escrow.ESCROW_ABI, data });

describe('escrow rail (spec 243 §5.5)', () => {
  it('deposit encodes all hold params to the escrow contract', () => {
    const plan = escrow.buildEscrowDeposit({ escrow: ESCROW, orderHash: ORDER, asset: USDC, amount: 2_500_000n, payee: PAYEE, refundTo: PAYER, expiry: 2_000_000_000 });
    expect(plan.to).toBe(ESCROW);
    const { functionName, args } = dec(plan.data);
    expect(functionName).toBe('deposit');
    expect(args[0]).toBe(ORDER);
    expect(args[2]).toBe(2_500_000n);
  });
  it('release/refund/reclaim encode the order hash', () => {
    for (const [fn, build] of [['release', escrow.buildEscrowRelease], ['refund', escrow.buildEscrowRefund], ['reclaim', escrow.buildEscrowReclaim]] as const) {
      const p = build(ESCROW, ORDER);
      const d = dec(p.data);
      expect(d.functionName).toBe(fn);
      expect(d.args[0]).toBe(ORDER);
    }
  });
  it('status enum mirrors the contract', () => {
    expect(escrow.EscrowStatus.Held).toBe(1);
    expect(escrow.EscrowStatus.Captured).toBe(2);
    expect(escrow.EscrowStatus.Reclaimed).toBe(4);
  });
});

describe('recurring profile (spec 243 §5.5 / PMT-10)', () => {
  const t = recurring.buildRecurringTemplate({
    payer: PAYER, payee: PAYEE, asset, chain: 84532,
    amountPerPeriod: 1_000_000n, windowSeconds: 604_800, totalCap: 4_000_000n,
    validFrom: 1_000_000, validUntil: 5_000_000, startNonce: 100n,
  });

  it('computes periods from totalCap / amountPerPeriod', () => {
    expect(t.periods).toBe(4);
    expect(t.templateId).toMatch(/^0x[0-9a-f]{64}$/i);
  });
  it('caveat params map to the PaymentEnforcer window + caps', () => {
    expect(recurring.recurringCaveatParams(t)).toEqual({ maxAmountPerCharge: 1_000_000n, maxAggregate: 4_000_000n, maxRedemptionsPerWindow: 1, windowSeconds: 604_800, validUntil: 5_000_000 });
  });
  it('period N derives a closed charge in its own window with a distinct nonce', () => {
    const c0 = recurring.deriveScheduledCharge(t, 0);
    const c1 = recurring.deriveScheduledCharge(t, 1);
    expect(c0.mandate.mode).toBe('closed');
    expect(mandateAmount(c0.mandate)).toBe(1_000_000n);
    expect(c0.mandate.nonce).toBe(100n);
    expect(c1.mandate.nonce).toBe(101n);
    expect(c0.window).toEqual({ start: 1_000_000, end: 1_604_800 });
    expect(c1.window.start).toBe(1_604_800); // next window starts where the prior ends
  });
  it('rejects out-of-range periods + bad inputs', () => {
    expect(() => recurring.deriveScheduledCharge(t, 4)).toThrow(/out of range/);
    expect(() => recurring.buildRecurringTemplate({ ...t, amountPerPeriod: 0n })).toThrow();
    expect(() => recurring.buildRecurringTemplate({ ...t, totalCap: 1n })).toThrow();
  });
});

describe('ops core (spec 243 §5.5)', () => {
  it('event log is idempotent + notifies subscribers once', () => {
    const log = ops.createPaymentEventLog();
    const seen: string[] = [];
    log.subscribe((e) => seen.push(e.type));
    expect(log.emit({ idempotencyKey: 'k1', type: 'payment.settled', at: 1, orderHash: ORDER }).accepted).toBe(true);
    expect(log.emit({ idempotencyKey: 'k1', type: 'payment.settled', at: 1, orderHash: ORDER }).accepted).toBe(false); // dup
    expect(log.emit({ idempotencyKey: 'k2', type: 'payment.refunded', at: 2, orderHash: ORDER }).accepted).toBe(true);
    expect(seen).toEqual(['payment.settled', 'payment.refunded']); // notified once each
    expect(log.byType('payment.settled')).toHaveLength(1);
    expect(log.byOrder(ORDER)).toHaveLength(2);
  });

  const receipts: ops.ReceiptRow[] = [
    { mandateId: ('0x' + '11'.repeat(32)) as Hex32, payer: PAYER, payee: PAYEE, asset: USDC, amount: 1_000_000n, settlementHash: ('0x' + 'a1'.repeat(32)) as Hex32, at: 1, orderHash: ORDER },
    { mandateId: ('0x' + '22'.repeat(32)) as Hex32, payer: PAYEE, payee: PAYER, asset: USDC, amount: 250_000n, settlementHash: ('0x' + 'a2'.repeat(32)) as Hex32, at: 2, orderHash: ORDER, refunds: ('0x' + '11'.repeat(32)) as Hex32 },
  ];

  it('reconciliation: balance delta nets charges + refunds; payment detection ignores refunds', () => {
    expect(ops.balanceDelta(receipts, PAYEE)).toBe(750_000n); // +1.0 charge, -0.25 refund
    expect(ops.balanceDelta(receipts, PAYER)).toBe(-750_000n);
    expect(ops.isOrderPaid(receipts, ORDER)).toBe(true);
    expect(ops.isOrderPaid(receipts, ORDER, 1_000_000n)).toBe(true);
    expect(ops.isOrderPaid(receipts, ORDER, 2_000_000n)).toBe(false);
    expect(ops.listReceiptsBy(receipts, { payee: PAYEE })).toHaveLength(1);
  });

  it('export to CSV + JSON (bigint-safe)', () => {
    const csv = ops.exportReceiptsCSV(receipts);
    expect(csv.split('\n')).toHaveLength(3); // header + 2 rows
    expect(csv).toContain('1000000');
    const json = JSON.parse(ops.exportReceiptsJSON(receipts));
    expect(json[0].amount).toBe('1000000'); // stringified
  });
});
