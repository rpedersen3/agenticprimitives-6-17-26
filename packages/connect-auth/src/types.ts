// Shared types for @agenticprimitives/connect-auth.

import type { Address, Hex } from '@agenticprimitives/types';

export type { Address, Hex };

export type AuthMethod = 'passkey' | 'siwe' | 'google';

export interface JwtClaims {
  sub: string;
  walletAddress: Address | null;
  smartAccountAddress: Address;
  name: string;
  email: string | null;
  via: AuthMethod;
  kind: 'session' | 'session-grant';
  iat: number;
  exp: number;
}

export interface AuthenticatedUser {
  id: string;
  walletAddress: Address | null;
  smartAccountAddress: Address | null;
  name: string;
  email: string | null;
  via: AuthMethod;
}

export interface TypedDataDomain {
  name?: string;
  version?: string;
  chainId?: number;
  verifyingContract?: Address;
  salt?: Hex;
}

export type TypedDataTypes = Record<string, Array<{ name: string; type: string }>>;

export interface Signer {
  readonly address: Address;
  signMessage(msg: string | { raw: Hex }): Promise<Hex>;
  signTypedData(args: {
    domain: TypedDataDomain;
    types: TypedDataTypes;
    primaryType: string;
    message: Record<string, unknown>;
  }): Promise<Hex>;
}

export interface PasskeyAssertion {
  authenticatorData: Hex;
  clientDataJSON: Hex;
  signature: Hex;
}

export interface PasskeySigner extends Signer {
  readonly credentialId: string;
  assert(challenge: Hex): Promise<PasskeyAssertion>;
}

export interface EOASigner extends Signer {
  /** marker type — viem-compatible LocalAccount or WalletClient adapter */
}

export interface KMSSigner extends Signer {
  readonly keyId: string;
  readonly provider: 'local-aes' | 'aws-kms' | 'gcp-kms';
}
