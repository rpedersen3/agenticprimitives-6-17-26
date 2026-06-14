// AwsKmsProvider / AwsKmsSigner — AWS KMS backend (NOT YET IMPLEMENTED).
//
// AUDIT N-2: these must FAIL FAST. Previously the classes constructed cleanly and threw only on the
// first signing/encryption call — a deferred-failure footgun: an operator who selects `aws-kms` for a
// real deployment boots fine and explodes on the first hot-path op. Per the package's "fail-closed at
// boot" invariant (CLAUDE.md security invariants), construction now throws. Only `gcp-kms` is
// production-ready (spec 214 §5 is single-chain GCP-KMS); `aws-kms` is reserved, not wired.

import type { A2AKeyProvider, KmsAccountBackend } from '../types';
import type { Address } from '@agenticprimitives/types';

export const AWS_KMS_NOT_IMPLEMENTED =
  '[key-custody] aws-kms backend is not implemented. Use backend "gcp-kms" for real deploys ' +
  '(the only production-ready KMS, spec 214 §5) or "local-aes" for dev. `aws-kms` is reserved but not wired.';

export class AwsKmsProvider implements A2AKeyProvider {
  readonly keyVersion = 'aws-kms:not-implemented';
  // Fail fast at construction (N-2) rather than on the first generate/decrypt call.
  constructor() { throw new Error(AWS_KMS_NOT_IMPLEMENTED); }
  async generateSessionDataKey(): Promise<never> { throw new Error(AWS_KMS_NOT_IMPLEMENTED); }
  async decryptSessionDataKey(): Promise<never> { throw new Error(AWS_KMS_NOT_IMPLEMENTED); }
}

export class AwsKmsSigner implements KmsAccountBackend {
  readonly provider = 'aws-kms' as const;
  // Fail fast at construction (N-2) rather than on the first sign/getSignerAddress call.
  constructor() { throw new Error(AWS_KMS_NOT_IMPLEMENTED); }
  async signA2AAction(): Promise<never> { throw new Error(AWS_KMS_NOT_IMPLEMENTED); }
  async getSignerAddress(): Promise<Address> { throw new Error(AWS_KMS_NOT_IMPLEMENTED); }
}
