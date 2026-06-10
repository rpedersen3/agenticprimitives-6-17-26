// Shared types for @agenticprimitives/delegation.

import type { Address, Hex } from '@agenticprimitives/types';

export type { Address, Hex };

export const ROOT_AUTHORITY: Hex =
  '0x0000000000000000000000000000000000000000000000000000000000000000';

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
  /**
   * DEL-001 (audit 2026-06-09) — the session-scoped leaf delegation that BINDS the session key to the
   * delegator. v4 binds to the DELEGATOR (the principal's canonical SA), not the delegate: its
   * `delegator` MUST equal `delegation.delegator` and its `delegate` MUST equal `sessionKeyAddress`;
   * the delegator SA authorized it (validated via the UniversalSignatureValidator, so any credential
   * strategy works). Without this leaf the full `delegation` travels in cleartext and anyone observing a
   * token re-mints it with their own session key (permanent delegator impersonation). `principal` stays
   * `delegation.delegator` — the leaf proves the presenting session key was authorized by that principal.
   */
  sessionDelegation?: Delegation;
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
  | { enforcer: Address; allowed: true; reason?: string }
  | { enforcer: Address; allowed: false; reason: string };

export type VerifyError = { error: string };

export interface JtiStore {
  trackUsage(jti: string, limit: number): Promise<{ usage: number; allowed: boolean }>;
}

export interface VerifyOpts {
  chainId: number;
  delegationManager: Address;
  rpcUrl: string;
  audience: string;
  enforcerMap: EnforcerAddressMap;
  jtiStore: JtiStore;
  now?: () => number;
  /**
   * Opt in to permissive caveat evaluation for on-chain-only caveats
   * (Value / AllowedTargets / AllowedMethods / inert sentinels) when the
   * caller can guarantee an on-chain redeem will follow (where the enforcer
   * DOES fire). When `false`/omitted (default — H7-B.2 strict mode), those
   * caveats deny missing-context with `'context-required'` so off-chain
   * gates (MCP / A2A) can't silently permit a call that the on-chain
   * enforcer would have caught.
   *
   * Off-chain JTI / session-token verify uses strict mode. Spec 202 §11.
   */
  enforceOnChain?: boolean;
  /**
   * DEL-001 (ADR-0036) — explicit opt-OUT of the session-key↔delegator binding. FAIL-CLOSED BY DEFAULT:
   * with `allowUnboundSessionToken` unset/false, `verifyDelegationToken` REQUIRES the token to carry a
   * valid `sessionDelegation` leaf binding the presenting session key to the DELEGATOR — the principal SA
   * (`leaf.delegator === delegation.delegator` + `leaf.delegate === sessionKeyAddress` + the delegator
   * SA's signature, validated via the UniversalSignatureValidator / deployed-ERC-1271). This closes the
   * observe-and-re-mint vector on EVERY verify path, including one that forgets to configure it — the
   * whole point of the flip (a critical authz control is not a per-call soft option a route can drop).
   *
   * Set `true` ONLY for an explicit legacy / non-client-minted path that issues UNBOUND tokens (e.g. a
   * trusted-relayer / persona path where the relayer — not a client — signed the token). It is the
   * greppable, audit-worthy escape hatch; a token without a leaf is REJECTED unless this is set.
   */
  allowUnboundSessionToken?: boolean;
  /**
   * spec 270 v4 — the deployed `UniversalSignatureValidator` address. When set, the delegation AND the
   * `sessionDelegation` leaf signatures are validated through it (ERC-1271 deployed / ERC-6492
   * counterfactual / ECDSA EOA) instead of a raw `isValidSignature` against a deployed SA — making the
   * verifier connection-agnostic (every credential strategy validates via one
   * surface) and removing the `requireDeployed` hard-reject for counterfactual SAs. Omit ⇒ legacy
   * deployed-ERC-1271-only path (non-breaking).
   */
  universalSignatureValidator?: Address;
}

/**
 * H7-B.2 — options for `evaluateCaveats`. Mirrors the `enforceOnChain` flag
 * on {@link VerifyOpts}. Strict by default.
 */
export interface EvaluateOpts {
  enforceOnChain?: boolean;
}

export interface DelegationClientOpts {
  signer: {
    address: Address;
    signTypedData(args: {
      domain: { name: string; version: string; chainId: number; verifyingContract: Address };
      types: Record<string, ReadonlyArray<{ name: string; type: string }>>;
      primaryType: string;
      message: Record<string, unknown>;
    }): Promise<Hex>;
  };
  smartAccount: Address;
  chainId: number;
  delegationManager: Address;
}

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
  chainId: number;
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

export interface TxContext {
  rpcUrl: string;
  chainId: number;
  delegationManager: Address;
  signer: {
    address: Address;
    signMessage(msg: string | { raw: Hex }): Promise<Hex>;
  };
}
