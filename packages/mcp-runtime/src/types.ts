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
   * (packages/contracts/deployments-<network>.json's `quorumEnforcer`
   * field). When unset, T3+ tools that require quorum will fail
   * closed at the boundary — apps that don't ship multi-sig can
   * either omit T3+ tools or leave this unset and stick to T1/T2.
   */
  quorumEnforcer?: Address;
  /**
   * Opt the off-chain delegation evaluator into "this delegation will be
   * redeemed on-chain elsewhere; treat inert/on-chain-only caveats as
   * allowed when off-chain context is missing." Default: `false` (strict
   * H7-B.2 mode — rejects with `context-required` when an inert caveat
   * is encountered without context).
   *
   * Set `true` for MCP READ flows where the delegation carries on-chain
   * action caveats (AllowedTargets / AllowedMethods / Value) that are
   * conceptually inert for off-chain read operations.
   */
  enforceOnChain?: boolean;
  /**
   * DEL-001 (ADR-0036) — explicit opt-OUT of the session-key↔delegator binding, threaded into
   * `verifyDelegationToken`'s `allowUnboundSessionToken`. Binding is ENFORCED BY DEFAULT (fail-closed):
   * a tool whose resource verify config sets nothing rejects any token lacking a valid `sessionDelegation`
   * leaf, closing the observe-and-re-mint vector even if a route forgets to configure it. Set `true` ONLY
   * for an explicit legacy / non-client-minted (trusted-relayer / persona) resource that accepts unbound
   * tokens. The greppable escape hatch.
   */
  allowUnboundSessionToken?: boolean;
  /**
   * DEL-001 (spec 270 v4) — the deployed `UniversalSignatureValidator` address. When set, the
   * delegation AND the `sessionDelegation` leaf signatures are validated through it (ERC-1271 deployed /
   * ERC-6492 counterfactual / ECDSA EOA), making verification connection-agnostic. Threaded into
   * `verifyDelegationToken`'s `universalSignatureValidator`. Omit ⇒ legacy deployed-ERC-1271 path.
   */
  universalSignatureValidator?: Address;
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
