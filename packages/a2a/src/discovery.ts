// Agent discovery (spec 269 §8) — resolve a target agent (name → SA → endpoint) + fetch its agent-card.
// Transport- AND domain-agnostic: the name→SA resolver and the name→endpoint builder are INJECTED, so the
// package never hardcodes a naming client or a hostname (ADR-0021). Only the protocol paths
// (`/api/a2a`, `/.well-known/agent-card.json`) are the package's to own.
import type { Address } from '@agenticprimitives/types';
import type { AgentCard } from './agent.js';

/** Injected name→SA resolver (e.g. agent-naming's `AgentNamingClient.resolveName`). */
export type ResolveAgentName = (name: string) => Promise<Address | null>;

/** Injected endpoint builder — maps an agent name to its A2A base URL (the app owns the hostname pattern,
 *  e.g. `https://<name>.<tld>`; the package appends the protocol paths). */
export type AgentEndpointFor = (name: string) => string;

export interface A2aTarget {
  name: string;
  agentSA: Address;
  /** The agent's A2A JSON-RPC endpoint (`…/api/a2a`). */
  endpoint: string;
  /** The agent-card discovery URL (`…/.well-known/agent-card.json`). */
  agentCardUrl: string;
}

/** Minimal fetch seam (browser/worker `fetch`-shaped) so the package pulls no global. */
export type A2aFetch = (url: string) => Promise<{ ok: boolean; json: () => Promise<unknown> }>;

/** Resolve a target agent: name → SA (injected resolver) → endpoint (injected builder). Returns `null`
 *  when the name has no Smart Account (empty is an answer — ADR-0013). */
export async function resolveA2aTarget(
  name: string,
  deps: { resolveName: ResolveAgentName; endpointFor: AgentEndpointFor },
): Promise<A2aTarget | null> {
  const agentSA = await deps.resolveName(name);
  if (!agentSA) return null;
  const base = deps.endpointFor(name).replace(/\/+$/, '');
  return {
    name,
    agentSA,
    endpoint: `${base}/api/a2a`,
    agentCardUrl: `${base}/.well-known/agent-card.json`,
  };
}

/** Fetch + parse a target's agent-card (skills + capabilities). `fetchFn` is injected. `null` if absent. */
export async function fetchAgentCard(agentCardUrl: string, fetchFn: A2aFetch): Promise<AgentCard | null> {
  const r = await fetchFn(agentCardUrl);
  if (!r.ok) return null;
  return (await r.json()) as AgentCard;
}
