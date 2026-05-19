// @agenticprimitives/delegation — public API
//
// See spec.md for the full contract.

export type Address = `0x${string}`;
export type Hex = `0x${string}`;

export const ROOT_AUTHORITY: Hex = '0x0000000000000000000000000000000000000000000000000000000000000000';

export interface Caveat {
  enforcer: Address;
  terms: Hex;
  args?: Hex;
}

export interface Delegation {
  delegator: Address;
  delegate: Address;
  authority: Hex;
  caveats: Caveat[];
  salt: bigint;
  signature: Hex;
}

export interface DataScopeGrant {
  server: string;
  resources: string[];
  fields: string[];
}

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

export interface JtiStore {
  trackUsage(jti: string, limit: number): Promise<{ usage: number; allowed: boolean }>;
}

export interface DelegationStore {
  save(d: Delegation, audience: string): Promise<void>;
  get(hash: Hex): Promise<Delegation | null>;
  revoke(hash: Hex): Promise<void>;
  list(principal: Address, kind?: string): Promise<Delegation[]>;
}

// Caveat builders (universal)
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
export interface WalletLike {
  signMessage(args: { account: Address; message: { raw: Hex } }): Promise<Hex>;
}

export interface DelegationClientOpts {
  walletClient: WalletLike;
  smartAccount: Address;
  chainId: number;
  delegationManager: Address;
}

export declare class DelegationClient {
  constructor(opts: DelegationClientOpts);
  issueDelegation(params: { delegate: Address; caveats: Caveat[]; salt?: bigint }): Promise<Delegation>;
}

// Node mint + verify
export declare function mintDelegationToken(
  claims: Omit<DelegationTokenClaims, 'iat' | 'exp'>,
  signMessage: (msg: string) => Promise<Hex>,
): Promise<{ token: string; jti: string }>;

export interface VerifyOpts {
  chainId: number;
  delegationManager: Address;
  rpcUrl: string;
  audience: string;
  enforcerMap: EnforcerAddressMap;
  jtiStore: JtiStore;
  now?: () => number;
}

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

// On-chain helpers
export declare function isRevoked(hash: Hex, opts: { delegationManager: Address; rpcUrl: string }): Promise<boolean>;
