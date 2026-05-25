// NamingPort adapter — wraps agent-naming's read client.
//
// This is the eip155 Address ↔ CanonicalAgentId lift (audit P1-2): the shipped
// agent-naming client is chain-UNqualified (resolveName → Address), so the
// adapter binds a configured chainId to lift the result. A `null` from the
// client is a terminal "no such name" (ADR-0013) — the directory core does not
// escalate to another port.

import type { Address } from '@agenticprimitives/types';
import type { NamingPort } from '@agenticprimitives/identity-directory';
import type { AgentNamingClient } from '@agenticprimitives/agent-naming';
import { toCanonicalAgentId, addressOf } from './caip10';

/** The subset of `AgentNamingClient` the NamingPort needs (also satisfied by a test double). */
export type NamingReads = Pick<AgentNamingClient, 'resolveName' | 'reverseResolve'>;

export interface MakeNamingPortOpts {
  client: NamingReads;
  /** The chainId the naming registry lives on — binds `Address → CanonicalAgentId`. */
  chainId: number;
}

export function makeNamingPort(opts: MakeNamingPortOpts): NamingPort {
  return {
    async forward(name) {
      const addr = await opts.client.resolveName(name);
      return addr ? toCanonicalAgentId(opts.chainId, addr) : null;
    },
    async reverse(id) {
      // Only eip155 ids round-trip through EVM naming; a non-eip155 id has no
      // reverse here (returns null rather than throwing into the read path).
      let address: Address;
      try {
        address = addressOf(id);
      } catch {
        return null;
      }
      return opts.client.reverseResolve(address);
    },
  };
}
