// @agenticprimitives/identity-auth — public API
//
// See ../../specs/200-identity-auth.md for the full contract.

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

// Session
export declare function mintSession(claims: Omit<JwtClaims, 'iat' | 'exp'>): string;
export declare function verifySession(cookieValue: string): JwtClaims | null;
export declare const SESSION_COOKIE: string;
export declare const SESSION_TTL_SECONDS: number;

// CSRF
export declare function csrfTokenFor(origin: string): string;
export declare function verifyCsrf(token: string, allowedOrigins: string[]): boolean;

// Salt derivation (consumed by @agenticprimitives/agent-account)
export declare function deriveSaltFromLabel(label: string): bigint;
export declare function deriveSaltFromEmail(email: string, rotation: number): bigint;

// Signer interfaces — the architectural contract
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
