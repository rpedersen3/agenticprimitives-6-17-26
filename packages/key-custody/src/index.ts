// @agenticprimitives/key-custody — public API
//
// See ../../specs/203-key-custody.md for the full contract.

import type { Address, Hex } from '@agenticprimitives/types';
import type { KMSSigner } from '@agenticprimitives/identity-auth';

export type { Address, Hex };

export type KmsBackend = 'local-aes' | 'aws-kms' | 'gcp-kms';

export interface BuildOpts {
  backend: KmsBackend;
  config?: Record<string, string>;
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

// Provider factories
export declare function buildKeyProvider(opts: BuildOpts): A2AKeyProvider;
export declare function buildSignerBackend(opts: BuildOpts): KmsAccountBackend;
export declare function buildToolExecutorBackend(toolId: string, opts: BuildOpts): KmsAccountBackend;
export declare function getRelayOnlySigner(opts: BuildOpts): KmsAccountBackend;
export declare function buildMacProvider(audience: string, opts: BuildOpts): A2AKeyProvider;

// viem adapter
export declare function createKmsAccount(
  backend: KmsAccountBackend,
  opts?: { sessionId?: string; chainId?: number },
): Promise<KMSSigner>;

// AAD helpers (consumed by delegation.SessionManager)
export declare function canonicalContextBytes(ctx: Record<string, string>): Uint8Array;

// Built-in provider class re-exports (also via subpaths)
export declare class LocalAesProvider implements A2AKeyProvider {
  readonly keyVersion: string;
  generateSessionDataKey: A2AKeyProvider['generateSessionDataKey'];
  decryptSessionDataKey: A2AKeyProvider['decryptSessionDataKey'];
}

export declare class LocalSecp256k1Signer implements KmsAccountBackend {
  signA2AAction: KmsAccountBackend['signA2AAction'];
  getSignerAddress(): Promise<Address>;
}

export declare class AwsKmsProvider implements A2AKeyProvider {
  readonly keyVersion: string;
  generateSessionDataKey: A2AKeyProvider['generateSessionDataKey'];
  decryptSessionDataKey: A2AKeyProvider['decryptSessionDataKey'];
}

export declare class AwsKmsSigner implements KmsAccountBackend {
  signA2AAction: KmsAccountBackend['signA2AAction'];
  getSignerAddress(): Promise<Address>;
}

export declare class GcpKmsProvider implements A2AKeyProvider {
  readonly keyVersion: string;
  generateSessionDataKey: A2AKeyProvider['generateSessionDataKey'];
  decryptSessionDataKey: A2AKeyProvider['decryptSessionDataKey'];
}

export declare class GcpKmsSigner implements KmsAccountBackend {
  signA2AAction: KmsAccountBackend['signA2AAction'];
  getSignerAddress(): Promise<Address>;
}
