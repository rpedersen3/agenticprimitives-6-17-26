// Caveat evaluator — fail-closed dispatcher.
//
// Each Caveat has an `enforcer` address that selects an evaluator function.
// Unknown enforcer addresses → reject (no permissive default). This is a
// CORE security invariant per spec 202 §11. Verbatim from smart-agent.

import { decodeAbiParameters, type Address } from 'viem';
import type {
  Caveat,
  CaveatContext,
  CaveatVerdict,
  EnforcerAddressMap,
} from './types';
import {
  MCP_TOOL_SCOPE_ENFORCER,
  DATA_SCOPE_ENFORCER,
  DELEGATE_BINDING_ENFORCER,
} from './caveats';

type EvalFn = (c: Caveat, ctx: CaveatContext) => CaveatVerdict;

function lower(a?: Address): string | undefined {
  return a?.toLowerCase();
}

function evalTimestamp(c: Caveat, ctx: CaveatContext): CaveatVerdict {
  try {
    const [validAfter, validUntil] = decodeAbiParameters(
      [{ type: 'uint256' }, { type: 'uint256' }],
      c.terms,
    ) as readonly [bigint, bigint];
    const ts = BigInt(ctx.timestamp);
    if (ts < validAfter) return { enforcer: c.enforcer, allowed: false, reason: 'before validAfter' };
    if (ts >= validUntil) return { enforcer: c.enforcer, allowed: false, reason: 'after validUntil' };
    return { enforcer: c.enforcer, allowed: true };
  } catch (e) {
    return { enforcer: c.enforcer, allowed: false, reason: `timestamp decode error: ${e instanceof Error ? e.message : e}` };
  }
}

function evalValue(c: Caveat, ctx: CaveatContext): CaveatVerdict {
  if (ctx.value === undefined) return { enforcer: c.enforcer, allowed: true }; // context-less; enforced on-chain
  try {
    const [maxValue] = decodeAbiParameters([{ type: 'uint256' }], c.terms) as readonly [bigint];
    if (ctx.value > maxValue) return { enforcer: c.enforcer, allowed: false, reason: 'value over cap' };
    return { enforcer: c.enforcer, allowed: true };
  } catch (e) {
    return { enforcer: c.enforcer, allowed: false, reason: `value decode error: ${e instanceof Error ? e.message : e}` };
  }
}

function evalAllowedTargets(c: Caveat, ctx: CaveatContext): CaveatVerdict {
  if (!ctx.target) return { enforcer: c.enforcer, allowed: true }; // context-less; enforced on-chain
  try {
    const [targets] = decodeAbiParameters([{ type: 'address[]' }], c.terms) as readonly [Address[]];
    const target = ctx.target.toLowerCase();
    if (targets.some((t) => t.toLowerCase() === target)) return { enforcer: c.enforcer, allowed: true };
    return { enforcer: c.enforcer, allowed: false, reason: 'target not in allowlist' };
  } catch (e) {
    return { enforcer: c.enforcer, allowed: false, reason: `targets decode error: ${e instanceof Error ? e.message : e}` };
  }
}

function evalAllowedMethods(c: Caveat, ctx: CaveatContext): CaveatVerdict {
  if (!ctx.selector) return { enforcer: c.enforcer, allowed: true };
  try {
    const [selectors] = decodeAbiParameters([{ type: 'bytes4[]' }], c.terms) as readonly [`0x${string}`[]];
    const sel = ctx.selector.toLowerCase();
    if (selectors.some((s) => s.toLowerCase() === sel)) return { enforcer: c.enforcer, allowed: true };
    return { enforcer: c.enforcer, allowed: false, reason: 'selector not in allowlist' };
  } catch (e) {
    return { enforcer: c.enforcer, allowed: false, reason: `methods decode error: ${e instanceof Error ? e.message : e}` };
  }
}

function evalMcpToolScope(c: Caveat, ctx: CaveatContext): CaveatVerdict {
  if (!ctx.mcpTool) return { enforcer: c.enforcer, allowed: false, reason: 'no tool name in context' };
  try {
    const [tools] = decodeAbiParameters([{ type: 'string[]' }], c.terms) as readonly [string[]];
    if (tools.includes(ctx.mcpTool)) return { enforcer: c.enforcer, allowed: true };
    return { enforcer: c.enforcer, allowed: false, reason: 'tool not in scope' };
  } catch (e) {
    return { enforcer: c.enforcer, allowed: false, reason: `mcp-tool-scope decode error: ${e instanceof Error ? e.message : e}` };
  }
}

function evalInert(c: Caveat): CaveatVerdict {
  // DATA_SCOPE + DELEGATE_BINDING + on-chain-only enforcers are
  // evaluated outside this dispatcher (by verifyCrossDelegation or
  // on-chain). We accept here as inert BUT sanity-check the term
  // structure — malformed terms must reject at the closest layer to
  // discovery to keep downstream verifiers from having to defend
  // against garbage. Per spec 202 § 11: fail-closed on shape.
  const enforcerLower = c.enforcer.toLowerCase();
  if (enforcerLower === DELEGATE_BINDING_ENFORCER.toLowerCase()) {
    try {
      // DelegateBinding terms = abi.encode(address, address) — EXACTLY
      // 64 bytes (0x + 128 hex chars). We assert length explicitly:
      // viem's decoder happily ignores trailing bytes, so a 16 KiB blob
      // whose first 64 bytes encode two addresses would otherwise pass
      // this shape check. The CLAUDE.md regression class.
      const expectedHexLen = 2 + 64 * 2; // "0x" + 64 bytes
      if (c.terms.length !== expectedHexLen) {
        return {
          enforcer: c.enforcer,
          allowed: false,
          reason: `delegate-binding: terms length ${c.terms.length} ≠ expected ${expectedHexLen} (abi.encode(address,address) is exactly 64 bytes)`,
        };
      }
      const [smartAccount, personAgent] = decodeAbiParameters(
        [{ type: 'address' }, { type: 'address' }],
        c.terms,
      );
      if (
        smartAccount === '0x0000000000000000000000000000000000000000' ||
        personAgent === '0x0000000000000000000000000000000000000000'
      ) {
        return {
          enforcer: c.enforcer,
          allowed: false,
          reason: 'delegate-binding: zero address in terms',
        };
      }
    } catch (e) {
      return {
        enforcer: c.enforcer,
        allowed: false,
        reason: `delegate-binding: malformed terms — ${e instanceof Error ? e.message : e}`,
      };
    }
  }
  return { enforcer: c.enforcer, allowed: true };
}

/**
 * Evaluate every caveat in the array. Returns one verdict per caveat,
 * in input order. Caller decides what to do on the first deny.
 *
 * Unknown enforcer addresses produce a deny verdict. No exceptions.
 */
export function evaluateCaveats(
  caveats: Caveat[],
  ctx: CaveatContext,
  enforcerMap: EnforcerAddressMap,
): CaveatVerdict[] {
  // Build dispatch table keyed by lowercased enforcer address.
  const dispatch = new Map<string, EvalFn>();
  if (enforcerMap.timestamp) dispatch.set(lower(enforcerMap.timestamp)!, evalTimestamp);
  if (enforcerMap.value) dispatch.set(lower(enforcerMap.value)!, evalValue);
  if (enforcerMap.allowedTargets) dispatch.set(lower(enforcerMap.allowedTargets)!, evalAllowedTargets);
  if (enforcerMap.allowedMethods) dispatch.set(lower(enforcerMap.allowedMethods)!, evalAllowedMethods);
  // Sentinels are constant addresses regardless of chain.
  dispatch.set(MCP_TOOL_SCOPE_ENFORCER.toLowerCase(), evalMcpToolScope);
  dispatch.set(DATA_SCOPE_ENFORCER.toLowerCase(), evalInert);
  dispatch.set(DELEGATE_BINDING_ENFORCER.toLowerCase(), evalInert);
  // On-chain-only enforcers are inert here (taskBinding, callDataHash, recovery, rateLimit).
  if (enforcerMap.taskBinding) dispatch.set(lower(enforcerMap.taskBinding)!, evalInert);
  if (enforcerMap.callDataHash) dispatch.set(lower(enforcerMap.callDataHash)!, evalInert);
  if (enforcerMap.recovery) dispatch.set(lower(enforcerMap.recovery)!, evalInert);
  if (enforcerMap.rateLimit) dispatch.set(lower(enforcerMap.rateLimit)!, evalInert);

  const verdicts: CaveatVerdict[] = [];
  for (const c of caveats) {
    const fn = dispatch.get(c.enforcer.toLowerCase());
    if (!fn) {
      verdicts.push({ enforcer: c.enforcer, allowed: false, reason: 'unknown enforcer' });
      continue;
    }
    verdicts.push(fn(c, ctx));
  }
  return verdicts;
}
