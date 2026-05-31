import { describe, it, expect, beforeEach, vi } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';
import type { Hex } from 'viem';
import { createMemoryAuditSink } from '@agenticprimitives/audit';
import {
  createSpendCappedAccount,
  SpendCapExceededError,
} from '../../src/spend-capped-account';

const TEST_PRIV = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
const TARGET = '0x1234567890123456789012345678901234567890' as Hex;

const ONE_ETH = 10n ** 18n;
const TENTH_ETH = 10n ** 17n;
const CAP = TENTH_ETH; // 0.1 ETH per tx

function baseTx(value: bigint | undefined) {
  return {
    chainId: 31337,
    nonce: 0,
    to: TARGET,
    value,
    gas: 21000n,
    maxFeePerGas: 1_000_000_000n,
    maxPriorityFeePerGas: 1_000_000_000n,
    type: 'eip1559' as const,
  };
}

describe('createSpendCappedAccount (R5.12b / PKG-KEY-CUSTODY-010)', () => {
  beforeEach(() => {
    process.env.NODE_ENV = 'test';
  });

  // ─── Construction ───────────────────────────────────────────────

  it('rejects negative cap at construction', () => {
    const inner = privateKeyToAccount(TEST_PRIV);
    expect(() => createSpendCappedAccount(inner, { capWei: -1n })).toThrow(
      /capWei must be >= 0/,
    );
  });

  it('cap of 0 is permitted at construction (blocks all value txs)', () => {
    const inner = privateKeyToAccount(TEST_PRIV);
    expect(() => createSpendCappedAccount(inner, { capWei: 0n })).not.toThrow();
  });

  it('exposes the inner account address + sets source=kms-spend-capped', () => {
    const inner = privateKeyToAccount(TEST_PRIV);
    const capped = createSpendCappedAccount(inner, { capWei: CAP });
    expect(capped.address.toLowerCase()).toBe(inner.address.toLowerCase());
    expect(capped.source).toBe('kms-spend-capped');
  });

  // ─── signTransaction value gate ─────────────────────────────────

  it('PASSES when value < cap', async () => {
    const inner = privateKeyToAccount(TEST_PRIV);
    const capped = createSpendCappedAccount(inner, { capWei: CAP });
    const signed = await capped.signTransaction(baseTx(TENTH_ETH / 2n)); // 0.05 ETH
    expect(signed).toMatch(/^0x/);
  });

  it('PASSES exactly at cap (boundary, not a violation)', async () => {
    const inner = privateKeyToAccount(TEST_PRIV);
    const capped = createSpendCappedAccount(inner, { capWei: CAP });
    const signed = await capped.signTransaction(baseTx(CAP));
    expect(signed).toMatch(/^0x/);
  });

  it('REJECTS when value > cap (throws SpendCapExceededError)', async () => {
    const inner = privateKeyToAccount(TEST_PRIV);
    const capped = createSpendCappedAccount(inner, { capWei: CAP });
    await expect(capped.signTransaction(baseTx(ONE_ETH))).rejects.toBeInstanceOf(
      SpendCapExceededError,
    );
  });

  it('REJECTS just above cap (off-by-one)', async () => {
    const inner = privateKeyToAccount(TEST_PRIV);
    const capped = createSpendCappedAccount(inner, { capWei: CAP });
    await expect(capped.signTransaction(baseTx(CAP + 1n))).rejects.toBeInstanceOf(
      SpendCapExceededError,
    );
  });

  it('rejection message identifies cap + requested + target + signer', async () => {
    const inner = privateKeyToAccount(TEST_PRIV);
    const capped = createSpendCappedAccount(inner, { capWei: CAP });
    try {
      await capped.signTransaction(baseTx(ONE_ETH));
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(SpendCapExceededError);
      const e = err as SpendCapExceededError;
      expect(e.capWei).toBe(CAP);
      expect(e.requestedValue).toBe(ONE_ETH);
      expect(e.to?.toLowerCase()).toBe(TARGET.toLowerCase());
      expect(e.signerAddress.toLowerCase()).toBe(inner.address.toLowerCase());
      expect(e.message).toContain('cap is');
      expect(e.message).toContain(CAP.toString());
      expect(e.message).toContain(ONE_ETH.toString());
    }
  });

  // ─── value normalisation ────────────────────────────────────────

  it('undefined value → treated as 0 → passes (under cap)', async () => {
    const inner = privateKeyToAccount(TEST_PRIV);
    const capped = createSpendCappedAccount(inner, { capWei: CAP });
    const signed = await capped.signTransaction(baseTx(undefined));
    expect(signed).toMatch(/^0x/);
  });

  it('numeric value (legacy viem call shape) is normalised to bigint', async () => {
    const inner = privateKeyToAccount(TEST_PRIV);
    const capped = createSpendCappedAccount(inner, { capWei: CAP });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tx: any = baseTx(undefined);
    tx.value = 100; // number, not bigint
    const signed = await capped.signTransaction(tx);
    expect(signed).toMatch(/^0x/);
  });

  it('string value (decimal) is normalised to bigint', async () => {
    const inner = privateKeyToAccount(TEST_PRIV);
    const capped = createSpendCappedAccount(inner, { capWei: CAP });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tx: any = baseTx(undefined);
    tx.value = '50000000000000000'; // 0.05 ETH as decimal string
    const signed = await capped.signTransaction(tx);
    expect(signed).toMatch(/^0x/);
  });

  it('cap of 0 BLOCKS any positive value tx', async () => {
    const inner = privateKeyToAccount(TEST_PRIV);
    const capped = createSpendCappedAccount(inner, { capWei: 0n });
    await expect(capped.signTransaction(baseTx(1n))).rejects.toBeInstanceOf(
      SpendCapExceededError,
    );
  });

  it('cap of 0 PASSES a zero-value tx (e.g. contract write that sends no ETH)', async () => {
    const inner = privateKeyToAccount(TEST_PRIV);
    const capped = createSpendCappedAccount(inner, { capWei: 0n });
    const signed = await capped.signTransaction(baseTx(0n));
    expect(signed).toMatch(/^0x/);
  });

  // ─── signMessage / signTypedData pass-through ───────────────────

  it('signMessage delegates verbatim (no cap applies to messages)', async () => {
    const inner = privateKeyToAccount(TEST_PRIV);
    const capped = createSpendCappedAccount(inner, { capWei: 0n });
    const sig = await capped.signMessage({ message: 'hello' });
    const expected = await inner.signMessage({ message: 'hello' });
    expect(sig).toBe(expected);
  });

  it('signTypedData delegates verbatim (no cap applies to typed data)', async () => {
    const inner = privateKeyToAccount(TEST_PRIV);
    const capped = createSpendCappedAccount(inner, { capWei: 0n });
    const args = {
      domain: { name: 'Test', version: '1', chainId: 31337 },
      types: { Mail: [{ name: 'contents', type: 'string' }] },
      primaryType: 'Mail' as const,
      message: { contents: 'hello' },
    };
    const sig = await capped.signTypedData(args);
    const expected = await inner.signTypedData(args);
    expect(sig).toBe(expected);
  });

  // ─── Audit emission on reject ───────────────────────────────────

  it('emits key-custody.relay.spend-cap.reject when cap is exceeded', async () => {
    const sink = createMemoryAuditSink();
    const inner = privateKeyToAccount(TEST_PRIV);
    const capped = createSpendCappedAccount(inner, { capWei: CAP, auditSink: sink });
    await expect(capped.signTransaction(baseTx(ONE_ETH))).rejects.toBeInstanceOf(
      SpendCapExceededError,
    );
    const events = sink.events();
    expect(events).toHaveLength(1);
    const evt = events[0]!;
    expect(evt.action).toBe('key-custody.relay.spend-cap.reject');
    expect(evt.outcome).toBe('denied');
    expect(evt.actor?.id?.toLowerCase()).toBe(inner.address.toLowerCase());
    expect(evt.subject?.type).toBe('transaction');
    expect(evt.context?.capWei).toBe(CAP.toString());
    expect(evt.context?.requestedValue).toBe(ONE_ETH.toString());
    expect((evt.context?.to as string).toLowerCase()).toBe(TARGET.toLowerCase());
  });

  it('does NOT emit audit on success path', async () => {
    const sink = createMemoryAuditSink();
    const inner = privateKeyToAccount(TEST_PRIV);
    const capped = createSpendCappedAccount(inner, { capWei: CAP, auditSink: sink });
    await capped.signTransaction(baseTx(TENTH_ETH / 2n));
    expect(sink.events()).toHaveLength(0);
  });

  it('fail-soft: throwing audit sink does NOT swallow the SpendCapExceededError', async () => {
    const throwingSink = {
      async write() {
        throw new Error('sink down');
      },
    };
    const inner = privateKeyToAccount(TEST_PRIV);
    const capped = createSpendCappedAccount(inner, {
      capWei: CAP,
      auditSink: throwingSink,
    });
    // Even though the sink throws, the SpendCapExceededError still propagates.
    await expect(capped.signTransaction(baseTx(ONE_ETH))).rejects.toBeInstanceOf(
      SpendCapExceededError,
    );
  });

  it('no audit sink: rejection still throws, just no audit row', async () => {
    const inner = privateKeyToAccount(TEST_PRIV);
    const capped = createSpendCappedAccount(inner, { capWei: CAP });
    await expect(capped.signTransaction(baseTx(ONE_ETH))).rejects.toBeInstanceOf(
      SpendCapExceededError,
    );
  });

  // ─── KMS round-trip avoidance ──────────────────────────────────

  it('HSM never sees the digest when cap is exceeded (inner.signTransaction NOT called)', async () => {
    const inner = privateKeyToAccount(TEST_PRIV);
    const signSpy = vi.spyOn(inner, 'signTransaction');
    const capped = createSpendCappedAccount(inner, { capWei: CAP });
    await expect(capped.signTransaction(baseTx(ONE_ETH))).rejects.toBeInstanceOf(
      SpendCapExceededError,
    );
    expect(signSpy).not.toHaveBeenCalled();
    signSpy.mockRestore();
  });

  it('HSM is called once when cap is honoured', async () => {
    const inner = privateKeyToAccount(TEST_PRIV);
    const signSpy = vi.spyOn(inner, 'signTransaction');
    const capped = createSpendCappedAccount(inner, { capWei: CAP });
    await capped.signTransaction(baseTx(CAP / 2n));
    expect(signSpy).toHaveBeenCalledTimes(1);
    signSpy.mockRestore();
  });
});
