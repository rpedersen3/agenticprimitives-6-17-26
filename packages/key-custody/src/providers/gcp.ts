// GcpKmsProvider / GcpKmsSigner — production GCP KMS backends.
// Stubs in v0 demo; full implementation lands in v0.1.

import type { A2AKeyProvider, KmsAccountBackend } from '../types';
import type { Address } from '@agenticprimitives/types';

const NOT_IMPLEMENTED = 'GcpKmsProvider / GcpKmsSigner not yet implemented in v0; use LocalAesProvider for the demo.';

export class GcpKmsProvider implements A2AKeyProvider {
  readonly keyVersion = 'gcp-kms:not-implemented';
  async generateSessionDataKey(): Promise<never> { throw new Error(NOT_IMPLEMENTED); }
  async decryptSessionDataKey(): Promise<never> { throw new Error(NOT_IMPLEMENTED); }
}

export class GcpKmsSigner implements KmsAccountBackend {
  async signA2AAction(): Promise<never> { throw new Error(NOT_IMPLEMENTED); }
  async getSignerAddress(): Promise<Address> { throw new Error(NOT_IMPLEMENTED); }
}
