// AwsKmsProvider / AwsKmsSigner — production AWS KMS backends.
// Stubs in v0 demo; full implementation lands in v0.1.

import type { A2AKeyProvider, KmsAccountBackend } from '../types';
import type { Address } from '@agenticprimitives/types';

const NOT_IMPLEMENTED = 'AwsKmsProvider / AwsKmsSigner not yet implemented in v0; use LocalAesProvider for the demo.';

export class AwsKmsProvider implements A2AKeyProvider {
  readonly keyVersion = 'aws-kms:not-implemented';
  async generateSessionDataKey(): Promise<never> { throw new Error(NOT_IMPLEMENTED); }
  async decryptSessionDataKey(): Promise<never> { throw new Error(NOT_IMPLEMENTED); }
}

export class AwsKmsSigner implements KmsAccountBackend {
  readonly provider = 'aws-kms' as const;
  async signA2AAction(): Promise<never> { throw new Error(NOT_IMPLEMENTED); }
  async getSignerAddress(): Promise<Address> { throw new Error(NOT_IMPLEMENTED); }
}
