/**
 * Shared transfer-plan plumbing for the non-x402 rails (spec 243 §5.5).
 *
 * A `TransferPlan` is the inner call an SA executes (`AgentAccount.execute(to, value, data)`
 * or a UserOp / wallet tx) — the same `{to, value, data}` shape the x402 rail's
 * `buildRedemptionCalldata` returns. Wallet / invoice / refund / split all reduce to one or
 * more ERC-20 transfers from the payer or treasury SA.
 */

import { encodeFunctionData, type Address, type Hex } from 'viem';

export interface TransferPlan {
  to: Address;
  value: bigint;
  data: Hex;
}

export const ERC20_TRANSFER_ABI = [
  {
    type: 'function',
    name: 'transfer',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ type: 'bool' }],
  },
] as const;

/** A single ERC-20 transfer: the executing SA calls `asset.transfer(to, amount)`. */
export function buildErc20Transfer(asset: Address, to: Address, amount: bigint): TransferPlan {
  return {
    to: asset,
    value: 0n,
    data: encodeFunctionData({ abi: ERC20_TRANSFER_ABI, functionName: 'transfer', args: [to, amount] }),
  };
}

/** A native-value transfer (the executing SA sends `amount` wei to `to`). */
export function buildNativeTransfer(to: Address, amount: bigint): TransferPlan {
  return { to, value: amount, data: '0x' };
}
