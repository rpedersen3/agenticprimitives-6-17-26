// Caveat builders + ABI-encoded terms.
//
// Eight on-chain enforcers (TimestampEnforcer, ValueEnforcer, etc.) + three
// off-chain sentinels (MCP_TOOL_SCOPE, DATA_SCOPE, DELEGATE_BINDING) whose
// addresses are derived via keccak256('urn:smart-agent:<name>')[0:20]. The
// sentinels never live on-chain; their semantics live in this package's
// evaluator (off-chain only).

import { encodeAbiParameters, type Hex, type Address } from 'viem';
import { keccak_256 } from '@noble/hashes/sha3';
import type { Caveat, DataScopeGrant } from './types';

// ─── Off-chain sentinel addresses ────────────────────────────────────────

function sentinelAddress(urn: string): Address {
  const hash = keccak_256(new TextEncoder().encode(urn));
  let hex = '0x';
  for (const b of hash.slice(0, 20)) hex += b.toString(16).padStart(2, '0');
  return hex as Address;
}

export const MCP_TOOL_SCOPE_ENFORCER: Address = sentinelAddress('urn:smart-agent:mcp-tool-scope');
export const DATA_SCOPE_ENFORCER: Address = sentinelAddress('urn:smart-agent:data-scope');
export const DELEGATE_BINDING_ENFORCER: Address = sentinelAddress('urn:smart-agent:delegate-binding');

// ─── Generic caveat builder ──────────────────────────────────────────────

export function buildCaveat(enforcer: Address, terms: Hex, args?: Hex): Caveat {
  return { enforcer, terms, args: args ?? '0x' };
}

// ─── On-chain enforcer term encoders ─────────────────────────────────────

export function encodeTimestampTerms(validAfter: number, validUntil: number): Hex {
  if (!Number.isInteger(validAfter) || validAfter < 0) {
    throw new Error('encodeTimestampTerms: validAfter must be a non-negative integer');
  }
  if (!Number.isInteger(validUntil) || validUntil <= validAfter) {
    throw new Error('encodeTimestampTerms: validUntil must be > validAfter');
  }
  return encodeAbiParameters(
    [{ type: 'uint256' }, { type: 'uint256' }],
    [BigInt(validAfter), BigInt(validUntil)],
  );
}

export function encodeValueTerms(maxValue: bigint): Hex {
  if (maxValue < 0n) throw new Error('encodeValueTerms: maxValue must be non-negative');
  return encodeAbiParameters([{ type: 'uint256' }], [maxValue]);
}

export function encodeAllowedTargetsTerms(targets: Address[]): Hex {
  if (targets.length === 0) throw new Error('encodeAllowedTargetsTerms: at least one target required');
  return encodeAbiParameters([{ type: 'address[]' }], [targets]);
}

export function encodeAllowedMethodsTerms(selectors: Hex[]): Hex {
  if (selectors.length === 0) throw new Error('encodeAllowedMethodsTerms: at least one selector required');
  for (const s of selectors) {
    if (!/^0x[0-9a-fA-F]{8}$/.test(s)) {
      throw new Error(`encodeAllowedMethodsTerms: selector "${s}" must be 4 bytes (0x + 8 hex chars)`);
    }
  }
  return encodeAbiParameters([{ type: 'bytes4[]' }], [selectors]);
}

// ─── Off-chain sentinel caveat builders ──────────────────────────────────

export function buildMcpToolScopeCaveat(allowedTools: string[]): Caveat {
  if (allowedTools.length === 0) throw new Error('buildMcpToolScopeCaveat: at least one tool required');
  const terms = encodeAbiParameters([{ type: 'string[]' }], [allowedTools]);
  return { enforcer: MCP_TOOL_SCOPE_ENFORCER, terms, args: '0x' };
}

export function buildDataScopeCaveat(grants: DataScopeGrant[]): Caveat {
  if (grants.length === 0) throw new Error('buildDataScopeCaveat: at least one grant required');
  const terms = encodeAbiParameters(
    [
      {
        type: 'tuple[]',
        components: [
          { name: 'server', type: 'string' },
          { name: 'resources', type: 'string[]' },
          { name: 'fields', type: 'string[]' },
        ],
      },
    ],
    [grants],
  );
  return { enforcer: DATA_SCOPE_ENFORCER, terms, args: '0x' };
}

export function buildDelegateBindingCaveat(
  delegateSmartAccount: Address,
  delegatePersonAgent: Address,
): Caveat {
  const terms = encodeAbiParameters(
    [{ type: 'address' }, { type: 'address' }],
    [delegateSmartAccount, delegatePersonAgent],
  );
  return { enforcer: DELEGATE_BINDING_ENFORCER, terms, args: '0x' };
}

// ─── Spec 207 — QuorumEnforcer caveat builder ────────────────────────
//
// On-chain enforcer at `apps/contracts/src/enforcers/QuorumEnforcer.sol`
// (shipped in pass 6c.1). Caveat terms bind the signer set + threshold +
// ApprovedHashRegistry at delegation issuance; redeem-time `args` carry
// the payload hash + Safe-compatible packed signature blob. See
// `apps/demo-web-pro/docs/multi-sig/guide.md` for the consumer-facing
// walkthrough.

export interface QuorumCaveatOpts {
  /**
   * Address of the deployed `QuorumEnforcer` contract for this chain.
   * Read from `deployments-<network>.json` at the consumer-app layer
   * — `@agenticprimitives/delegation` is chain-agnostic and never
   * resolves addresses itself.
   */
  enforcer: Address;
  /** Addresses authorized to participate in the quorum. Sorted by the
   *  redeemer before signing (sorted-ascending is the anti-duplicate
   *  scheme); order at issuance time is irrelevant. */
  signers: Address[];
  /** Minimum number of signatures required at redemption. Spec 207
   *  § 5.1 default thresholds map naturally onto this value when the
   *  caveat is attached to a T3+ delegation. */
  threshold: number;
  /** Optional `ApprovedHashRegistry` for the v=1 pre-approved-hash
   *  signature path. Pass `0x0000…0` to forbid v=1 entirely. */
  approvedHashRegistry: Address;
}

/**
 * Build a `QuorumEnforcer` caveat. Pair with delegations whose
 * `tool-policy.evaluateThresholdPolicy` decision has
 * `requiresQuorum: true` (T3 Value and above). Without this caveat,
 * `verifyDelegationToken({ requireQuorumForTier })` fails closed.
 *
 * Wire format of the terms blob exactly matches what
 * `QuorumEnforcer.beforeHook` decodes:
 *   abi.encode(address[] signerSet, uint8 threshold, address approvedHashRegistry)
 *
 * The redeem-time `args` are caller-supplied at execution time, not
 * at issuance — `mcp-runtime.withDelegation` (6c.4) constructs them
 * from the user's signed payload + signature blob and forwards them
 * into the on-chain caveat evaluation.
 */
export function buildQuorumCaveat(opts: QuorumCaveatOpts): Caveat {
  if (!Array.isArray(opts.signers) || opts.signers.length === 0) {
    throw new Error('buildQuorumCaveat: signers must be a non-empty array');
  }
  if (!Number.isInteger(opts.threshold) || opts.threshold < 1) {
    throw new Error('buildQuorumCaveat: threshold must be an integer ≥ 1');
  }
  if (opts.threshold > opts.signers.length) {
    throw new Error(
      `buildQuorumCaveat: threshold (${opts.threshold}) exceeds signer set size (${opts.signers.length})`,
    );
  }
  if (opts.threshold > 255) {
    throw new Error('buildQuorumCaveat: threshold exceeds uint8 bound (255)');
  }
  const terms = encodeAbiParameters(
    [
      { type: 'address[]' },
      { type: 'uint8' },
      { type: 'address' },
    ],
    [opts.signers, opts.threshold, opts.approvedHashRegistry],
  );
  return { enforcer: opts.enforcer, terms, args: '0x' };
}
