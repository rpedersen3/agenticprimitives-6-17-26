// @agenticprimitives/mcp-runtime — public API
//
// See ../../specs/205-mcp-runtime.md for the full contract.

import type { Address, Hex } from '@agenticprimitives/types';
import type {
  Delegation,
  Caveat,
  DataScopeGrant,
  DelegationTokenClaims,
  EnforcerAddressMap,
  JtiStore,
  VerifyError,
} from '@agenticprimitives/delegation';
import type { ToolClassification } from '@agenticprimitives/tool-policy';

export type { Address, Hex, Caveat, DataScopeGrant, Delegation, EnforcerAddressMap, JtiStore, ToolClassification };

export interface ResourceDefinition {
  name: string;
  audience: string;
  fields?: string[];
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

// Resource declaration (composes with tool-policy)
export declare function declareResource(
  def: ResourceDefinition,
  classification: ToolClassification,
): ResourceDefinition & { _classification: ToolClassification };

// JTI stores
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
