/**
 * BundlerClient unit tests — mocks viem so getUserOpHash + sendUserOps
 * exercise our wiring without hitting a real EntryPoint.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  BundlerClient,
  packGasLimits,
  unpackGasLimits,
  type PackedUserOperation,
} from '../../src/bundler-client';

const ENTRY_POINT = '0xc3001F36478f50018C616eB808ab61874414e904' as const;
const SENDER = '0x1234567890123456789012345678901234567890' as const;
const BENEFICIARY = '0xfeedfacefeedfacefeedfacefeedfacefeedface' as const;
const MOCK_HASH = ('0x' + 'ab'.repeat(32)) as `0x${string}`;
const MOCK_TX_HASH = ('0x' + 'cd'.repeat(32)) as `0x${string}`;

const fakeReadContract = vi.fn();
const fakeWaitForReceipt = vi.fn();
const fakeWriteContract = vi.fn();

vi.mock('viem', async (importOriginal) => {
  const real = await importOriginal<typeof import('viem')>();
  return {
    ...real,
    createPublicClient: vi.fn(() => ({
      readContract: fakeReadContract,
      waitForTransactionReceipt: fakeWaitForReceipt,
    })),
    createWalletClient: vi.fn(() => ({
      writeContract: fakeWriteContract,
    })),
    http: vi.fn(() => ({})),
  };
});

function fakeUserOp(): PackedUserOperation {
  return {
    sender: SENDER,
    nonce: 0n,
    initCode: '0xfactorycalldata',
    callData: '0x',
    accountGasLimits: packGasLimits(500_000n, 100_000n),
    preVerificationGas: 50_000n,
    gasFees: packGasLimits(1_500_000_000n, 2_000_000_000n),
    paymasterAndData: '0x',
    signature: '0xdeadbeef',
  };
}

describe('packGasLimits / unpackGasLimits', () => {
  it('round-trips two uint128 values', () => {
    const high = 500_000n;
    const low = 100_000n;
    const packed = packGasLimits(high, low);
    expect(packed).toMatch(/^0x[a-f0-9]{64}$/);
    const out = unpackGasLimits(packed);
    expect(out.high).toBe(high);
    expect(out.low).toBe(low);
  });

  it('handles max uint128 values', () => {
    const max128 = (1n << 128n) - 1n;
    const packed = packGasLimits(max128, max128);
    const out = unpackGasLimits(packed);
    expect(out.high).toBe(max128);
    expect(out.low).toBe(max128);
  });

  it('rejects out-of-range values', () => {
    expect(() => packGasLimits(1n << 128n, 0n)).toThrow(/out of uint128/);
    expect(() => packGasLimits(0n, 1n << 128n)).toThrow(/out of uint128/);
    expect(() => packGasLimits(-1n, 0n)).toThrow(/out of uint128/);
  });

  it('handles zero values', () => {
    const packed = packGasLimits(0n, 0n);
    expect(packed).toBe('0x' + '0'.repeat(64));
    const out = unpackGasLimits(packed);
    expect(out.high).toBe(0n);
    expect(out.low).toBe(0n);
  });
});

describe('BundlerClient', () => {
  let bundler: BundlerClient;
  beforeEach(() => {
    bundler = new BundlerClient({
      rpcUrl: 'http://127.0.0.1:8545',
      entryPoint: ENTRY_POINT,
    });
    fakeReadContract.mockReset();
    fakeWaitForReceipt.mockReset();
    fakeWriteContract.mockReset();
  });

  it('getUserOpHash calls entryPoint.getUserOpHash with the userOp', async () => {
    fakeReadContract.mockResolvedValueOnce(MOCK_HASH);
    const userOp = fakeUserOp();
    const hash = await bundler.getUserOpHash(userOp);
    expect(hash).toBe(MOCK_HASH);
    expect(fakeReadContract).toHaveBeenCalledOnce();
    const call = fakeReadContract.mock.calls[0]![0] as {
      address: string;
      functionName: string;
      args: unknown[];
    };
    expect(call.address).toBe(ENTRY_POINT);
    expect(call.functionName).toBe('getUserOpHash');
    expect(call.args).toEqual([userOp]);
  });

  it('getNonce calls entryPoint.getNonce(sender, key)', async () => {
    fakeReadContract.mockResolvedValueOnce(42n);
    const nonce = await bundler.getNonce(SENDER, 0n);
    expect(nonce).toBe(42n);
    const call = fakeReadContract.mock.calls[0]![0] as { functionName: string; args: unknown[] };
    expect(call.functionName).toBe('getNonce');
    expect(call.args).toEqual([SENDER, 0n]);
  });

  it('getNonce defaults key=0 when omitted', async () => {
    fakeReadContract.mockResolvedValueOnce(0n);
    await bundler.getNonce(SENDER);
    const call = fakeReadContract.mock.calls[0]![0] as { args: unknown[] };
    expect(call.args).toEqual([SENDER, 0n]);
  });

  it('sendUserOps calls handleOps with the batch + beneficiary', async () => {
    fakeWriteContract.mockResolvedValueOnce(MOCK_TX_HASH);
    fakeWaitForReceipt.mockResolvedValueOnce({ status: 'success', transactionHash: MOCK_TX_HASH });
    const userOps = [fakeUserOp(), fakeUserOp()];
    const viemAccount = { address: BENEFICIARY, type: 'local' };
    const receipt = await bundler.sendUserOps(userOps, BENEFICIARY, viemAccount);
    expect((receipt as { transactionHash: string }).transactionHash).toBe(MOCK_TX_HASH);
    const call = fakeWriteContract.mock.calls[0]![0] as {
      address: string;
      functionName: string;
      args: unknown[];
    };
    expect(call.address).toBe(ENTRY_POINT);
    expect(call.functionName).toBe('handleOps');
    expect(call.args).toEqual([userOps, BENEFICIARY]);
  });

  it('sendUserOps waits for receipt before returning', async () => {
    fakeWriteContract.mockResolvedValueOnce(MOCK_TX_HASH);
    fakeWaitForReceipt.mockResolvedValueOnce({ status: 'success', transactionHash: MOCK_TX_HASH });
    await bundler.sendUserOps([fakeUserOp()], BENEFICIARY, { address: BENEFICIARY });
    expect(fakeWaitForReceipt).toHaveBeenCalledWith({ hash: MOCK_TX_HASH });
  });
});
