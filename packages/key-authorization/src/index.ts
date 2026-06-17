// @agenticprimitives/key-authorization — policy-bound, one-time key release
// (spec 277 §14). The DecryptGrant is the enforcement boundary: the KAS
// independently re-verifies it (scope, fields, purpose, classification, expiry,
// one-time JTI, authorization-hash binding) before any field is decrypted.
//
// This release: grant construction + KAS verification + one-time replay store +
// a local-dev KAS. Authority stays delegation/entitlement/policy (bound by hash);
// the DEK unwrap itself is done by the caller via key-custody once authorize()
// returns allow. Remote-KMS KAS, D1/Durable-Object replay ledgers, and signed
// grant proofs (Eip712Signature2026/JWS) are additive.

export const PACKAGE_NAME = '@agenticprimitives/key-authorization';
export const PACKAGE_STATUS = 'w1-grant-verify' as const;
export const SPEC_REF = 'specs/277-mcp-delegated-vault-authorization.md';

export {
  type Sha256,
  type DecryptGrantReason,
  type DecryptGrantV1,
  type DecryptGrantExpectation,
  type KeyReleaseDecision,
  type ReplayStore,
} from './types.js';

export { canonicalize, sha256Hex, computeGrantHash, createDecryptGrant } from './grant.js';

export {
  type VerifyDecryptGrantOpts,
  type KeyAuthorizationService,
  verifyDecryptGrant,
  createInMemoryReplayStore,
  createLocalDevKeyAuthorizationService,
} from './verify.js';
