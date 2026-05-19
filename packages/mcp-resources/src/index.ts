// @agenticprimitives/mcp-resources — public API
//
// See spec.md for the full contract.

import type {
  Address,
  Hex,
  Caveat,
  DataScopeGrant,
  Delegation,
  EnforcerAddressMap,
  JtiStore,
  VerifyError,
} from '@agenticprimitives/delegation';

export type { Address, Hex, Caveat, DataScopeGrant, Delegation, EnforcerAddressMap, JtiStore };

export interface ResourceDefinition {
  name: string;
  audience: string;
  fields?: string[];
}

export interface ResourceScope {
  resource: string;
  readable: boolean;
  writable: boolean;
  fieldMask?: string[];
}

export interface ResourceClassification {
  '@sa-tool': 'delegation-verified' | 'service-only' | 'bootstrap' | 'dev-only';
  '@sa-auth': 'session-token' | 'service-hmac' | 'none' | 'none-with-csrf';
  '@sa-validation'?: 'shape-check' | 'json-schema' | 'none-no-body' | 'none-path-params' | 'wallet-action-canonical';
  '@sa-risk-tier'?: 'low' | 'medium' | 'high' | 'critical';
  '@sa-owner'?: string;
  '@sa-rate-limit'?: string;
  '@sa-prod-gate'?: 'enabled' | 'disabled';
}

export interface McpResourceVerifyConfig {
  audience: string;
  chainId: number;
  rpcUrl: string;
  delegationManager: Address;
  enforcerMap: EnforcerAddressMap;
  jtiStore: JtiStore;
  acceptLegacyCrossDelegations?: boolean;
}

// Wrappers
export declare function withDelegation<A extends Record<string, unknown>>(
  config: McpResourceVerifyConfig,
  handler: (args: A & { principal: Address; grants?: DataScopeGrant[] }) => Promise<unknown>,
): (args: A & { token: string }) => Promise<unknown>;

export declare function withCrossDelegation<A extends Record<string, unknown>>(
  config: McpResourceVerifyConfig,
  handler: (args: A & {
    callerPrincipal: Address;
    dataPrincipal: Address;
    grants: DataScopeGrant[];
  }) => Promise<unknown>,
): (args: A & { token: string; crossDelegationHash: Hex }) => Promise<unknown>;

// Resource declaration
export declare function declareResource(
  def: ResourceDefinition,
  classification: ResourceClassification,
): ResourceDefinition & { _classification: ResourceClassification };

// JTI stores (interface re-exported; concrete adapters live alongside)
export interface BetterSqlite3DatabaseLike {
  prepare(sql: string): { run(...args: unknown[]): unknown; get(...args: unknown[]): unknown };
}
export interface PgPoolLike {
  query(text: string, params?: unknown[]): Promise<{ rows: unknown[] }>;
}

export declare function createSqliteJtiStore(db: BetterSqlite3DatabaseLike, table?: string): JtiStore;
export declare function createPostgresJtiStore(pool: PgPoolLike, table?: string): JtiStore;
export declare function createMemoryJtiStore(): JtiStore;

// Low-level escape hatches
export declare function verifyDelegationForResource(
  token: string,
  config: McpResourceVerifyConfig,
  ctx?: { toolName?: string; timestamp?: number },
): Promise<{ principal: Address; grants?: DataScopeGrant[] } | VerifyError>;

export declare function verifyCrossDelegationForResource(
  crossDelegation: Delegation,
  callerPrincipal: Address,
  targetServer: string,
  config: McpResourceVerifyConfig,
): Promise<{ dataPrincipal: Address; grants: DataScopeGrant[] } | VerifyError>;
