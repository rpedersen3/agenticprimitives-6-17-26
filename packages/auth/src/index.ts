// @agenticprimitives/auth — public API
//
// See spec.md for the full contract.
// Implementation lands incrementally; this file currently exports types only.

export type Address = `0x${string}`;
export type Hex = `0x${string}`;

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

export interface CreateAgentAccountParams {
  owner: Address;
  salt: bigint;
}

export interface AgentAccountClientOpts {
  rpcUrl: string;
  chainId: number;
  entryPoint: Address;
  factory: Address;
}

export declare function mintSession(claims: Omit<JwtClaims, 'iat' | 'exp'>): string;
export declare function verifySession(cookieValue: string): JwtClaims | null;
export declare const SESSION_COOKIE: string;
export declare const SESSION_TTL_SECONDS: number;

export declare function csrfTokenFor(origin: string): string;
export declare function verifyCsrf(token: string, allowedOrigins: string[]): boolean;

export declare class AgentAccountClient {
  constructor(opts: AgentAccountClientOpts);
  getAddress(owner: Address, salt: bigint): Promise<Address>;
  createAccount(params: CreateAgentAccountParams): Promise<Address>;
  isOwner(account: Address, address: Address): Promise<boolean>;
  isDeployed(account: Address): Promise<boolean>;
}
