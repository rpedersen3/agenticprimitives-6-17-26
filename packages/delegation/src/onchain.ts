// On-chain revocation helpers. v0 demo doesn't exercise revocation (step 2
// just packages a session). Stubs preserve the public-export surface.

import type { Hex, Address } from '@agenticprimitives/types';
import type { TxContext } from './types';

export async function isRevoked(
  _hash: Hex,
  _opts: { delegationManager: Address; rpcUrl: string },
): Promise<boolean> {
  throw new Error(
    'isRevoked: not implemented in v0 demo step 2 (lands with demo step 3 / mcp-runtime commit).',
  );
}

export async function revokeDelegation(_hash: Hex, _ctx: TxContext): Promise<Hex> {
  throw new Error(
    'revokeDelegation: not implemented in v0 demo step 2 (lands with on-chain redeem path).',
  );
}
