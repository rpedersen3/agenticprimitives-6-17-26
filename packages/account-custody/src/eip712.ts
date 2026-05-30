// EIP-712 typed-data shapes for the CustodyPolicy schedule/apply/cancel
// surface. Mirrors packages/contracts/src/custody/CustodyPolicy.sol § "EIP-712"
// (spec 207 § 15, renamed per spec 213 § 2.2).
//
// Domain `name` is "agenticprimitives.CustodyPolicy", version "1". Caller
// supplies chainId + the deployed CustodyPolicy address as `verifyingContract`.

import type { Address, Hex } from 'viem';

export const CUSTODY_DOMAIN_NAME = 'agenticprimitives.CustodyPolicy';
export const CUSTODY_DOMAIN_VERSION = '1';

export function custodyDomain(args: { chainId: number; verifyingContract: Address }) {
  return {
    name: CUSTODY_DOMAIN_NAME,
    version: CUSTODY_DOMAIN_VERSION,
    chainId: args.chainId,
    verifyingContract: args.verifyingContract,
  } as const;
}

export const ScheduleCustodyChangeRequest = {
  ScheduleCustodyChangeRequest: [
    { name: 'account', type: 'address' },
    { name: 'action', type: 'uint8' },
    { name: 'argsHash', type: 'bytes32' },
    { name: 'changeId', type: 'uint256' },
  ],
} as const;

export const ApplyCustodyChangeRequest = {
  ApplyCustodyChangeRequest: [
    { name: 'account', type: 'address' },
    { name: 'action', type: 'uint8' },
    { name: 'argsHash', type: 'bytes32' },
    { name: 'changeId', type: 'uint256' },
    { name: 'eta', type: 'uint64' },
  ],
} as const;

export const CancelScheduledChangeRequest = {
  CancelScheduledChangeRequest: [
    { name: 'account', type: 'address' },
    { name: 'action', type: 'uint8' },
    { name: 'argsHash', type: 'bytes32' },
    { name: 'changeId', type: 'uint256' },
    { name: 'eta', type: 'uint64' },
  ],
} as const;

export interface ScheduleCustodyChangeMessage {
  account: Address;
  action: number;
  argsHash: Hex;
  changeId: bigint;
}

export interface ApplyCustodyChangeMessage extends ScheduleCustodyChangeMessage {
  eta: bigint;
}

export type CancelScheduledChangeMessage = ApplyCustodyChangeMessage;
