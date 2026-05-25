// getRelayOnlySigner — wraps a KmsAccountBackend so any sign call throws.
// Used in Phase B to guarantee the master signer can only broadcast, never
// sign on the user's authority.

import type { BuildOpts, KmsAccountBackend } from './types';
import { buildSignerBackend } from './factories';
import type { Address } from '@agenticprimitives/types';

export function getRelayOnlySigner(opts: BuildOpts): KmsAccountBackend {
  const inner = buildSignerBackend(opts);
  return {
    // Report the wrapped backend's real kind (audit F-6) — the relay-only
    // shim changes capability, not provenance.
    provider: inner.provider,
    async getSignerAddress(): Promise<Address> {
      return inner.getSignerAddress();
    },
    async signA2AAction(): Promise<never> {
      throw new Error(
        'getRelayOnlySigner: signA2AAction called on relay-only signer. The master key is restricted to broadcast operations only.',
      );
    },
  };
}
