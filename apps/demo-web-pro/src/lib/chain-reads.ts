/**
 * Read-only chain queries (Base Sepolia by default).
 *
 * Use these for: predicting deployment addresses via getAddressForMode,
 * verifying that an account has code after a deploy, reading custody
 * policy state for the dashboard, etc.
 *
 * Public-RPC only. No wallet, no signing.
 */

import { createPublicClient, http, type Address, type Hex } from 'viem';
import { baseSepolia } from 'viem/chains';
import { agentAccountFactoryAbi } from '@agenticprimitives/agent-account';
import { custodyPolicyAbi } from '@agenticprimitives/custody';

const publicClient = createPublicClient({
  chain: baseSepolia,
  transport: http(),
});

export interface AgentAccountInitParams {
  mode: number;
  custodians: readonly Address[];
  trustees: readonly Address[];
  initialPasskeyCredentialIdDigest: Hex;
  initialPasskeyX: bigint;
  initialPasskeyY: bigint;
}

/**
 * Predict the deployed AgentAccount address for given init params + salt.
 * Factory uses CREATE2 so this is deterministic before the tx broadcasts.
 */
export async function predictAccountAddress(args: {
  factoryAddress: Address;
  initParams: AgentAccountInitParams;
  salt: bigint;
}): Promise<Address> {
  return (await publicClient.readContract({
    address: args.factoryAddress,
    abi: agentAccountFactoryAbi,
    functionName: 'getAddressForMode',
    args: [args.initParams, args.salt],
  })) as Address;
}

/** True if the address has code (i.e. has been deployed). */
export async function hasCode(address: Address): Promise<boolean> {
  const bytecode = await publicClient.getBytecode({ address });
  return !!bytecode && bytecode !== '0x';
}

/** Read scheduledChangeCount(account) — the highest issued change id. */
export async function readScheduledChangeCount(args: {
  custodyPolicy: Address;
  account: Address;
}): Promise<bigint> {
  return (await publicClient.readContract({
    address: args.custodyPolicy,
    abi: custodyPolicyAbi,
    functionName: 'scheduledChangeCount',
    args: [args.account],
  })) as bigint;
}

/** Read a single scheduled change. */
export async function readScheduledChange(args: {
  custodyPolicy: Address;
  account: Address;
  changeId: bigint;
}): Promise<{
  action: number;
  args: Hex;
  eta: bigint;
  proposer: Address;
  executed: boolean;
  cancelled: boolean;
}> {
  const result = (await publicClient.readContract({
    address: args.custodyPolicy,
    abi: custodyPolicyAbi,
    functionName: 'getScheduledChange',
    args: [args.account, args.changeId],
  })) as readonly [number, Hex, bigint, Address, boolean, boolean];
  return {
    action: result[0],
    args: result[1],
    eta: result[2],
    proposer: result[3],
    executed: result[4],
    cancelled: result[5],
  };
}

/** Read isCustodian(signer) on an AgentAccount. */
export async function readIsCustodian(args: {
  account: Address;
  signer: Address;
}): Promise<boolean> {
  const isCustodianAbi = [
    {
      type: 'function',
      name: 'isCustodian',
      stateMutability: 'view',
      inputs: [{ name: 'account', type: 'address' }],
      outputs: [{ type: 'bool' }],
    },
  ] as const;
  return (await publicClient.readContract({
    address: args.account,
    abi: isCustodianAbi,
    functionName: 'isCustodian',
    args: [args.signer],
  })) as boolean;
}
