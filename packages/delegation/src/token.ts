// DelegationToken envelope: base64url(canonicalJSON(claims)) + '.' + base64url(sessionKeySig).
// Verification recovers the session key from the signature and asserts it
// equals claims.sessionKeyAddress, then walks the delegation/caveat/JTI checks.
//
// v0 demo step 2 doesn't actually mint or verify tokens (the demo's step 3 —
// MCP tool call — needs them). The functions ship here as STUBS until that
// commit lands, so the public-export surface declared in
// capability.manifest.json:publicExports stays accurate.

import type { Address, Hex } from '@agenticprimitives/types';
import type {
  Delegation,
  DelegationTokenClaims,
  VerifyError,
  VerifyOpts,
  DataScopeGrant,
} from './types';

export async function mintDelegationToken(
  _claims: Omit<DelegationTokenClaims, 'iat' | 'exp'>,
  _signMessage: (msg: string) => Promise<Hex>,
): Promise<{ token: string; jti: string }> {
  throw new Error(
    'mintDelegationToken: not implemented in v0 demo step 2 (lands with demo step 3 / mcp-runtime commit).',
  );
}

export async function verifyDelegationToken(
  _token: string,
  _opts: VerifyOpts,
): Promise<{ principal: Address; grants?: DataScopeGrant[] } | VerifyError> {
  throw new Error(
    'verifyDelegationToken: not implemented in v0 demo step 2 (lands with demo step 3 / mcp-runtime commit).',
  );
}

export async function verifyCrossDelegation(
  _delegation: Delegation,
  _callerPrincipal: Address,
  _targetServer: string,
  _opts: VerifyOpts,
): Promise<{ dataPrincipal: Address; grants: DataScopeGrant[] } | VerifyError> {
  throw new Error(
    'verifyCrossDelegation: not implemented in v0 demo step 2 (lands with demo step 3 / mcp-runtime commit).',
  );
}
