/**
 * @agenticprimitives/verifiable-credentials — W3C VC 2.0 envelope, EIP-712
 * + ERC-1271 proof, DOLCE+DnS Situation bases, JCS canonical hash, and the
 * schema-registration helper.
 *
 * Substrate for spine layers 12–15 credential classes; consumers (attestations,
 * agreements, payments, fulfillment) compose specific credential types on top.
 *
 * Authoritative spec: specs/242-trust-credentials-and-public-assertions.md
 */

export const PACKAGE_NAME = '@agenticprimitives/verifiable-credentials';
export const PACKAGE_STATUS = 'w1-foundational' as const;
export const SPEC_REF = 'specs/242-trust-credentials-and-public-assertions.md';

// Types + constants
export {
  VC_CONTEXT_V2,
  EIP712_SIG_2026_CONTEXT,
  VC_DOMAIN_NAME,
  VC_DOMAIN_VERSION,
  VC_EIP712_TYPES,
} from './types.js';
export type {
  Hex32,
  ISODate,
  ProofType,
  Eip712Signature2026Proof,
  DelegatingSignerProof,
  Proof,
  CredentialStatus2021,
  VisibilityTier,
  DisclosurePolicy,
  VerifiableCredential,
  UnsignedCredential,
} from './types.js';

// Canonical hash + JCS
export { jcsCanonicalize, canonicalHash, JcsError } from './canonical.js';

// Situation pattern
export {
  assertSituationRolesPresent,
  buildSituation,
} from './situation.js';
export type { Situation, DescriptionRef, RoleName } from './situation.js';

// Proof builder
export {
  credentialHash,
  eip712Digest,
  isoToSeconds,
  signCredential,
  viemSignerFromWallet,
} from './proof.js';
export type { CredentialSigner } from './proof.js';

// Verifier
export { verifyCredential, verifyCredentialStructural, parseEip155Caip10 } from './verifier.js';
export type {
  VerificationResult,
  VerifyCredentialResult,
  Erc1271Verifier,
  Caip10Eip155,
} from './verifier.js';

// Schema registration
export { SHAPE_DID_PREFIX, buildShapeUri, parseShapeUri, shapeHash } from './schema.js';
