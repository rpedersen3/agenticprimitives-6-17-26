import { describe, it, expect, vi } from 'vitest';
import type { CanonicalAgentId, CredentialPrincipal } from '@agenticprimitives/types';
import {
  createDirectory,
  maxAssurance,
  compareAssurance,
  type DirectoryPorts,
  type CredentialFacet,
  type EvidenceLink,
} from '../../src/index.js';

const AGENT_A = 'eip155:8453:0x1111111111111111111111111111111111111111' as CanonicalAgentId;
const AGENT_B = 'eip155:8453:0x2222222222222222222222222222222222222222' as CanonicalAgentId;

const CRED: CredentialPrincipal = { kind: 'siwe-eoa', id: '0xeoa', assurance: 'asserted' };

function ports(over: Partial<DirectoryPorts> = {}): DirectoryPorts {
  return {
    naming: { forward: vi.fn(async () => null), reverse: vi.fn(async () => null), ...over.naming },
    onChain: {
      resolveAgent: vi.fn(async () => null),
      credentialsOf: vi.fn(async () => [] as CredentialFacet[]),
      ...over.onChain,
    },
    indexer: {
      agentsByCredential: vi.fn(async () => [] as EvidenceLink[]),
      agentsByOidcSubject: vi.fn(async () => [] as EvidenceLink[]),
      ...over.indexer,
    },
  };
}

describe('resolveByName', () => {
  it('returns one agent (onchain-read) when the name resolves', async () => {
    const dir = createDirectory(ports({ naming: { forward: async () => AGENT_A, reverse: async () => null } }));
    const r = await dir.resolveByName('alice.agent');
    expect(r.agents).toHaveLength(1);
    expect(r.agents[0]!.id).toBe(AGENT_A);
    expect(r.agents[0]!.assurance).toBe('onchain-read');
  });

  it('null forward is terminal — returns 0 agents and never touches other ports (ADR-0013)', async () => {
    const p = ports({
      onChain: {
        resolveAgent: vi.fn(async () => { throw new Error('must not be called'); }),
        credentialsOf: vi.fn(async () => { throw new Error('must not be called'); }),
      },
      indexer: {
        agentsByCredential: vi.fn(async () => { throw new Error('must not be called'); }),
        agentsByOidcSubject: vi.fn(async () => { throw new Error('must not be called'); }),
      },
    });
    const dir = createDirectory(p);
    const r = await dir.resolveByName('nope.agent');
    expect(r.agents).toHaveLength(0);
    expect(p.onChain.resolveAgent).not.toHaveBeenCalled();
    expect(p.indexer.agentsByCredential).not.toHaveBeenCalled();
  });
});

describe('resolveByCredential — indexer proposes, on-chain confirms', () => {
  it('confirms candidates whose credential is in the CURRENT on-chain set (onchain-confirmed)', async () => {
    const p = ports({
      indexer: {
        agentsByCredential: async () => [{ agent: AGENT_A, assurance: 'asserted', ref: 'idx:A' }],
        agentsByOidcSubject: async () => [],
      },
      onChain: {
        resolveAgent: async () => null,
        credentialsOf: async (id) => (id === AGENT_A ? [{ principal: CRED }] : []),
      },
    });
    const dir = createDirectory(p);
    const r = await dir.resolveByCredential(CRED);
    expect(r.agents).toHaveLength(1);
    expect(r.agents[0]!.id).toBe(AGENT_A);
    expect(r.agents[0]!.assurance).toBe('onchain-confirmed');
    // carries BOTH the indexer evidence and the on-chain confirmation
    expect(r.agents[0]!.evidence.map((e) => e.source).sort()).toEqual(['indexer', 'onchain']);
  });

  it('drops a candidate whose credential is NOT in the current set (revoked/stale — audit P1-3)', async () => {
    const p = ports({
      indexer: {
        agentsByCredential: async () => [
          { agent: AGENT_A, assurance: 'onchain-read', ref: 'idx:A' },
          { agent: AGENT_B, assurance: 'asserted', ref: 'idx:B' }, // stale edge
        ],
        agentsByOidcSubject: async () => [],
      },
      onChain: {
        resolveAgent: async () => null,
        // only AGENT_A still has the credential; AGENT_B revoked it
        credentialsOf: async (id) => (id === AGENT_A ? [{ principal: CRED }] : []),
      },
    });
    const dir = createDirectory(p);
    const r = await dir.resolveByCredential(CRED);
    expect(r.agents.map((a) => a.id)).toEqual([AGENT_A]);
  });

  it('no confirmation → empty (the authoritative result is terminal)', async () => {
    const p = ports({
      indexer: { agentsByCredential: async () => [{ agent: AGENT_A, assurance: 'asserted', ref: 'x' }], agentsByOidcSubject: async () => [] },
      onChain: { resolveAgent: async () => null, credentialsOf: async () => [] },
    });
    const dir = createDirectory(p);
    expect((await dir.resolveByCredential(CRED)).agents).toHaveLength(0);
  });
});

describe('resolveByOidcSubject', () => {
  it('confirms an OIDC facet (iss#sub) against the on-chain set', async () => {
    const oidc: CredentialPrincipal = { kind: 'oidc', id: 'https://accounts.google.com#42', assurance: 'asserted' };
    const p = ports({
      indexer: { agentsByCredential: async () => [], agentsByOidcSubject: async () => [{ agent: AGENT_A, assurance: 'asserted', ref: 'idx' }] },
      onChain: { resolveAgent: async () => null, credentialsOf: async () => [{ principal: oidc }] },
    });
    const dir = createDirectory(p);
    const r = await dir.resolveByOidcSubject('https://accounts.google.com', '42');
    expect(r.agents).toHaveLength(1);
    expect(r.agents[0]!.assurance).toBe('onchain-confirmed');
  });
});

describe('agent(id)', () => {
  it('returns null when the agent is not on chain', async () => {
    const dir = createDirectory(ports());
    expect(await dir.agent(AGENT_A)).toBeNull();
  });

  it('composes credentials + reverse name into a view', async () => {
    const p = ports({
      onChain: { resolveAgent: async () => ({ id: AGENT_A }), credentialsOf: async () => [{ principal: CRED }] },
      naming: { forward: async () => null, reverse: async () => 'alice.agent' },
    });
    const dir = createDirectory(p);
    const view = await dir.agent(AGENT_A);
    expect(view?.facets.name).toBe('alice.agent');
    expect(view?.facets.credentials).toHaveLength(1);
  });
});

describe('assurance helpers', () => {
  it('orders correctly', () => {
    expect(compareAssurance('asserted', 'onchain-confirmed')).toBeLessThan(0);
    expect(maxAssurance(['unverified', 'onchain-read', 'asserted'])).toBe('onchain-read');
    expect(maxAssurance([])).toBe('unverified');
  });
});
