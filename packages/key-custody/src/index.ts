// @agenticprimitives/key-custody — public API
//
// See ../../specs/203-key-custody.md for the full contract.

import type { Address, Hex } from '@agenticprimitives/types';

export type { Address, Hex };
export type { A2AKeyProvider, KmsAccountBackend, BuildOpts, KmsBackend, Secret } from './types';
export { loadSecret, loadSecretFromEnv, unwrapSecret, isSecret } from './types';

export {
  buildKeyProvider,
  buildSignerBackend,
  // R11.3 / PKG-KEY-CUSTODY-001 follow-up — `buildToolExecutorBackend`
  // is NOT re-exported here. Its v0 implementation is the always-throwing
  // alias that the JSDoc redirects to the explicit
  // `buildToolExecutorBackendNoIsolation` (dev-only opt-in) or
  // `deriveSubjectSigner` (true per-subject isolation, spec 235). Keeping
  // the throwing alias in the public surface is a footgun — a consumer
  // reading the public API thinks per-tool isolation is supported. v1
  // either implements HKDF per-tool isolation or graduates
  // `buildToolExecutorBackendNoIsolation` to the canonical name. Until
  // then, the public surface is the explicit-name one only.
  buildToolExecutorBackendNoIsolation,
  buildMacProvider,
} from './factories';
// `deriveSubjectPrivateKeyHex` is intentionally NOT re-exported here — it returns
// a per-subject raw private key (security-sensitive). It stays exported from
// `./derive-subject` for in-package unit tests but is not part of the public API.
// See `capability.manifest.json:publicExports` (audit row ARCH-006 / PKG-KEY-CUSTODY-002 closure).
export {
  deriveSubjectSigner,
  subjectCanonicalMessage,
  type SubjectId,
  type DeriveSubjectOpts,
} from './derive-subject';
export { getRelayOnlySigner } from './relay-only';
export { createKmsAccount } from './account';
export { createKmsViemAccount } from './kms-viem-account';
export {
  createRelayerAccount,
  type CreateRelayerAccountOpts,
} from './relayer-account';
export {
  createSpendCappedAccount,
  SpendCapExceededError,
  type CreateSpendCappedAccountOpts,
} from './spend-capped-account';
export { canonicalContextBytes } from './aad';

export { LocalAesProvider, LocalSecp256k1Signer } from './providers/local';
// R11.3 — `AwsKmsProvider` / `AwsKmsSigner` are NOT re-exported here.
// Their current implementations throw a `not yet implemented in v0;
// use LocalAesProvider for the demo` message at construction time. A
// public symbol whose existence implies a capability the runtime can't
// provide is an ADR-0013 violation (silent fallback in the type system).
// The `KmsBackend` type retains 'aws-kms' as a future value, but the
// factory throws a clear error when selected. v1 is GCP-only +
// local-aes (dev). When AWS lands, re-add the export alongside the
// LocalAes + Gcp providers.
export { GcpKmsProvider, GcpKmsSigner } from './providers/gcp';
