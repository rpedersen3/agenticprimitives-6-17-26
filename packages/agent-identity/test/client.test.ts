import { describe, expect, it } from 'vitest';
import { AgentIdentityClient } from '../src/client';

describe('AgentIdentityClient skeleton', () => {
  it('constructs with valid opts', () => {
    const c = new AgentIdentityClient({ rpcUrl: 'http://localhost:8545', chainId: 84532 });
    expect(c.opts.chainId).toBe(84532);
  });

  it('rejects construction without rpcUrl', () => {
    // @ts-expect-error — testing runtime guard
    expect(() => new AgentIdentityClient({ chainId: 1 })).toThrow();
  });

  it('rejects construction without chainId', () => {
    // @ts-expect-error — testing runtime guard
    expect(() => new AgentIdentityClient({ rpcUrl: 'http://x' })).toThrow();
  });

  it('reads throw I Phase 2', async () => {
    const c = new AgentIdentityClient({ rpcUrl: 'http://localhost:8545', chainId: 84532 });
    await expect(c.fetchProfile('0x0000000000000000000000000000000000000001')).rejects.toThrow(/I Phase 2/);
    await expect(c.verifyEndpoint('0x0000000000000000000000000000000000000001', 'https://x', ['dns-txt'])).rejects.toThrow(
      /I Phase 2/,
    );
  });

  it('writes throw I Phase 4', async () => {
    const c = new AgentIdentityClient({ rpcUrl: 'http://localhost:8545', chainId: 84532 });
    await expect(
      c.publishProfile({
        agent: '0x0000000000000000000000000000000000000001',
        profile: { type: 'person', displayName: 'A' },
      }),
    ).rejects.toThrow(/I Phase 4/);
  });
});
