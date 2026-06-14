// The A2A delegation-auth gate (spec 269 FR-4 / SR-1..SR-6). Net-new vs the legacy vault path, which
// checks only timestamp. Every inbound A2A message is gated here BEFORE any task is created:
//   FR-4.1 delegate===requester, timestamp window, on-chain isRevoked (fail-closed), ERC-1271 delegator.
//   FR-4.2 the grant MUST scope to THIS recipient agent (allowedTargets) + the requested skill
//          (allowedMethods) — what makes a grant non-replayable against a different agent/skill.
//   FR-4.3 single-use message-id (inbound replay guard).
//   FR-4.4 the inbound message is signed by the sender.
// On-chain reads are INJECTED (the package stays transport-agnostic); the consumer wires viem.
import { decodeAbiParameters, keccak256, encodeAbiParameters, toBytes, type Address, type Hex } from 'viem';
import type { Delegation, Caveat } from '@agenticprimitives/delegation';
import type { A2aMessage } from './types.js';
import { skillSelector, A2A_ANY_SKILL, type A2aEnforcers } from './grant.js';

/** Decode the deployed enforcers' term formats (must mirror delegation's encoders byte-for-byte). */
export function decodeTimestampTerms(terms: Hex): { validAfter: bigint; validUntil: bigint } {
  const [validAfter, validUntil] = decodeAbiParameters([{ type: 'uint256' }, { type: 'uint256' }], terms);
  return { validAfter, validUntil };
}
export function decodeAllowedTargetsTerms(terms: Hex): readonly Address[] {
  const [targets] = decodeAbiParameters([{ type: 'address[]' }], terms);
  return targets as readonly Address[];
}
export function decodeAllowedMethodsTerms(terms: Hex): readonly Hex[] {
  const [selectors] = decodeAbiParameters([{ type: 'bytes4[]' }], terms);
  return selectors as readonly Hex[];
}

/** Canonical hash the SENDER signs for an inbound message (A2A-INV-01). Binds id + sender + skill + body. */
export function hashA2aMessage(m: Pick<A2aMessage, 'messageId' | 'sender' | 'skill' | 'bodyHash' | 'createdAt'>): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: 'bytes32' }, { type: 'address' }, { type: 'bytes32' }, { type: 'bytes32' }, { type: 'uint256' }],
      [m.messageId, m.sender, keccak256(toBytes(m.skill)), m.bodyHash, BigInt(m.createdAt)],
    ),
  );
}

/** AUDIT NEW-A2A-2: canonical digest the CALLER signs for a read/control request (tasks/get | cancel |
 *  pushNotificationConfig/set). Authorization for these ops previously trusted a `caller` param the client
 *  supplied — any attacker who knew a taskId could impersonate a party. The caller now PROVES control of
 *  `caller` by signing this digest (verified via `OnChainChecks.verifyCallerSignature`). Bound to the
 *  method (can't replay a `get` signature as a `cancel`), the taskId, the verifying agent, and the chain
 *  (no cross-deployment replay). The agent re-derives it server-side — a client-supplied digest is never
 *  trusted. */
export function hashA2aTaskRequest(r: { method: string; taskId: Hex; agentSA: Address; chainId: number }): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: 'bytes32' }, { type: 'bytes32' }, { type: 'address' }, { type: 'uint256' }],
      [keccak256(toBytes(`a2a:request:${r.method}`)), r.taskId, r.agentSA, BigInt(r.chainId)],
    ),
  );
}

/** On-chain + crypto verdicts injected by the consumer (viem-backed). All fail-closed. */
export interface OnChainChecks {
  /** DelegationManager.isRevoked(hashDelegation(d)) — MUST throw or return true to deny. */
  isRevoked(delegation: Delegation): Promise<boolean>;
  /** ERC-1271: the delegator SA signed this delegation. */
  verifyDelegationSignature(delegation: Delegation): Promise<boolean>;
  /** ERC-1271: the sender SA signed `hashA2aMessage(message)`. */
  verifyMessageSignature(message: A2aMessage, digest: Hex): Promise<boolean>;
  /** AUDIT NEW-A2A-2 — ERC-1271: `caller` SA signed `hashA2aTaskRequest(...)`. Proves the read/control
   *  caller controls the address it claims, so `caller` can no longer be spoofed. Fail-closed (throw/false). */
  verifyCallerSignature(caller: Address, digest: Hex, signature: Hex): Promise<boolean>;
}

/** Single-use reservation seam (the TaskStore provides this; FR-4.3). */
export interface MessageIdReserver {
  reserveMessageId(messageId: Hex, ttlSec: number): Promise<boolean>;
}

export type AuthorizeResult =
  | { ok: true; principal: Address }
  | { ok: false; reason: string };

const eq = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const findCaveat = (caveats: readonly Caveat[], enforcer: Address): Caveat | undefined =>
  caveats.find((c) => eq(c.enforcer, enforcer));

/**
 * Authorize an inbound A2A message. Returns the principal (delegation.delegator) the sender acts for, or
 * a rejection reason. Fail-closed throughout; no task is created on `ok: false`. The message-id is
 * reserved LAST so a rejected message never burns a nonce, while a replay of a valid message hits the
 * already-reserved id.
 */
export async function authorizeA2aMessage(args: {
  delegation: Delegation;
  requester: Address;
  message: A2aMessage;
  /** This receiving agent's SA — the grant's allowedTargets MUST name it. */
  thisAgentSA: Address;
  /** The requested skill — the grant's allowedMethods MUST name its selector (or `*`). */
  skill: string;
  enforcers: A2aEnforcers;
  checks: OnChainChecks;
  store: MessageIdReserver;
  now: number;
  /** Message-id reservation TTL (seconds). Default 600. */
  replayTtlSec?: number;
}): Promise<AuthorizeResult> {
  const { delegation: d, message, enforcers, checks } = args;

  // FR-4.1 — the delegate IS the requester.
  if (!eq(d.delegate, args.requester)) return { ok: false, reason: 'delegate != requester' };
  if (!eq(message.sender, args.requester)) return { ok: false, reason: 'message sender != requester' };

  // FR-4.1 — timestamp window (off-chain decode; the enforcer would check the same on-chain).
  const tsCav = findCaveat(d.caveats, enforcers.timestamp);
  if (!tsCav) return { ok: false, reason: 'missing timestamp caveat' };
  let win: { validAfter: bigint; validUntil: bigint };
  try { win = decodeTimestampTerms(tsCav.terms); } catch { return { ok: false, reason: 'bad timestamp terms' }; }
  const nowSec = BigInt(Math.floor(args.now / 1000));
  if (nowSec < win.validAfter || nowSec >= win.validUntil) return { ok: false, reason: 'grant outside timestamp window' };

  // FR-4.2 — recipient scoping: allowedTargets MUST include this agent.
  const atCav = findCaveat(d.caveats, enforcers.allowedTargets);
  if (!atCav) return { ok: false, reason: 'missing allowedTargets caveat (FR-4.2)' };
  let targets: readonly Address[];
  try { targets = decodeAllowedTargetsTerms(atCav.terms); } catch { return { ok: false, reason: 'bad allowedTargets terms' }; }
  if (!targets.some((t) => eq(t, args.thisAgentSA))) return { ok: false, reason: 'grant not scoped to this agent (allowedTargets)' };

  // FR-4.2 — skill scoping: allowedMethods MUST include the skill selector (or the any-sentinel).
  const amCav = findCaveat(d.caveats, enforcers.allowedMethods);
  if (!amCav) return { ok: false, reason: 'missing allowedMethods caveat (FR-4.2)' };
  let selectors: readonly Hex[];
  try { selectors = decodeAllowedMethodsTerms(amCav.terms); } catch { return { ok: false, reason: 'bad allowedMethods terms' }; }
  const want = skillSelector(args.skill);
  if (!selectors.some((s) => eq(s, want) || eq(s, A2A_ANY_SKILL))) {
    return { ok: false, reason: 'grant not scoped to this skill (allowedMethods)' };
  }

  // FR-4.1 — on-chain isRevoked, fail-closed (any error denies).
  try {
    if (await checks.isRevoked(d)) return { ok: false, reason: 'delegation revoked' };
  } catch (e) {
    return { ok: false, reason: `revocation check unavailable: ${e instanceof Error ? e.message : e}` };
  }

  // FR-4.1 — ERC-1271 delegator signature.
  try {
    if (!(await checks.verifyDelegationSignature(d))) return { ok: false, reason: 'delegation signature invalid' };
  } catch (e) {
    return { ok: false, reason: `delegation signature check failed: ${e instanceof Error ? e.message : e}` };
  }

  // FR-4.4 — inbound message signed by the sender.
  try {
    if (!(await checks.verifyMessageSignature(message, hashA2aMessage(message)))) {
      return { ok: false, reason: 'message signature invalid' };
    }
  } catch (e) {
    return { ok: false, reason: `message signature check failed: ${e instanceof Error ? e.message : e}` };
  }

  // FR-4.3 — single-use message id (reserve last; a replay of a valid message hits the reserved id).
  if (!(await args.store.reserveMessageId(message.messageId, args.replayTtlSec ?? 600))) {
    return { ok: false, reason: 'message id already used (replay)' };
  }

  return { ok: true, principal: d.delegator };
}
