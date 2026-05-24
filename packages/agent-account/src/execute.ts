/**
 * Tiny helper: wrap a `{ to, value, data }` call into the encoded
 * calldata for `AgentAccount.execute(target, value, data)`.
 *
 * This bridges the Phase-4 call builders in agent-naming /
 * agent-relationships / agent-identity (which all return
 * `{ to, value, data }`) to the user's AgentAccount execute path —
 * the canonical way for a Smart Agent to dispatch ANY on-chain
 * write through its custody-gated authority.
 *
 * The returned calldata is what the demo's `useGaslessTx` (and any
 * other UserOp builder) passes as the `callData` field of the
 * outer userOp. AgentAccount's validateUserOp + execute path then
 * applies the user's signature path (passkey / EOA / ERC-1271)
 * before calling `target.call{value: value}(data)`.
 */

import { encodeFunctionData, type Abi, type Address, type Hex } from 'viem';
import { agentAccountAbi } from './abis';

/** Minimal call-shape — matches the ContractCall type from other SDKs. */
export interface ContractCall {
  to: Address;
  value: bigint;
  data: Hex;
}

/**
 * Encode `AgentAccount.execute(target, value, data)` calldata around
 * a single `ContractCall`. Pass the result as the `callData` field
 * of a UserOp targeting the user's Smart Agent.
 */
export function buildExecuteCallData(call: ContractCall): Hex {
  return encodeFunctionData({
    abi: agentAccountAbi,
    functionName: 'execute',
    args: [call.to, call.value, call.data],
  });
}

/**
 * Minimal `executeBatch(Call[])` ABI fragment. Inlined so this helper
 * doesn't depend on a specific generated ABI export. Matches
 * `BaseAccount.Call` exactly: `(address target, uint256 value, bytes data)`.
 */
const EXECUTE_BATCH_ABI = [
  {
    type: 'function',
    name: 'executeBatch',
    stateMutability: 'nonpayable',
    inputs: [
      {
        name: 'calls',
        type: 'tuple[]',
        components: [
          { name: 'target', type: 'address' },
          { name: 'value', type: 'uint256' },
          { name: 'data', type: 'bytes' },
        ],
      },
    ],
    outputs: [],
  },
] as const satisfies Abi;

/**
 * Encode `AgentAccount.executeBatch(Call[])` calldata. All inner calls
 * execute atomically in one transaction — any inner revert reverts the
 * whole batch. Use this when two dependent calls (e.g. `register(name)`
 * then `setPrimaryName(node)`) MUST land together to avoid an
 * inter-userOp race against a bundler that may see a stale view of the
 * first userOp's state.
 */
export function buildExecuteBatchCallData(calls: ContractCall[]): Hex {
  return encodeFunctionData({
    abi: EXECUTE_BATCH_ABI,
    functionName: 'executeBatch',
    args: [
      calls.map((c) => ({ target: c.to, value: c.value, data: c.data })),
    ],
  });
}
