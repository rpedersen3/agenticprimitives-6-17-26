// IndexerPort adapter — in-memory (demo + tests).
//
// The production IndexerPort is a SPARQL/GraphDB-backed adapter (spec 225 §7);
// this is the "indexed registry" without a backend yet. It is NON-AUTHORITATIVE:
// it only PROPOSES candidate agents — the directory confirms them against the
// authoritative on-chain read before treating them as onchain-confirmed
// (spec 223 §7). So a stale/poisoned entry here can never, by itself, authorize.

import type { CanonicalAgentId, CredentialPrincipal, Assurance } from '@agenticprimitives/types';
import type { IndexerPort, EvidenceLink } from '@agenticprimitives/identity-directory';

/** A credential/oidc → agent edge with provenance. For OIDC, `principalId` is `${iss}#${sub}`. */
export interface IndexerEntry {
  agent: CanonicalAgentId;
  principalKind: CredentialPrincipal['kind'];
  principalId: string;
  assurance?: Assurance;
  ref?: string;
  blockNumber?: bigint;
}

/** An in-memory IndexerPort, seedable + appendable. */
export function createInMemoryIndexer(
  entries: IndexerEntry[] = [],
): IndexerPort & { add(entry: IndexerEntry): void } {
  const store: IndexerEntry[] = [...entries];

  function linksFor(kind: CredentialPrincipal['kind'], id: string): EvidenceLink[] {
    return store
      .filter((e) => e.principalKind === kind && e.principalId === id)
      .map((e) => ({
        agent: e.agent,
        assurance: e.assurance ?? 'asserted',
        ref: e.ref ?? 'in-memory',
        blockNumber: e.blockNumber,
      }));
  }

  return {
    async agentsByCredential(principal) {
      return linksFor(principal.kind, principal.id);
    },
    async agentsByOidcSubject(iss, sub) {
      return linksFor('oidc', `${iss}#${sub}`);
    },
    add(entry) {
      store.push(entry);
    },
  };
}
