// On-chain revocation helpers (spec 272 PAY-DEL-3). `isRevoked` is the read the x402 rail executor
// MUST run before settling (off-chain check); the DelegationManager ALSO enforces revocation in
// `redeemDelegation` (on-chain), so revocation is checked twice and is never off-chain-only.

import { createPublicClient, http, encodeFunctionData, type Hex, type Address } from 'viem';
import type { Delegation } from './types';

const IS_REVOKED_ABI = [
  {
    type: 'function',
    name: 'isRevoked',
    stateMutability: 'view',
    inputs: [{ name: 'delegationHash', type: 'bytes32' }],
    outputs: [{ type: 'bool' }],
  },
] as const;

// Matches IDelegationManager.Delegation / Caveat (enforcer, terms, args).
const REVOKE_BY_OWNER_ABI = [
  {
    type: 'function',
    name: 'revokeDelegationByOwner',
    stateMutability: 'nonpayable',
    inputs: [
      {
        name: 'delegation',
        type: 'tuple',
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
    ],
    outputs: [],
  },
] as const;

/** Is this delegation hash revoked on-chain? The canonical, single mechanism (ADR-0013): reads the
 *  DelegationManager's `_revoked` map. Returns `false` if absent — never escalates to a second path. */
export async function isRevoked(
  hash: Hex,
  opts: { delegationManager: Address; rpcUrl: string },
): Promise<boolean> {
  const client = createPublicClient({ transport: http(opts.rpcUrl) });
  return (await client.readContract({
    address: opts.delegationManager,
    abi: IS_REVOKED_ABI,
    functionName: 'isRevoked',
    args: [hash],
  })) as boolean;
}

/**
 * Build the call that revokes a delegation on-chain: `DelegationManager.revokeDelegationByOwner(d)`.
 * The caller (the delegator OR the delegate) submits this through their Smart Account's `execute`
 * (this package owns delegation semantics, not tx/UserOp submission — agent-account/app layer does).
 * Once mined, `isRevoked(hash)` is true and `redeemDelegation` reverts. The on-chain function
 * re-verifies the delegation's signature, so a forged hash cannot be marked revoked.
 */
export function buildRevokeDelegationCall(
  delegation: Delegation,
  delegationManager: Address,
): { to: Address; value: bigint; data: Hex } {
  const data = encodeFunctionData({
    abi: REVOKE_BY_OWNER_ABI,
    functionName: 'revokeDelegationByOwner',
    args: [
      {
        delegator: delegation.delegator,
        delegate: delegation.delegate,
        authority: delegation.authority,
        caveats: delegation.caveats.map((c) => ({ enforcer: c.enforcer, terms: c.terms, args: c.args ?? '0x' })),
        salt: delegation.salt,
        signature: delegation.signature,
      },
    ],
  });
  return { to: delegationManager, value: 0n, data };
}
