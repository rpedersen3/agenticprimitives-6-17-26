import { describe, it, expect, vi } from 'vitest';
import { toFunctionSelector } from 'viem';
import { buildErc20TransferCall, readErc20Balance } from '../src/erc20';

const TOKEN = '0x00000000000000000000000000000000000005dc' as const;
const TREASURY = '0x0000000000000000000000000000000000007ee1' as const;

describe('buildErc20TransferCall (PAY-ACCT-2)', () => {
  it('targets the token with a transfer(to,amount) call, value 0', () => {
    const call = buildErc20TransferCall(TOKEN, TREASURY, 1_000_000n);
    expect(call.to).toBe(TOKEN);
    expect(call.value).toBe(0n);
    expect(call.data.slice(0, 10)).toBe(toFunctionSelector('transfer(address,uint256)'));
  });
});

describe('readErc20Balance (PAY-ACCT-1)', () => {
  it('calls balanceOf(owner) and returns the bigint', async () => {
    const readContract = vi.fn().mockResolvedValue(42_000_000n);
    const bal = await readErc20Balance(readContract, TOKEN, TREASURY);
    expect(bal).toBe(42_000_000n);
    expect(readContract).toHaveBeenCalledWith(
      expect.objectContaining({ address: TOKEN, functionName: 'balanceOf', args: [TREASURY] }),
    );
  });
});
