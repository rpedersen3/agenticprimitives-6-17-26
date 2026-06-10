// The DEL-001 session-delegation leaf builder (spec 270 v4 W2). Every connection flow — the home OIDC
// ceremony and every relying-app connect surface alike — generates a session keypair at connect and calls
// this to mint the leaf that binds that key to the principal's SA. It returns the UNSIGNED leaf + its
// canonical digest; the caller signs the digest with the member's LIVE credential (whatever it is), then
// attaches the signature. The verifier validates it through the UniversalSignatureValidator (W1), so the
// same leaf works under every credential strategy — the builder never knows or cares which.
import type { Address, Hex } from '@agenticprimitives/types';
import type { Delegation } from './types';
import { ROOT_AUTHORITY } from './types';
import { buildCaveat, encodeTimestampTerms, encodeValueTerms } from './caveats';
import { hashDelegation } from './hash';

export interface SessionDelegationParams {
  /** The principal's Smart Account — the leaf delegator (the canonical identity that authorizes the key). */
  delegator: Address;
  /** The freshly-generated session key the token will be signed by. */
  sessionKeyAddress: Address;
  /** Unix seconds the session-key authorization is valid until (bound by a timestamp caveat). */
  validUntil: number;
  /** Deployed enforcer addresses (timestamp + value). */
  enforcers: { timestamp: Address; value: Address };
  chainId: number;
  delegationManager: Address;
  /** Random salt; supply a fixed value for deterministic tests. */
  salt?: bigint;
}

function randomSalt(): bigint {
  const b = new Uint8Array(16);
  globalThis.crypto.getRandomValues(b);
  let s = 0n;
  for (const x of b) s = (s << 8n) | BigInt(x);
  return s;
}

/**
 * Build the session-delegation leaf `delegator (principal SA) → sessionKey`, with a timestamp (TTL) +
 * value-0 caveat, UNSIGNED. Returns `{ leaf, digest }`; the caller signs `digest` with the member's live
 * credential and sets `leaf.signature`. v4 binds to the DELEGATOR (the principal's canonical identity), so
 * the same credential that signs the `member→relying` delegation at connect also authorizes the session key.
 */
export function buildSessionDelegation(p: SessionDelegationParams): { leaf: Delegation; digest: Hex } {
  const leaf: Delegation = {
    delegator: p.delegator,
    delegate: p.sessionKeyAddress,
    authority: ROOT_AUTHORITY,
    caveats: [
      buildCaveat(p.enforcers.timestamp, encodeTimestampTerms(0, p.validUntil)),
      buildCaveat(p.enforcers.value, encodeValueTerms(0n)),
    ],
    salt: p.salt ?? randomSalt(),
    signature: '0x',
  };
  return { leaf, digest: hashDelegation(leaf, p.chainId, p.delegationManager) };
}
