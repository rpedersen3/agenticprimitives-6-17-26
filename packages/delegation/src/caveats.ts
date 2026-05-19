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
