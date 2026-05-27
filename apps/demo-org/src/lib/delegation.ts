// demo-org delegation helpers (ADR-0019). The relying site holds a caveated delegation
// (person SA → this site's delegate SA) issued by the central auth. It proves the delegation
// at sign-in (server verifies) and REDEEMS it to act on the person's behalf — the delegate SA
// calls `DelegationManager.redeemDelegation`, so `msg.sender == delegate` and the inner call
// executes as the person (the delegator).
import type { Delegation, Caveat } from '@agenticprimitives/delegation';
import type { Address, Hex } from '@agenticprimitives/types';
import { encodeFunctionData } from 'viem';
import { CONTRACTS } from './chain';

/** Wire form of a Delegation (bigint salt → string) for transport / storage. */
export interface DelegationWire {
  delegator: Address;
  delegate: Address;
  authority: Hex;
  caveats: Caveat[];
  salt: string;
  signature: Hex;
}
export const fromWire = (w: DelegationWire): Delegation => ({ ...w, salt: BigInt(w.salt) });

const DELEGATION_MANAGER_ABI = [
  {
    type: 'function',
    name: 'redeemDelegation',
    stateMutability: 'nonpayable',
    inputs: [
      {
        name: 'delegations',
        type: 'tuple[]',
        components: [
          { name: 'delegator', type: 'address' },
          { name: 'delegate', type: 'address' },
          { name: 'authority', type: 'bytes32' },
          {
            name: 'caveats',
            type: 'tuple[]',
            components: [
              { name: 'enforcer', type: 'address' },
              { name: 'terms', type: 'bytes' },
              { name: 'args', type: 'bytes' },
            ],
          },
          { name: 'salt', type: 'uint256' },
          { name: 'signature', type: 'bytes' },
        ],
      },
      { name: 'target', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'data', type: 'bytes' },
    ],
    outputs: [],
  },
] as const;

/** Encode `DelegationManager.redeemDelegation([delegation], target, value, data)`. The
 *  delegate SA `execute`s this against the DelegationManager; the inner (target,data) call
 *  then runs as the person (delegator), scoped by the delegation's caveats. */
export function buildRedeemCallData(delegation: Delegation, target: Address, value: bigint, data: Hex): Hex {
  return encodeFunctionData({
    abi: DELEGATION_MANAGER_ABI,
    functionName: 'redeemDelegation',
    args: [
      [
        {
          delegator: delegation.delegator,
          delegate: delegation.delegate,
          authority: delegation.authority,
          caveats: delegation.caveats.map((c) => ({ enforcer: c.enforcer, terms: c.terms, args: c.args ?? '0x' })),
          salt: delegation.salt,
          signature: delegation.signature,
        },
      ],
      target,
      value,
      data,
    ],
  });
}

export const DELEGATION_MANAGER: Address = CONTRACTS.delegationManager;
