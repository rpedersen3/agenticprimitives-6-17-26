import type { Address } from '@agenticprimitives/types';
import type { AuditSink } from '@agenticprimitives/audit';

export type KmsBackend = 'local-aes' | 'aws-kms' | 'gcp-kms';

export interface BuildOpts {
  backend: KmsBackend;
  config?: Record<string, string>;
  /**
   * Optional audit sink threaded into signers so every signing op emits
   * `key-custody.sign`. Consumers share one sink across all primitives
   * so rows land in one trail. Fail-soft if the sink throws.
   */
  auditSink?: AuditSink;
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
  signA2AAction: NonNullable<A2AKeyProvider['signA2AAction']>;
  getSignerAddress(): Promise<Address>;
}
