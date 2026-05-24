import { describe, expect, it } from 'vitest';
import { AgentIdentityClient } from '../src/client';

const RESOLVER = '0x189D7c19f5B611CD85e2Ef748d1FA546F3402275' as const;

describe('AgentIdentityClient constructor', () => {
  it('constructs with valid opts', () => {
    const c = new AgentIdentityClient({ rpcUrl: 'http://localhost:8545', chainId: 84532, profileResolver: RESOLVER });
    expect(c.opts.chainId).toBe(84532);
  });

  it('rejects construction without rpcUrl', () => {
    // @ts-expect-error — testing runtime guard
    expect(() => new AgentIdentityClient({ chainId: 1, profileResolver: RESOLVER })).toThrow(/rpcUrl/);
  });

  it('rejects construction without chainId', () => {
    // @ts-expect-error — testing runtime guard
    expect(() => new AgentIdentityClient({ rpcUrl: 'http://x', profileResolver: RESOLVER })).toThrow(/chainId/);
  });

  it('rejects construction without profileResolver address', () => {
    // @ts-expect-error — testing runtime guard
    expect(() => new AgentIdentityClient({ rpcUrl: 'http://x', chainId: 1 })).toThrow(/profileResolver/);
  });

  it('verifyEndpoint defers to I Phase 2.5 (separate ship)', async () => {
    const c = new AgentIdentityClient({ rpcUrl: 'http://localhost:8545', chainId: 84532, profileResolver: RESOLVER });
    await expect(c.verifyEndpoint('0x0000000000000000000000000000000000000001', 'https://x', ['dns-txt'])).rejects.toThrow(
      /I Phase 2\.5/,
    );
  });

  it('publishProfile throws I Phase 4', async () => {
    const c = new AgentIdentityClient({ rpcUrl: 'http://localhost:8545', chainId: 84532, profileResolver: RESOLVER });
    await expect(
      c.publishProfile({
        agent: '0x0000000000000000000000000000000000000001',
        profile: { type: 'person', displayName: 'A' },
      }),
    ).rejects.toThrow(/I Phase 4/);
  });
});
