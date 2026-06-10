import { describe, it, expect } from 'vitest';
import { resolveA2aTarget, fetchAgentCard } from '../src/index.js';

const ADDR = (h: string) => (`0x${h.repeat(40).slice(0, 40)}`) as `0x${string}`;

describe('resolveA2aTarget (§8 discovery)', () => {
  it('name → SA → endpoint + agent-card url (injected resolvers, no hardcoded domain)', async () => {
    const t = await resolveA2aTarget('bsb', {
      resolveName: async (n) => (n === 'bsb' ? ADDR('b') : null),
      endpointFor: (n) => `https://${n}.example.test/`, // trailing slash trimmed
    });
    expect(t).toEqual({
      name: 'bsb',
      agentSA: ADDR('b'),
      endpoint: 'https://bsb.example.test/api/a2a',
      agentCardUrl: 'https://bsb.example.test/.well-known/agent-card.json',
    });
  });

  it('null when the name has no Smart Account (empty is an answer)', async () => {
    expect(await resolveA2aTarget('nope', { resolveName: async () => null, endpointFor: (n) => `https://${n}.x` })).toBeNull();
  });
});

describe('fetchAgentCard', () => {
  it('parses the card on ok; null otherwise', async () => {
    const card = { name: '0xb', url: '/api/a2a', version: '0.1.0', capabilities: { streaming: true, pushNotifications: true, stateTransitionHistory: true }, skills: [{ id: 'echo' }] };
    expect(await fetchAgentCard('u', async () => ({ ok: true, json: async () => card }))).toEqual(card);
    expect(await fetchAgentCard('u', async () => ({ ok: false, json: async () => ({}) }))).toBeNull();
  });
});
