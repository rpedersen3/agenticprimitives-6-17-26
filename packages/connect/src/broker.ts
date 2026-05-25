// Broker convergence + session issuance (spec 224 §5/§8).
//
// Ties identity-directory resolution to AgentSession issuance, enforcing:
//   - Convergence cardinality: 0 → bootstrap, 1 → issue, many → disambiguate.
//   - Session-issuance assurance FLOOR (CN-6): an existing-agent session needs
//     `onchain-confirmed` (which the directory only assigns after an on-chain
//     membership confirm — so a revoked credential never reaches issuance).
//   - Non-EVM control-status GATE (CN-8): a non-`eip155` subject is identifier-
//     only — read/identifier-grade at most, never a control session.
//   - Disambiguation server-binding (CN-5): the chosen sub MUST be in the
//     resolution set returned by convergence.
//   - Step-up classification (CN-2 / §8): custody-class actions need a
//     custody-grade credential; a login-grade session authorizes no on-chain write.

import { compareAssurance, type Resolution, type IdentityDirectory } from '@agenticprimitives/identity-directory';
import type { CanonicalAgentId, CredentialPrincipal, Assurance } from '@agenticprimitives/types';
import { mintAgentSession, type BrokerSigner } from './token';

export type { IdentityDirectory };

/** The convergence cardinality the broker branches on (spec 224 §5). */
export type Convergence =
  | { kind: 'none' }
  | { kind: 'one'; agent: CanonicalAgentId; assurance: Assurance }
  | { kind: 'many'; agents: Array<{ id: CanonicalAgentId; assurance: Assurance }> };

export function convergence(resolution: Resolution): Convergence {
  const agents = resolution.agents;
  if (agents.length === 0) return { kind: 'none' };
  if (agents.length === 1) return { kind: 'one', agent: agents[0]!.id, assurance: agents[0]!.assurance };
  return { kind: 'many', agents: agents.map((a) => ({ id: a.id, assurance: a.assurance })) };
}

/** Only `eip155` subjects are custodied by this stack (CN-8; spec 226 §4). */
export function isCustodiedNamespace(id: CanonicalAgentId): boolean {
  return id.startsWith('eip155:');
}

/** A control session that authenticates an existing agent needs this floor (CN-6). */
export const SESSION_ISSUANCE_FLOOR: Assurance = 'onchain-confirmed';

export type IssueDecision = { ok: true } | { ok: false; reason: string };

/** Gate a would-be session issuance for one resolved agent. */
export function canIssueSession(
  agentId: CanonicalAgentId,
  assurance: Assurance,
  opts: { floor?: Assurance } = {},
): IssueDecision {
  if (!isCustodiedNamespace(agentId)) {
    return { ok: false, reason: 'non-EVM subject is identifier-only (read/identifier-grade only); cannot issue a control session (CN-8)' };
  }
  const floor = opts.floor ?? SESSION_ISSUANCE_FLOOR;
  if (compareAssurance(assurance, floor) < 0) {
    return { ok: false, reason: `assurance "${assurance}" is below the issuance floor "${floor}" (CN-6); step-up required` };
  }
  return { ok: true };
}

/**
 * Disambiguation server-binding (CN-5): the user's chosen subject MUST be a
 * member of the exact resolution set. Never trust a client-echoed `sub`.
 */
export function selectFromResolution(resolution: Resolution, chosenSub: string): CanonicalAgentId | null {
  const match = resolution.agents.find((a) => a.id === chosenSub);
  return match ? match.id : null;
}

/** Custody-class actions that require step-up (CN-2 / §8). */
export const CUSTODY_CLASS_ACTIONS = [
  'credential-change',
  'custody-policy-change',
  'high-value-spend',
  'delegation-issue',
] as const;
export type CustodyClassAction = (typeof CUSTODY_CLASS_ACTIONS)[number];

/** Does this action require step-up to a custody-grade credential? */
export function requiresStepUp(action: string): action is CustodyClassAction {
  return (CUSTODY_CLASS_ACTIONS as readonly string[]).includes(action);
}

export interface IssueForResolutionInput {
  resolution: Resolution;
  principal: CredentialPrincipal;
  signer: BrokerSigner;
  aud: string;
  iss: string;
  ttlSeconds: number;
  floor?: Assurance;
  now?: () => number;
}

export type IssueOutcome =
  | { status: 'issued'; token: string; sub: CanonicalAgentId; assurance: Assurance }
  | { status: 'bootstrap' }
  | { status: 'disambiguate'; agents: Array<{ id: CanonicalAgentId; assurance: Assurance }> }
  | { status: 'rejected'; reason: string };

/**
 * Drive convergence → outcome. The single-agent path enforces the non-EVM gate +
 * assurance floor before minting; 0 → bootstrap (the caller rate-limits, CN-11);
 * many → disambiguate (the caller then re-enters with a chosen sub validated via
 * selectFromResolution, CN-5).
 */
export async function issueForResolution(input: IssueForResolutionInput): Promise<IssueOutcome> {
  const c = convergence(input.resolution);
  if (c.kind === 'none') return { status: 'bootstrap' };
  if (c.kind === 'many') return { status: 'disambiguate', agents: c.agents };

  const decision = canIssueSession(c.agent, c.assurance, { floor: input.floor });
  if (!decision.ok) return { status: 'rejected', reason: decision.reason };

  const token = await mintAgentSession(
    {
      sub: c.agent,
      principal: input.principal,
      assurance: c.assurance,
      aud: input.aud,
      iss: input.iss,
      ttlSeconds: input.ttlSeconds,
      now: input.now,
    },
    input.signer,
  );
  return { status: 'issued', token, sub: c.agent, assurance: c.assurance };
}
