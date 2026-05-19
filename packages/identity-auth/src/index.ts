// @agenticprimitives/identity-auth — public API
//
// See ../../specs/200-identity-auth.md for the full contract.

export { mintSession, verifySession, SESSION_COOKIE, SESSION_TTL_SECONDS } from './sessions';
export { csrfTokenFor, verifyCsrf } from './csrf';
export { deriveSaltFromLabel, deriveSaltFromEmail } from './salt';

export type {
  Address,
  Hex,
  AuthMethod,
  JwtClaims,
  AuthenticatedUser,
  TypedDataDomain,
  TypedDataTypes,
  Signer,
  PasskeyAssertion,
  PasskeySigner,
  EOASigner,
  KMSSigner,
} from './types';
