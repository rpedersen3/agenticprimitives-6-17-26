// @agenticprimitives/kms — public API
//
// See spec.md for the full contract.

import type { Delegation, Hex, Address } from '@agenticprimitives/delegation';

export type { Address, Hex };

export type KmsBackend = 'local-aes' | 'aws-kms' | 'gcp-kms';

export interface BuildOpts {
  backend: KmsBackend;
  /** Optional per-backend overrides; mostly env-driven. */
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

export interface SessionMeta {
  sessionId: string;
  accountAddress: Address;
  chainId: number;
  expiresAt: string;
}

export interface SessionPackage {
  sessionPrivateKey: Hex;
  delegation: Delegation;
}

export interface EncryptedSessionRow {
  encryptedPackage: Uint8Array;
  iv: Uint8Array;
  encryptedDataKey: Uint8Array;
  keyVersion: string;
}

export interface DecryptAuditContext {
  toolId?: string;
  actionId?: string;
}

// Provider factories
export declare function buildKeyProvider(opts: BuildOpts): A2AKeyProvider;
export declare function buildSignerBackend(opts: BuildOpts): KmsAccountBackend;
export declare function buildToolExecutorBackend(toolId: string, opts: BuildOpts): KmsAccountBackend;
export declare function buildMacProvider(audience: string, opts: BuildOpts): A2AKeyProvider;
export declare function getRelayOnlySigner(opts: BuildOpts): KmsAccountBackend;

// Session package codec
export declare function encryptSessionPackage(
  payload: SessionPackage,
  meta: SessionMeta,
  provider: A2AKeyProvider,
): Promise<EncryptedSessionRow>;

export declare function decryptSessionPackage(
  row: EncryptedSessionRow,
  meta: SessionMeta,
  provider: A2AKeyProvider,
  audit?: DecryptAuditContext,
): Promise<SessionPackage>;

// AAD helpers
export declare function buildSessionAAD(meta: SessionMeta): Record<string, string>;
export declare function canonicalContextBytes(ctx: Record<string, string>): Uint8Array;

// viem adapter
export interface LocalAccountLike {
  address: Address;
  signMessage: (args: { message: string | { raw: Hex } }) => Promise<Hex>;
  signTypedData: (args: { domain: unknown; types: unknown; primaryType: string; message: unknown }) => Promise<Hex>;
}

export declare function createKmsAccount(
  backend: KmsAccountBackend,
  opts?: { sessionId?: string; chainId?: number },
): Promise<LocalAccountLike>;
