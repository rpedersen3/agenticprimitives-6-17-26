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
