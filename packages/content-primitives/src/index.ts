// @agenticprimitives/content-primitives — the Verifiable Content Substrate SDK.
//
// Name → resolve → verify → retrieve → cite → audit, for content that lives
// off-platform and is controlled by third-party rights holders. Content-
// agnostic (ADR-0033): a verse is content, not an Agent; a canonical locus is a
// deterministic hash of a scheme-INDEPENDENT structured form (registry-free, no
// allocator), never a Smart Agent facet. No vertical/faith vocabulary, no
// rendering text — descriptors carry a retrievalPointer + a SHA-256 commitment.
//
// See: ../../specs/266-verifiable-content-substrate.md
//      ../../docs/architecture/decisions/0033-content-agnostic-verifiable-content-firewall.md

export const PACKAGE_NAME = '@agenticprimitives/content-primitives';
export const PACKAGE_STATUS = 'phase-1' as const;
export const SPEC_REF = 'specs/266-verifiable-content-substrate.md';

export type {
  AccessPolicy,
  ProofPolicy,
  DescriptorStatus,
  RightsStatus,
  TrustProfile,
  CanonicalLocus,
  CanonicalLocusEnvelope,
  CanonicalReference,
  ContentCommitment,
  CorpusManifest,
  WorkMeta,
  IssuerIdentityRef,
  ContentDescriptor,
  BuildDescriptorInput,
  SignatureVerifier,
  Entitlement,
  CitationAssertion,
} from './types.js';

export { computeCanonicalId, canonicalReference, corpusRef, LOCUS_ID_SCHEME } from './reference.js';
// Re-export the ONE canonicalization stack (RFC 8785) — shared with credential
// hashing so descriptor/locus ids and VC hashes never drift.
export { jcsCanonicalize, canonicalHash } from '@agenticprimitives/verifiable-credentials';

export {
  hashPair,
  leafHash,
  buildCorpusTree,
  merkleRoot,
  merkleProof,
  verifyInclusion,
  type CorpusTree,
} from './merkle.js';

export {
  NORMALIZATION_V1,
  canonicalizeRendering,
  contentCommitment,
  verifyCommitment,
  assertCommitment,
  descriptorHash,
  buildContentDescriptor,
  verifyContentDescriptor,
  type VerifyDescriptorOpts,
  type VerificationResult,
} from './descriptor.js';

export {
  resolveCandidates,
  type ResolutionConstraints,
  type Candidate,
  type ResolutionResult,
  type TrustProfileConfig,
} from './resolution.js';

export {
  evaluateEntitlement,
  buildCitationAssertion,
  type EntitlementDecision,
  type CitationInput,
} from './entitlement.js';

export { InvalidReferenceError, CommitmentMismatchError } from './errors.js';

// Reserved for later phases (throw until implemented; spec 266 §6).
export { buildInclusionZkProof, bindPaymentMandate } from './reserved.js';
