// createDirectory — composes the ports into the query API (spec 223 §6/§7).
//
// Discipline (load-bearing):
//   - No fallback (ADR-0013): each query uses ONE mechanism; a null/empty result
//     is terminal — never an escalation to a second port.
//   - Authoritative-port designation (audit P2-4): for session-relevant queries
//     (credential / oidc) the IndexerPort only PROPOSES candidates; the
//     OnChainReadPort is authoritative — a candidate is only `onchain-confirmed`
//     if the credential is in the agent's CURRENT on-chain set. A credential
//     revoked on-chain (spec 221) is dropped, never riding a stale index edge
//     (audit P1-3).
//   - Not an authority (ADR-0015): the directory accelerates discovery; it never
//     grants anything. The broker re-reads on-chain for custody decisions.

import { buildEvent, nowIso, type AuditSink } from '@agenticprimitives/audit';
import { CLASS, PREDICATE } from '@agenticprimitives/ontology';
import type { CanonicalAgentId, CredentialPrincipal, Assurance } from '@agenticprimitives/types';
import {
  type DirectoryPorts,
  type DirectoryOpts,
  type IdentityDirectory,
  type Resolution,
  type AgentWithEvidence,
  type AgentView,
  type Evidence,
  type EvidenceLink,
  maxAssurance,
} from './types';

function samePrincipal(a: CredentialPrincipal, b: CredentialPrincipal): boolean {
  // Exact match on kind + id. Callers/adapters normalize the id (e.g. lowercase
  // eip155 addresses) before querying — the directory does not re-normalize.
  return a.kind === b.kind && a.id === b.id;
}

function oidcPrincipal(iss: string, sub: string): CredentialPrincipal {
  return { kind: 'oidc', id: `${iss}#${sub}`, assurance: 'asserted' };
}

export function createDirectory(ports: DirectoryPorts, opts: DirectoryOpts = {}): IdentityDirectory {
  const auditSink: AuditSink | undefined = opts.auditSink;

  async function emit(action: string, subjectId: string, predicate: string, resultCount: number): Promise<void> {
    if (!auditSink) return;
    try {
      await auditSink.write(
        buildEvent({
          action,
          outcome: 'success',
          actor: { type: 'system', id: 'identity-directory' },
          subject: { type: CLASS.Agent, id: subjectId },
          context: { predicate, resultCount },
        }),
      );
    } catch {
      /* audit is fail-soft; never block a read on the sink */
    }
  }

  /**
   * For each candidate link, CONFIRM the principal is in the agent's current
   * on-chain credential set. Confirmed → `onchain-confirmed` (with both the
   * indexer evidence and the on-chain confirmation evidence). Unconfirmed
   * (revoked / stale / never-real) → dropped.
   */
  async function confirmCandidates(links: EvidenceLink[], principal: CredentialPrincipal): Promise<AgentWithEvidence[]> {
    const out: AgentWithEvidence[] = [];
    for (const link of links) {
      const current = await ports.onChain.credentialsOf(link.agent);
      if (!current.some((c) => samePrincipal(c.principal, principal))) continue; // not currently a custodian → drop
      const evidence: Evidence[] = [
        {
          source: 'indexer',
          assurance: link.assurance,
          observedAt: link.observedAt ?? nowIso(),
          ref: link.ref,
          blockNumber: link.blockNumber,
        },
        {
          source: 'onchain',
          assurance: 'onchain-confirmed',
          observedAt: nowIso(),
          ref: `credentialsOf:${link.agent}`,
        },
      ];
      out.push({ id: link.agent, evidence, assurance: maxAssurance(evidence.map((e) => e.assurance)) });
    }
    return out;
  }

  return {
    async resolveByName(name: string): Promise<Resolution> {
      const id = await ports.naming.forward(name);
      // null is THE answer (no such name) — never escalate to another port (ADR-0013).
      if (!id) {
        await emit('identity-directory.resolveByName', name, PREDICATE.resolvesTo, 0);
        return { agents: [] };
      }
      const evidence: Evidence[] = [
        { source: 'naming', assurance: 'onchain-read', observedAt: nowIso(), ref: name },
      ];
      await emit('identity-directory.resolveByName', name, PREDICATE.resolvesTo, 1);
      return { agents: [{ id, evidence, assurance: 'onchain-read' }] };
    },

    async resolveByCredential(principal: CredentialPrincipal): Promise<Resolution> {
      const links = await ports.indexer.agentsByCredential(principal);
      const agents = await confirmCandidates(links, principal);
      await emit('identity-directory.resolveByCredential', `${principal.kind}:${principal.id}`, PREDICATE.controls, agents.length);
      return { agents };
    },

    async resolveByOidcSubject(iss: string, sub: string): Promise<Resolution> {
      const links = await ports.indexer.agentsByOidcSubject(iss, sub);
      const agents = await confirmCandidates(links, oidcPrincipal(iss, sub));
      await emit('identity-directory.resolveByOidcSubject', `${iss}#${sub}`, PREDICATE.controls, agents.length);
      return { agents };
    },

    async agent(id: CanonicalAgentId): Promise<AgentView | null> {
      const record = await ports.onChain.resolveAgent(id);
      if (!record) return null;
      // Composition (NOT fallback): credentials + name are different facets of
      // the SAME agent, each from its declared port.
      const credentials = await ports.onChain.credentialsOf(id);
      const name = await ports.naming.reverse(id);
      const evidence: Evidence[] = [
        { source: 'onchain', assurance: 'onchain-read', observedAt: nowIso(), ref: `resolveAgent:${id}` },
      ];
      if (name) evidence.push({ source: 'naming', assurance: 'onchain-read', observedAt: nowIso(), ref: name });
      return { id, facets: { credentials, name: name ?? undefined }, evidence };
    },
  };
}

// re-export the assurance type for convenience at the value site
export type { Assurance };
