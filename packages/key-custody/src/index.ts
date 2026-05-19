// @agenticprimitives/key-custody — public API
//
// See ../../specs/203-key-custody.md for the full contract.

import type { Address, Hex } from '@agenticprimitives/types';

export type { Address, Hex };
export type { A2AKeyProvider, KmsAccountBackend, BuildOpts, KmsBackend } from './types';

export { buildKeyProvider, buildSignerBackend, buildToolExecutorBackend, buildMacProvider } from './factories';
export { getRelayOnlySigner } from './relay-only';
export { createKmsAccount } from './account';
export { canonicalContextBytes } from './aad';

export { LocalAesProvider, LocalSecp256k1Signer } from './providers/local';
export { AwsKmsProvider, AwsKmsSigner } from './providers/aws';
export { GcpKmsProvider, GcpKmsSigner } from './providers/gcp';
