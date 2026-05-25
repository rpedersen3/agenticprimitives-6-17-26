// OnChainReadPort adapter (viem).
//
// `exists` is contract-agnostic (bytecode-at-address) and provided here.
// `confirmsCredential` maps a CredentialPrincipal to an on-chain membership
// CHECK (isCustodian/isTrustee on the AgentAccount/custody contract) — that
// getter is contract- AND credential-kind-specific (an EOA address vs a passkey
// credentialIdDigest read differently), so it is WIRED BY THE APP rather than
// guessed here. The adapter assembles the port from the two readers.

import type { CanonicalAgentId, CredentialPrincipal } from '@agenticprimitives/types';
import type { OnChainReadPort } from '@agenticprimitives/identity-directory';
import type { PublicClient } from 'viem';
import { addressOf } from './caip10';

export interface OnChainReaders {
  /** Does the agent exist as a deployed account on this chain? */
  exists(id: CanonicalAgentId): Promise<boolean>;
  /**
   * Is `principal` CURRENTLY a control credential of `id`? Wire this to the
   * appropriate on-chain membership getter (e.g. `isCustodian`/`isTrustee`).
   * MUST reflect the current set so a revoked credential returns false
   * (the directory drops it — audit P1-3).
   */
  confirmsCredential(id: CanonicalAgentId, principal: CredentialPrincipal): Promise<boolean>;
}

/** Assemble an OnChainReadPort from the two reader functions. */
export function makeOnChainReadPort(readers: OnChainReaders): OnChainReadPort {
  return {
    exists: (id) => readers.exists(id),
    confirmsCredential: (id, principal) => readers.confirmsCredential(id, principal),
  };
}

/**
 * A contract-agnostic `exists` reader: an agent "exists" when there is bytecode
 * at its address (deployed). Counterfactual (not-yet-deployed) agents read as
 * `false` — wire a factory/initCode check if you need to treat them as existing.
 */
export function viemExists(client: Pick<PublicClient, 'getCode'>): (id: CanonicalAgentId) => Promise<boolean> {
  return async (id) => {
    const code = await client.getCode({ address: addressOf(id) });
    return !!code && code !== '0x';
  };
}
