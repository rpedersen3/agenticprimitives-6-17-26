// Domain model + ports for the identity directory (spec 223).
//
// The directory is a READ MODEL keyed on CanonicalAgentId. Every association it
// returns carries Evidence (provenance + assurance). It is NOT an authority
// (ADR-0015), uses no eth_getLogs (ADR-0012), and never falls back between
// mechanisms (ADR-0013).

import type { CanonicalAgentId, Assurance, CredentialPrincipal } from '@agenticprimitives/types';

export type { CanonicalAgentId, Assurance, CredentialPrincipal };

/** Which source asserted an association. */
export type EvidenceSource = 'naming' | 'onchain' | 'indexer';

/**
 * Provenance for an asserted association (spec 223 §4). `blockNumber` is present
 * and load-bearing for `onchain-read` evidence so a consumer can enforce a
 * max-staleness bound (audit P1-3) — a credential revoked on-chain must not ride
 * a stale read.
 */
export interface Evidence {
  source: EvidenceSource;
  observedAt: string; // ISO 8601
  assurance: Assurance;
  /** Opaque source reference (name, tx, index key, "credentialsOf:<id>", …). */
  ref: string;
  /** Required for `onchain-read`/`onchain-confirmed`; the block the read reflects. */
  blockNumber?: bigint;
}

/** Minimal on-chain agent record (adapters fill what they read). */
export interface AgentRecord {
  id: CanonicalAgentId;
}

/** A credential facet currently recorded for an agent (from OnChainReadPort). */
export interface CredentialFacet {
  principal: CredentialPrincipal;
}

/** An agent in a Resolution, with its provenance + the effective assurance. */
export interface AgentWithEvidence {
  id: CanonicalAgentId;
  evidence: Evidence[];
  /** Highest assurance across `evidence`. */
  assurance: Assurance;
}

/** The result of a resolution query. Convergence cardinality is `agents.length`. */
export interface Resolution {
  agents: AgentWithEvidence[];
}

/** A full view of one agent's facets + provenance (from `agent(id)`). */
export interface AgentView {
  id: CanonicalAgentId;
  facets: {
    credentials: CredentialFacet[];
    name?: string;
  };
  evidence: Evidence[];
}

/**
 * A candidate link from a (non-authoritative) IndexerPort. The directory
 * CONFIRMS it against the authoritative on-chain read before treating it as
 * `onchain-confirmed` (audit P2-4 / P1-3).
 */
export interface EvidenceLink {
  agent: CanonicalAgentId;
  assurance: Assurance;
  ref: string;
  observedAt?: string;
  blockNumber?: bigint;
}

// ─── Ports (declared by core; implemented in identity-directory-adapters) ──
//
// NOTE: OIDC *verification* (id_token) is NOT a directory port — it lives in
// @agenticprimitives/connect-auth (ADR-0017). The broker verifies the claim and
// calls resolveByOidcSubject(iss, sub) with the already-verified subject. The
// directory only resolves; it does not authenticate credentials.

/** Authoritative on-chain reads. `readContract` only — NEVER `eth_getLogs`. */
export interface OnChainReadPort {
  resolveAgent(id: CanonicalAgentId): Promise<AgentRecord | null>;
  /** The agent's CURRENT credential facet set (the authority for confirmation). */
  credentialsOf(id: CanonicalAgentId): Promise<CredentialFacet[]>;
}

/** Wraps `agent-naming`. The adapter lifts `Address → CanonicalAgentId` by binding a chainId. */
export interface NamingPort {
  forward(name: string): Promise<CanonicalAgentId | null>;
  reverse(id: CanonicalAgentId): Promise<string | null>;
}

/** The home for "indexed registry" reads (HCS-2 *indexed* → here, never a log walk). */
export interface IndexerPort {
  agentsByCredential(principal: CredentialPrincipal): Promise<EvidenceLink[]>;
  agentsByOidcSubject(iss: string, sub: string): Promise<EvidenceLink[]>;
}

export interface DirectoryPorts {
  naming: NamingPort;
  onChain: OnChainReadPort;
  indexer: IndexerPort;
}

import type { AuditSink } from '@agenticprimitives/audit';

export interface DirectoryOpts {
  /** Injectable clock (ms). Defaults to Date.now. */
  now?: () => number;
  /** Optional sink — a `identity-directory.resolve` event is emitted per query. */
  auditSink?: AuditSink;
}

/** The directory query API (spec 223 §6). */
export interface IdentityDirectory {
  resolveByName(name: string): Promise<Resolution>;
  /** Session-relevant: indexer proposes, on-chain CONFIRMS (audit P2-4/P1-3). */
  resolveByCredential(principal: CredentialPrincipal): Promise<Resolution>;
  resolveByOidcSubject(iss: string, sub: string): Promise<Resolution>;
  agent(id: CanonicalAgentId): Promise<AgentView | null>;
}

// ─── Assurance ordering ───────────────────────────────────────────────

/** Ordered low→high. Consumers (e.g. the broker session-issuance floor) compare on this. */
export const ASSURANCE_ORDER: readonly Assurance[] = [
  'unverified',
  'asserted',
  'onchain-read',
  'onchain-confirmed',
] as const;

/** Negative / 0 / positive like a comparator. */
export function compareAssurance(a: Assurance, b: Assurance): number {
  return ASSURANCE_ORDER.indexOf(a) - ASSURANCE_ORDER.indexOf(b);
}

/** The highest assurance across a non-empty list (defaults to 'unverified' if empty). */
export function maxAssurance(values: Assurance[]): Assurance {
  let best: Assurance = 'unverified';
  for (const v of values) if (compareAssurance(v, best) > 0) best = v;
  return best;
}
