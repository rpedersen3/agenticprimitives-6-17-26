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
  buildToolExecutorBackend,
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
export { canonicalContextBytes } from './aad';

export { LocalAesProvider, LocalSecp256k1Signer } from './providers/local';
export { AwsKmsProvider, AwsKmsSigner } from './providers/aws';
export { GcpKmsProvider, GcpKmsSigner } from './providers/gcp';
