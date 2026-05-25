import type { Address } from '@agenticprimitives/types';
import type { AuditSink } from '@agenticprimitives/audit';

export type KmsBackend = 'local-aes' | 'aws-kms' | 'gcp-kms';

export interface BuildOpts {
  /**
   * Backend selection. Recommended explicit value. When omitted, the
   * factory falls back to `A2A_KMS_BACKEND` env, then to `local-aes` in
   * development. In production with neither set, the factory THROWS at
   * construction time (audit H1: no silent local-aes default).
   */
  backend?: KmsBackend;
  config?: Record<string, string>;
  /**
   * Optional audit sink threaded into signers so every signing op emits
   * `key-custody.sign`. Consumers share one sink across all primitives
   * so rows land in one trail. Fail-soft if the sink throws.
   */
  auditSink?: AuditSink;
  /**
   * Production-readiness gate (audit H1). Inverted default: factories
   * treat the runtime as `'production'` unless either:
   *   - `developmentMode: true` is set explicitly, or
   *   - `process.env.NODE_ENV !== 'production'`.
   * In production with no explicit backend AND no `A2A_KMS_BACKEND`
   * env, the factory throws. Pass `environment: 'production'` to force
   * production semantics in tests; pass `'development'` (or
   * `developmentMode: true`) to opt into the dev fallback.
   */
  environment?: 'production' | 'development';
  /** Shorthand for `environment: 'development'`. */
  developmentMode?: boolean;
}

export interface A2AKeyProvider {
  readonly keyVersion: string;
  generateSessionDataKey(input: {
    aadContext: Record<string, string>;
  }): Promise<{
    plaintextDataKey: Uint8Array;
    encryptedDataKey: Uint8Array;
    keyId: string;
    keyVersion: string;
  }>;
  decryptSessionDataKey(input: {
    encryptedDataKey: Uint8Array;
    aadContext: Record<string, string>;
    keyId: string;
    keyVersion: string;
  }): Promise<Uint8Array>;
  signA2AAction?(input: {
    digest: Uint8Array;
    auditContext?: { toolId?: string; sessionId?: string; actionId?: string };
  }): Promise<{ signature: Uint8Array; keyId: string; signerAddress: Address }>;
  generateMac?(input: {
    canonicalMessage: Uint8Array;
    service: string;
    audience: string;
  }): Promise<{ mac: Uint8Array; keyId: string }>;
}

export interface KmsAccountBackend {
  /**
   * The concrete backend kind. `createKmsAccount` reads this so the
   * emitted `provider` / `keyId` reflect the REAL backend (audit
   * provenance), instead of a defaulted `'local-aes'` label that could
   * mislabel a production GCP signer (audit F-6).
   */
  readonly provider: 'local-aes' | 'aws-kms' | 'gcp-kms';
  signA2AAction: NonNullable<A2AKeyProvider['signA2AAction']>;
  getSignerAddress(): Promise<Address>;
}
