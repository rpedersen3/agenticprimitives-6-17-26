// Spec 272 PAY-ACCT-1/2 — tiny ERC-20 helpers for the x402 treasury + payer paths. The payer transfer
// is a `ContractCall` (wrap with buildExecuteCallData for a UserOp, OR feed to a delegation redemption);
// the treasury is a plain AgentAccount, so reading its balance is a generic balanceOf.

import { encodeFunctionData, type Address } from 'viem';
import type { ContractCall } from './execute';

const ERC20_TRANSFER_ABI = [
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

const ERC20_BALANCE_ABI = [
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'owner', type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
] as const;

/** Build a `{ to: token, value: 0, data: transfer(to, amount) }` call — the payer leg of an x402 charge.
 *  For a direct UserOp wrap with `buildExecuteCallData`; for x402 it rides the gated `redeemDelegation`. */
export function buildErc20TransferCall(token: Address, to: Address, amount: bigint): ContractCall {
  return {
    to: token,
    value: 0n,
    data: encodeFunctionData({ abi: ERC20_TRANSFER_ABI, functionName: 'transfer', args: [to, amount] }),
  };
}

/** Read an ERC-20 balance (e.g. a treasury AgentAccount's USDC). `readContract` is a `(addr, abi, fn,
 *  args) => Promise<unknown>` — viem's `publicClient.readContract` fits directly. */
export async function readErc20Balance(
  readContract: (args: { address: Address; abi: typeof ERC20_BALANCE_ABI; functionName: 'balanceOf'; args: [Address] }) => Promise<unknown>,
  token: Address,
  owner: Address,
): Promise<bigint> {
  const out = await readContract({ address: token, abi: ERC20_BALANCE_ABI, functionName: 'balanceOf', args: [owner] });
  return out as bigint;
}
