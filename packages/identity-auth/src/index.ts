// @agenticprimitives/identity-auth — public API
//
// See ../../specs/200-identity-auth.md for the full contract.

export { mintSession, verifySession, SESSION_COOKIE, SESSION_TTL_SECONDS } from './sessions';
export { csrfTokenFor, verifyCsrf } from './csrf';
export { deriveSaltFromLabel, deriveSaltFromEmail } from './salt';
export {
  ERC1271_MAGIC,
  ERC6492_MAGIC,
  universalSignatureValidatorAbi,
  verifyUserSignature,
  verifyUserSignatureView,
  isErc6492Wrapped,
} from './verify-signature';
export type {
  VerifyUserSignatureArgs,
  UniversalValidatorClient,
} from './verify-signature';

// WebAuthn ceremony helpers (preferred deep import:
// `@agenticprimitives/identity-auth/passkey` for tree-shaking — re-exported
// here for discoverability).
export {
  P256_N,
  base64urlEncode,
  base64urlDecode,
  parseDerSignature,
  normaliseLowS,
  buildWebAuthnAssertion,
  hashToWebAuthnChallenge,
  parseAttestationObject,
  parseAuthData,
} from './methods/passkey';
export type { WebAuthnAssertion, ParsedAttestation } from './methods/passkey';

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
