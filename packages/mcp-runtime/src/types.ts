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
  /**
   * Whether to require the delegator's smart account to be on-chain.
   * Default: `true` (fail-closed). When the account isn't deployed, ERC-1271
   * can't be verified. Demos using counterfactual addresses without
   * deploying may set `false` explicitly.
   */
  requireDeployed?: boolean;
  /**
   * Spec 207: `QuorumEnforcer` contract address for this chain. When a
   * tool's classification produces a `requiresQuorum: true` decision
   * from `tool-policy.evaluateThresholdPolicy(...)`, `withDelegation`
   * threads this address into `delegation.verifyDelegationToken`'s
   * `requireQuorumCaveat` opt so the delegation MUST carry a quorum
   * caveat with this enforcer or verify fails closed.
   *
   * Consumer apps SHOULD configure this from their deployments JSON
   * (apps/contracts/deployments-<network>.json's `quorumEnforcer`
   * field). When unset, T3+ tools that require quorum will fail
   * closed at the boundary — apps that don't ship multi-sig can
   * either omit T3+ tools or leave this unset and stick to T1/T2.
   */
  quorumEnforcer?: Address;
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
