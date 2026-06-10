// Scoped-grant caveat builders (spec 269 FR-4.2). A caller mints a delegation scoped to EXACTLY one
// recipient agent + one skill so it can't be replayed against a different agent/skill (the A2A
// non-replayability model — the agent-endpoint analogue of DEL-001's "possession ≠ authority"). Reuses
// the deployed AllowedTargets / AllowedMethods / Timestamp enforcers — we invent no new ones.
import { keccak256, toBytes, type Address, type Hex } from 'viem';
import {
  buildCaveat,
  encodeTimestampTerms,
  encodeAllowedTargetsTerms,
  encodeAllowedMethodsTerms,
} from '@agenticprimitives/delegation';
import type { Caveat } from '@agenticprimitives/delegation';

/** The "any skill" sentinel for `allowedMethods` — a grant carrying this selector authorizes every
 *  skill on the recipient agent (use sparingly; a specific selector is the default). */
export const A2A_ANY_SKILL: Hex = '0x00000000';

/** Map a skill name to its 4-byte `allowedMethods` selector: keccak256(utf8(skill))[:4]. */
export function skillSelector(skill: string): Hex {
  if (skill === '*' || skill === A2A_ANY_SKILL) return A2A_ANY_SKILL;
  return keccak256(toBytes(skill)).slice(0, 10) as Hex; // 0x + 8 hex = 4 bytes
}

/** The deployed enforcer addresses (from the network deployment) the grant pins against. */
export interface A2aEnforcers {
  allowedTargets: Address;
  allowedMethods: Address;
  timestamp: Address;
}

/**
 * Build the caveat set for an A2A grant: a timestamp window, the recipient agent SA as the ONLY allowed
 * target, and the requested skill (or `*` → any) as the ONLY allowed method. The caller attaches these
 * to the `Delegation` it signs. The receiving agent's auth gate (`authorizeA2aMessage`) decodes + enforces
 * them, rejecting a grant whose target ≠ this agent or whose method ≠ the requested skill.
 */
export function buildA2aGrantCaveats(args: {
  recipientAgentSA: Address;
  skill: string;
  enforcers: A2aEnforcers;
  window: { validAfter: number; validUntil: number };
}): Caveat[] {
  return [
    buildCaveat(args.enforcers.timestamp, encodeTimestampTerms(args.window.validAfter, args.window.validUntil)),
    buildCaveat(args.enforcers.allowedTargets, encodeAllowedTargetsTerms([args.recipientAgentSA])),
    buildCaveat(args.enforcers.allowedMethods, encodeAllowedMethodsTerms([skillSelector(args.skill)])),
  ];
}
