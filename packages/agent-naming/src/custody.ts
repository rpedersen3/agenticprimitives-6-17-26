/**
 * Subpath `@agenticprimitives/agent-naming/custody`.
 *
 * Pure encoded call builders for custody-policy-gated name-owner
 * rotation. Compose these into a CustodyPolicy schedule/apply
 * ceremony WITHOUT importing `@agenticprimitives/custody` (the
 * package boundary doctrine — spec 215 § 3).
 *
 * Each builder returns a `ContractCall` shape the caller can
 * encode into the CustodyPolicy's `ApplySystemUpdate` (or a future
 * name-management custody action). The caller is responsible for
 * the schedule/apply ceremony itself.
 *
 * Phase 1: signature shape only. Real call encoders land in Phase 4
 * alongside the contract write methods.
 */

import type { Address, Hex } from '@agenticprimitives/types';

/** Minimal call-shape used by callers to compose into a custody action. */
export interface ContractCall {
  to: Address;
  value: bigint;
  data: Hex;
}

/**
 * Build the call that rotates a name's owner Smart Agent.
 * Phase 1 throws; Phase 4 will encode AgentNameRegistry.setOwner(node, newOwner).
 */
export function buildRotateNameOwnerCall(_args: {
  registry: Address;
  node: Hex;
  newOwner: Address;
}): ContractCall {
  void _args;
  throw new Error('NS Phase 4 — wire to AgentNameRegistry.setOwner');
}

/**
 * Build the call that swaps the resolver contract for a name.
 * Phase 1 throws; Phase 4 will encode AgentNameRegistry.setResolver(node, newResolver).
 */
export function buildRotateNameResolverCall(_args: {
  registry: Address;
  node: Hex;
  newResolver: Address;
}): ContractCall {
  void _args;
  throw new Error('NS Phase 4 — wire to AgentNameRegistry.setResolver');
}
