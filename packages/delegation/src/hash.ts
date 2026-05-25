// EIP-712 hashing for Delegation + Caveat[].
//
// Domain MUST match what AgentDelegationManager computes on-chain:
//   EIP712Domain(string name, string version, uint256 chainId, address verifyingContract)
//   name = "AgentDelegationManager"
//   version = "1"

import { hashTypedData, keccak256, encodeAbiParameters, type Hex, type Address } from 'viem';
import type { Caveat, Delegation } from './types';

const DOMAIN_NAME = 'AgentDelegationManager';
const DOMAIN_VERSION = '1';

export const DELEGATION_EIP712_TYPES = {
  Delegation: [
    { name: 'delegator', type: 'address' },
    { name: 'delegate', type: 'address' },
    { name: 'authority', type: 'bytes32' },
    { name: 'caveats', type: 'Caveat[]' },
    { name: 'salt', type: 'uint256' },
  ],
  // `args` (redeemer-supplied runtime data) is DELIBERATELY excluded from
  // the signed hash — it must match AgentDelegationManager's
  // CAVEAT_TYPEHASH = keccak256("Caveat(address enforcer,bytes terms)")
  // (DelegationManager.sol:55). Including args here made every delegation
  // carrying a caveat fail on-chain ERC-1271 redeem AND let a redeemer's
  // chosen args ride inside the delegator's signature. (audit F-1)
  Caveat: [
    { name: 'enforcer', type: 'address' },
    { name: 'terms', type: 'bytes' },
  ],
} as const;

export function delegationDomain(chainId: number, delegationManager: Address) {
  return {
    name: DOMAIN_NAME,
    version: DOMAIN_VERSION,
    chainId,
    verifyingContract: delegationManager,
  };
}

function caveatMessage(c: Caveat) {
  // Only the signed fields (enforcer, terms). `args` is runtime-only and
  // never part of the delegation hash — see DELEGATION_EIP712_TYPES.Caveat.
  return {
    enforcer: c.enforcer,
    terms: c.terms,
  };
}

/**
 * EIP-712 hash of a Delegation. This is the value the smart-account owner
 * signs (via signTypedData / personal_sign of the digest) and the value
 * AgentDelegationManager validates via ERC-1271.
 */
export function hashDelegation(d: Delegation, chainId: number, delegationManager: Address): Hex {
  return hashTypedData({
    domain: delegationDomain(chainId, delegationManager),
    types: DELEGATION_EIP712_TYPES,
    primaryType: 'Delegation',
    message: {
      delegator: d.delegator,
      delegate: d.delegate,
      authority: d.authority,
      caveats: d.caveats.map(caveatMessage),
      salt: d.salt,
    },
  });
}

/**
 * keccak256 of the ABI-encoded caveat array. Mirrors what
 * AgentDelegationManager computes for caveat enforcement bookkeeping.
 */
export function hashCaveats(caveats: Caveat[]): Hex {
  const encoded = encodeAbiParameters(
    [
      {
        type: 'tuple[]',
        components: [
          { name: 'enforcer', type: 'address' },
          { name: 'terms', type: 'bytes' },
        ],
      },
    ],
    [caveats.map(caveatMessage)],
  );
  return keccak256(encoded);
}
