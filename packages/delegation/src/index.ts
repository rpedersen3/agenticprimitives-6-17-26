// @agenticprimitives/delegation — public API
//
// See ../../specs/202-delegation.md for the full contract.

import type { Address, Hex } from '@agenticprimitives/types';
import type { Signer } from '@agenticprimitives/identity-auth';
import type { AgentAccountClient } from '@agenticprimitives/agent-account';
import type { A2AKeyProvider } from '@agenticprimitives/key-custody';

export type { Address, Hex };

export const ROOT_AUTHORITY: Hex = '0x0000000000000000000000000000000000000000000000000000000000000000';

// Core types
export interface Caveat { enforcer: Address; terms: Hex; args?: Hex }
export interface Delegation {
  delegator: Address;
  delegate: Address;
  authority: Hex;
  caveats: Caveat[];
  salt: bigint;
  signature: Hex;
}
export interface DataScopeGrant { server: string; resources: string[]; fields: string[] }

export interface DelegationTokenClaims {
  iss: string;
  aud: string;
  sub: Address;
  delegation: Delegation;
  sessionKeyAddress: Address;
  jti: string;
  iat: number;
  exp: number;
  usageLimit?: number;
}

export interface EnforcerAddressMap {
  delegationManager: Address;
  timestamp: Address;
  value: Address;
  allowedTargets: Address;
  allowedMethods: Address;
  taskBinding?: Address;
  callDataHash?: Address;
  recovery?: Address;
  rateLimit?: Address;
}

export interface CaveatContext {
  timestamp: number;
  mcpTool?: string;
  target?: Address;
  selector?: Hex;
  value?: bigint;
  principal?: Address;
}

export type CaveatVerdict =
  | { enforcer: Address; allowed: true }
  | { enforcer: Address; allowed: false; reason: string };

export type VerifyError = { error: string };

export interface VerifyOpts {
  chainId: number;
  delegationManager: Address;
  rpcUrl: string;
  audience: string;
  enforcerMap: EnforcerAddressMap;
  jtiStore: JtiStore;
  now?: () => number;
}

export interface JtiStore {
  trackUsage(jti: string, limit: number): Promise<{ usage: number; allowed: boolean }>;
}

// Caveat builders
export declare function buildCaveat(enforcer: Address, terms: Hex, args?: Hex): Caveat;
export declare function encodeTimestampTerms(validAfter: number, validUntil: number): Hex;
export declare function encodeValueTerms(maxValue: bigint): Hex;
export declare function encodeAllowedTargetsTerms(targets: Address[]): Hex;
export declare function encodeAllowedMethodsTerms(selectors: Hex[]): Hex;
export declare function buildMcpToolScopeCaveat(allowedTools: string[]): Caveat;
export declare function buildDataScopeCaveat(grants: DataScopeGrant[]): Caveat;
export declare function buildDelegateBindingCaveat(delegateSmartAccount: Address, delegatePersonAgent: Address): Caveat;

// Hashing & evaluation
export declare function hashDelegation(d: Delegation, chainId: number, delegationManager: Address): Hex;
export declare function hashCaveats(caveats: Caveat[]): Hex;
export declare function evaluateCaveats(caveats: Caveat[], ctx: CaveatContext, enforcerMap: EnforcerAddressMap): CaveatVerdict[];

// Browser issuance
export interface DelegationClientOpts {
  signer: Signer;
  smartAccount: Address;
  chainId: number;
  delegationManager: Address;
}

export declare class DelegationClient {
  constructor(opts: DelegationClientOpts);
  issueDelegation(params: { delegate: Address; caveats: Caveat[]; salt?: bigint }): Promise<Delegation>;
}

// Session lifecycle (absorbed from former kms scope)
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

export interface SessionRow {
  id: string;
  accountAddress: Address;
  sessionKeyAddress: Address;
  status: 'pending' | 'active' | 'revoked' | 'expired';
  encryptedPackage: Uint8Array;
  iv: Uint8Array;
  encryptedDataKey: Uint8Array;
  keyVersion: string;
  expiresAt: string;
  variant?: 'A' | 'B';
  createdAt: string;
  revokedAt?: string;
}

export interface SessionStore {
  save(row: SessionRow): Promise<void>;
  get(id: string): Promise<SessionRow | null>;
  list(accountAddress: Address): Promise<SessionRow[]>;
  revoke(id: string): Promise<void>;
}

export declare class SessionManager {
  constructor(opts: {
    keyCustody: A2AKeyProvider;
    store: SessionStore;
    accountClient: AgentAccountClient;
  });
  init(accountAddress: Address, chainId: number): Promise<{ sessionId: string; sessionKeyAddress: Address }>;
  package(sessionId: string, delegation: Delegation): Promise<void>;
  resolve(sessionId: string): Promise<{ signer: Signer; delegation: Delegation; meta: SessionMeta }>;
  revoke(sessionId: string): Promise<void>;
}

// Token mint + verify
export declare function mintDelegationToken(
  claims: Omit<DelegationTokenClaims, 'iat' | 'exp'>,
  signMessage: (msg: string) => Promise<Hex>,
): Promise<{ token: string; jti: string }>;

export declare function verifyDelegationToken(
  token: string,
  opts: VerifyOpts,
): Promise<{ principal: Address; grants?: DataScopeGrant[] } | VerifyError>;

export declare function verifyCrossDelegation(
  delegation: Delegation,
  callerPrincipal: Address,
  targetServer: string,
  opts: VerifyOpts,
): Promise<{ dataPrincipal: Address; grants: DataScopeGrant[] } | VerifyError>;

// On-chain
export interface TxContext {
  rpcUrl: string;
  chainId: number;
  delegationManager: Address;
  signer: Signer;
}

export declare function isRevoked(hash: Hex, opts: { delegationManager: Address; rpcUrl: string }): Promise<boolean>;
export declare function revokeDelegation(hash: Hex, ctx: TxContext): Promise<Hex>;
