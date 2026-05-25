import { describe, it, expect } from 'vitest';
import type { Address, CanonicalAgentId, CredentialPrincipal } from '@agenticprimitives/types';
import { createDirectory } from '@agenticprimitives/identity-directory';
import {
  toCanonicalAgentId,
  addressOf,
  makeNamingPort,
  makeOnChainReadPort,
  viemExists,
  createInMemoryIndexer,
  type NamingReads,
} from '../../src/index.js';

const CHAIN = 8453;
const ADDR_A = '0x1111111111111111111111111111111111111111' as Address;
const ID_A = toCanonicalAgentId(CHAIN, ADDR_A);

describe('caip10 glue', () => {
  it('round-trips eip155 (lowercased)', () => {
    expect(ID_A).toBe(`eip155:8453:${ADDR_A.toLowerCase()}`);
    expect(addressOf(ID_A)).toBe(ADDR_A.toLowerCase());
  });
  it('lowercases a mixed-case address', () => {
    expect(toCanonicalAgentId(1, '0xAbC0000000000000000000000000000000000001' as Address)).toBe(
      'eip155:1:0xabc0000000000000000000000000000000000001',
    );
  });
  it('addressOf rejects a non-eip155 id', () => {
    expect(() => addressOf('hedera:mainnet:0.0.1' as CanonicalAgentId)).toThrow();
  });
});

describe('makeNamingPort', () => {
  const client: NamingReads = {
    resolveName: async (name) => (name === 'alice.agent' ? ADDR_A : null),
    reverseResolve: async (addr) => (addr.toLowerCase() === ADDR_A.toLowerCase() ? 'alice.agent' : null),
  };
  const port = makeNamingPort({ client, chainId: CHAIN });

  it('forward lifts Address → CanonicalAgentId', async () => {
    expect(await port.forward('alice.agent')).toBe(ID_A);
  });
  it('forward null → null (terminal)', async () => {
    expect(await port.forward('nope.agent')).toBeNull();
  });
  it('reverse parses the address + returns the name', async () => {
    expect(await port.reverse(ID_A)).toBe('alice.agent');
  });
  it('reverse on a non-eip155 id → null (never throws into the read path)', async () => {
    expect(await port.reverse('solana:mainnet:abc' as CanonicalAgentId)).toBeNull();
  });
});

describe('createInMemoryIndexer', () => {
  const cred: CredentialPrincipal = { kind: 'siwe-eoa', id: '0xeoa', assurance: 'asserted' };
  it('returns seeded credential links', async () => {
    const idx = createInMemoryIndexer([{ agent: ID_A, principalKind: 'siwe-eoa', principalId: '0xeoa' }]);
    const links = await idx.agentsByCredential(cred);
    expect(links).toHaveLength(1);
    expect(links[0]!.agent).toBe(ID_A);
  });
  it('matches oidc by iss#sub', async () => {
    const idx = createInMemoryIndexer([{ agent: ID_A, principalKind: 'oidc', principalId: 'https://accounts.google.com#42' }]);
    expect(await idx.agentsByOidcSubject('https://accounts.google.com', '42')).toHaveLength(1);
  });
  it('add() appends an entry', async () => {
    const idx = createInMemoryIndexer();
    idx.add({ agent: ID_A, principalKind: 'siwe-eoa', principalId: '0xeoa' });
    expect(await idx.agentsByCredential(cred)).toHaveLength(1);
  });
});

describe('viemExists', () => {
  it('true when bytecode present', async () => {
    const fn = viemExists({ getCode: async () => '0x6001' } as never);
    expect(await fn(ID_A)).toBe(true);
  });
  it('false when no code (undefined / 0x)', async () => {
    expect(await viemExists({ getCode: async () => undefined } as never)(ID_A)).toBe(false);
    expect(await viemExists({ getCode: async () => '0x' } as never)(ID_A)).toBe(false);
  });
});

describe('end-to-end through createDirectory', () => {
  it('resolves a name and confirms a credential via the real adapters', async () => {
    const cred: CredentialPrincipal = { kind: 'siwe-eoa', id: addressOf(ID_A), assurance: 'asserted' };
    const naming = makeNamingPort({
      client: { resolveName: async (n) => (n === 'alice.agent' ? ADDR_A : null), reverseResolve: async () => 'alice.agent' },
      chainId: CHAIN,
    });
    const indexer = createInMemoryIndexer([{ agent: ID_A, principalKind: 'siwe-eoa', principalId: addressOf(ID_A) }]);
    const onChain = makeOnChainReadPort({
      exists: async () => true,
      confirmsCredential: async (id, p) => id === ID_A && p.id === addressOf(ID_A),
    });
    const dir = createDirectory({ naming, onChain, indexer });

    expect((await dir.resolveByName('alice.agent')).agents[0]!.id).toBe(ID_A);

    const r = await dir.resolveByCredential(cred);
    expect(r.agents).toHaveLength(1);
    expect(r.agents[0]!.assurance).toBe('onchain-confirmed');
  });
});
