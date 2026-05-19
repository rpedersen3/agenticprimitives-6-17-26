// @agenticprimitives/agent-account — public API
//
// See ../../specs/201-agent-account.md for the full contract.

import type { Address, Hex } from '@agenticprimitives/types';
import type { Signer } from '@agenticprimitives/identity-auth';

export type { Address, Hex };

export interface UserOperation {
  sender: Address;
  nonce: bigint;
  initCode: Hex;
  callData: Hex;
  callGasLimit: bigint;
  verificationGasLimit: bigint;
  preVerificationGas: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
  paymasterAndData: Hex;
  signature: Hex;
}

export interface AgentAccountClientOpts {
  rpcUrl: string;
  chainId: number;
  entryPoint: Address;
  factory: Address;
}

export interface CreateAgentAccountParams {
  owner: Address;
  salt: bigint;
}

export declare class AgentAccountClient {
  constructor(opts: AgentAccountClientOpts);

  getAddress(owner: Address, salt: bigint): Promise<Address>;
  createAccount(params: CreateAgentAccountParams, signer: Signer): Promise<Address>;
  isOwner(account: Address, address: Address): Promise<boolean>;
  isDeployed(account: Address): Promise<boolean>;

  signWithErc1271(account: Address, hash: Hex, signer: Signer): Promise<Hex>;
  isValidSignature(account: Address, hash: Hex, signature: Hex): Promise<boolean>;

  buildUserOp(params: {
    account: Address;
    calls: Array<{ to: Address; data: Hex; value: bigint }>;
    paymaster?: Address;
  }): Promise<UserOperation>;
}
