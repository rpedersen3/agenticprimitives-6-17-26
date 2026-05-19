import type { Address, Hex } from '@agenticprimitives/types';
import type {
  Caveat,
  DataScopeGrant,
  Delegation,
  EnforcerAddressMap,
  JtiStore,
  VerifyError,
} from '@agenticprimitives/delegation';
import type { ToolClassification } from '@agenticprimitives/tool-policy';

export type { Address, Hex, Caveat, DataScopeGrant, Delegation, EnforcerAddressMap, JtiStore, ToolClassification, VerifyError };

export interface McpResourceVerifyConfig {
  audience: string;
  chainId: number;
  rpcUrl: string;
  delegationManager: Address;
  enforcerMap: EnforcerAddressMap;
  jtiStore: JtiStore;
  acceptLegacyCrossDelegations?: boolean;
}

export interface ResourceDefinition {
  name: string;
  audience: string;
  fields?: string[];
}

export interface BetterSqlite3DatabaseLike {
  prepare(sql: string): {
    run(...args: unknown[]): unknown;
    get(...args: unknown[]): unknown;
  };
}

export interface PgPoolLike {
  query(text: string, params?: unknown[]): Promise<{ rows: unknown[] }>;
}
