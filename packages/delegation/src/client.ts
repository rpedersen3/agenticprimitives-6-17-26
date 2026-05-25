// DelegationClient — browser-side issuance.
//
// Given a Signer (whose backing key is the smart account's owner EOA),
// the user signs an EIP-712 Delegation message via signTypedData. The
// resulting signature, paired with the Delegation struct, becomes a
// fully-formed Delegation that the DelegationManager + ERC-1271 path on
// the smart account can validate.

import type { Address, Hex } from '@agenticprimitives/types';
import type { Caveat, Delegation, DelegationClientOpts } from './types';
import { ROOT_AUTHORITY } from './types';
import { DELEGATION_EIP712_TYPES, delegationDomain } from './hash';

function randomSalt(): bigint {
  const buf = new Uint8Array(32);
  // 32-byte random; high bit cleared to keep BigInt sign-safe (uint256 still has full range).
  globalThis.crypto.getRandomValues(buf);
  let n = 0n;
  for (const b of buf) n = (n << 8n) | BigInt(b);
  return n;
}

export class DelegationClient {
  private readonly opts: DelegationClientOpts;
  constructor(opts: DelegationClientOpts) {
    this.opts = opts;
  }

  /**
   * Build a Delegation, sign it via the user's signer, return the fully
   * populated struct. `delegator` = the smart account address; the signer
   * is the smart account's owner EOA.
   */
  async issueDelegation(params: {
    delegate: Address;
    caveats: Caveat[];
    salt?: bigint;
    authority?: Hex;
  }): Promise<Delegation> {
    const salt = params.salt ?? randomSalt();
    const authority = params.authority ?? ROOT_AUTHORITY;
    const delegation: Omit<Delegation, 'signature'> = {
      delegator: this.opts.smartAccount,
      delegate: params.delegate,
      authority,
      caveats: params.caveats,
      salt,
    };

    const signature = await this.opts.signer.signTypedData({
      domain: delegationDomain(this.opts.chainId, this.opts.delegationManager),
      types: DELEGATION_EIP712_TYPES,
      primaryType: 'Delegation',
      message: {
        delegator: delegation.delegator,
        delegate: delegation.delegate,
        authority: delegation.authority,
        caveats: delegation.caveats.map((c) => ({
          enforcer: c.enforcer,
          terms: c.terms,
        })),
        salt: delegation.salt,
      },
    });

    return { ...delegation, signature };
  }
}
