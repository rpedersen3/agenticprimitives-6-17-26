import { describe, it, expect } from 'vitest';
import { decodeFunctionData } from 'viem';
import {
  wallet, invoice, buildRefund, buildSplitPayout, ERC20_TRANSFER_ABI, mandateAmount, type Hex32,
} from '../../src/index.js';

const USDC = '0x00000000000000000000000000000000000005dc' as const;
const PAYER = '0x000000000000000000000000000000000000dead' as const;
const PAYEE = '0x0000000000000000000000000000000000007ee1' as const;
const PLATFORM = '0x00000000000000000000000000000000000091a7' as const;
const asset = { id: USDC, symbol: 'USDC', decimals: 6 };

function decodeTransfer(data: `0x${string}`) {
  const { functionName, args } = decodeFunctionData({ abi: ERC20_TRANSFER_ABI, data });
  return { functionName, args: [(args[0] as string).toLowerCase(), args[1]] as const };
}

describe('wallet rail (spec 243 §5.5)', () => {
  it('builds a closed mandate + a direct transfer plan to the payee', () => {
    const m = wallet.buildWalletMandate({ payer: PAYER, payee: PAYEE, asset, amount: 1_000_000n, chain: 84532, nonce: 7n, expiresAt: 2_000_000_000 });
    expect(m.mode).toBe('closed');
    expect(m.maxRedemptions).toBe(1);
    expect(m.rail).toBe('wallet');
    const plan = wallet.buildWalletTransferPlan(m);
    expect(plan.to).toBe(USDC);
    expect(plan.value).toBe(0n);
    const { functionName, args } = decodeTransfer(plan.data);
    expect(functionName).toBe('transfer');
    expect(args).toEqual([PAYEE, 1_000_000n]);
  });
});

describe('invoice rail (spec 243 §5.5)', () => {
  it('sums line items + pays via a mandate bound to the invoice', () => {
    const inv = invoice.buildInvoice({
      issuer: PAYEE, payTo: PAYEE, asset, chain: 84532, dueAt: 2_000_000_000, nonce: 1n,
      lineItems: [{ description: 'seat A', amount: 600_000n }, { description: 'seat B', amount: 400_000n }],
      memo: 'B2B order #42',
    });
    expect(inv.amount).toBe(1_000_000n);
    expect(inv.invoiceId).toMatch(/^0x[0-9a-f]{64}$/i);
    expect(inv.memoHash).not.toBe('0x' + '00'.repeat(32));

    const { mandate, plan } = invoice.payInvoice(inv, PAYER, { nonce: 9n });
    expect(mandate.payee).toBe(PAYEE);
    expect(mandateAmount(mandate)).toBe(1_000_000n);
    // bound to the invoice: orderHash defaults to invoiceId, legId = invoiceId
    expect(mandate.contextBinding.orderHash).toBe(inv.invoiceId);
    expect(mandate.contextBinding.legId).toBe(inv.invoiceId);
    expect(decodeTransfer(plan.data).args).toEqual([PAYEE, 1_000_000n]);
  });

  it('empty / zero invoice rejected', () => {
    expect(() => invoice.buildInvoice({ issuer: PAYEE, payTo: PAYEE, asset, chain: 84532, dueAt: 1, nonce: 1n, lineItems: [{ description: 'x', amount: 0n }] })).toThrow();
  });
});

describe('refund (spec 243 §5.5 / EXC-D3)', () => {
  it('reverse leg returns to the payer with provenance', () => {
    const orig = ('0x' + '11'.repeat(32)) as Hex32;
    const r = buildRefund({ asset: USDC, amount: 250_000n, payer: PAYER, originalMandateId: orig });
    expect(r.provenance).toEqual({ refunds: orig });
    expect(decodeTransfer(r.plan.data).args).toEqual([PAYER, 250_000n]);
  });
  it('zero refund rejected', () => {
    expect(() => buildRefund({ asset: USDC, amount: 0n, payer: PAYER, originalMandateId: ('0x' + '11'.repeat(32)) as Hex32 })).toThrow();
  });
});

describe('split payout (spec 243 §5.5)', () => {
  it('splits exactly by bps with no dust (remainder to first recipient)', () => {
    const legs = buildSplitPayout({ asset: USDC, amount: 1_000_001n, recipients: [{ to: PAYEE, bps: 9000 }, { to: PLATFORM, bps: 1000 }] });
    expect(legs).toHaveLength(2);
    const total = legs.reduce((s, l) => s + l.amount, 0n);
    expect(total).toBe(1_000_001n); // exact, no dust
    expect(legs[1].amount).toBe(100_000n); // platform 10%
    expect(legs[0].amount).toBe(900_001n); // provider 90% + 1 wei remainder
    expect(decodeTransfer(legs[1].plan.data).args).toEqual([PLATFORM, 100_000n]);
  });
  it('rejects bps not summing to 10000 + zero/empty', () => {
    expect(() => buildSplitPayout({ asset: USDC, amount: 100n, recipients: [{ to: PAYEE, bps: 9000 }] })).toThrow(/sum to 10000/);
    expect(() => buildSplitPayout({ asset: USDC, amount: 100n, recipients: [] })).toThrow();
    expect(() => buildSplitPayout({ asset: USDC, amount: 0n, recipients: [{ to: PAYEE, bps: 10000 }] })).toThrow();
  });
});
