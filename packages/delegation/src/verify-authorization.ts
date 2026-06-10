// SDK helper for `DelegationManager.verifyAuthorization(...)` view-only entrypoint
// (spec 242 PD-9). Used by `@agenticprimitives/attestations` to construct + read
// authorization-predicate verifications.

import type { Address } from '@agenticprimitives/types';
import type { PublicClient } from 'viem';

import type { Delegation } from './types';

const VERIFY_AUTHORIZATION_ABI = [
  {
    type: 'function',
    name: 'verifyAuthorization',
    stateMutability: 'view',
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
      { name: 'sender', type: 'address' },
    ],
    outputs: [
      { name: 'ok', type: 'bool' },
      { name: 'reason', type: 'string' },
    ],
  },
] as const;

export interface VerifyAuthorizationResult {
  ok: boolean;
  /** Empty when `ok = true`; otherwise the on-chain rejection reason. */
  reason: string;
}

/**
 * View-only verification of a delegation chain. Returns whether the chain
 * authorizes `sender` to redeem WITHOUT executing it.
 *
 * ⚠️ DANGER — chain-only. This does NOT evaluate caveats, so a `true` result is
 * NOT permission to perform any specific (target, value, calldata). To authorize a
 * concrete call use `verifyAuthorizationForCall` (fail-closed, evaluates every
 * caveat) or live redemption. Treating this boolean as call authorization re-opens
 * the exact over-trust the caveats exist to prevent.
 *
 * Spec 242 §6 uses this to validate bilateral-consent delegations as signed
 * authorization predicates rather than as cross-account execution.
 */
export async function verifyAuthorization(args: {
  publicClient: PublicClient;
  delegationManager: Address;
  delegations: Delegation[];
  sender: Address;
}): Promise<VerifyAuthorizationResult> {
  const onchainDelegations = args.delegations.map((d) => ({
    delegator: d.delegator,
    delegate: d.delegate,
    authority: d.authority,
    caveats: d.caveats.map((c) => ({
      enforcer: c.enforcer,
      terms: c.terms,
      // `args` is OPTIONAL in the off-chain shape; on-chain expects bytes.
      args: (c.args ?? '0x') as `0x${string}`,
    })),
    salt: d.salt,
    signature: d.signature,
  }));

  const [ok, reason] = (await args.publicClient.readContract({
    address: args.delegationManager,
    abi: VERIFY_AUTHORIZATION_ABI,
    functionName: 'verifyAuthorization',
    args: [onchainDelegations, args.sender],
  })) as readonly [boolean, string];

  return { ok, reason };
}
