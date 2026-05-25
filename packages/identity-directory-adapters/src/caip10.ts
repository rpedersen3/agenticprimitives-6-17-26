// EVM-only CAIP-10 glue for the directory adapters.
//
// The canonical, multi-namespace CAIP-10 builder/parser lives in
// `@agenticprimitives/agent-profile` (`/caip10`, `buildCaip10Address`). These are
// the eip155-only helpers this EVM adapter needs — spec 100 §4 deliberately keeps
// agent-profile OUT of the adapter's dependency set, and this adapter only ever
// produces/parses `eip155:<chainId>:<address>` ids.

import type { Address, CanonicalAgentId } from '@agenticprimitives/types';

export const EIP155_NAMESPACE = 'eip155' as const;

/** Build an eip155 `CanonicalAgentId` from a chainId + EVM address (lowercased). */
export function toCanonicalAgentId(chainId: number, address: Address): CanonicalAgentId {
  return `${EIP155_NAMESPACE}:${chainId}:${address.toLowerCase()}` as CanonicalAgentId;
}

/** Extract the EVM address from an eip155 `CanonicalAgentId`. Throws on a non-eip155 id. */
export function addressOf(id: CanonicalAgentId): Address {
  const parts = id.split(':');
  if (parts.length !== 3 || parts[0] !== EIP155_NAMESPACE) {
    throw new Error(`identity-directory-adapters: expected an eip155 CanonicalAgentId, got "${id}"`);
  }
  return parts[2] as Address;
}
