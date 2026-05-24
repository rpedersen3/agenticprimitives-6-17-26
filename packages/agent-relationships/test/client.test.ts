import { describe, expect, it } from 'vitest';
import { AgentRelationshipsClient } from '../src/client';
import { RELATIONSHIP_TYPE } from '../src/constants';

const A = '0x1111111111111111111111111111111111111111' as const;
const B = '0x2222222222222222222222222222222222222222' as const;
const ZERO_ID = '0x0000000000000000000000000000000000000000000000000000000000000001' as const;
const REL = '0x35084a3D655240760BD3C0B24Fb8ca9776cf374E' as const;

describe('AgentRelationshipsClient constructor', () => {
  it('constructs with valid opts', () => {
    const c = new AgentRelationshipsClient({ rpcUrl: 'http://localhost:8545', chainId: 84532, relationships: REL });
    expect(c.opts.chainId).toBe(84532);
  });

  it('rejects construction without rpcUrl', () => {
    // @ts-expect-error — testing runtime guard
    expect(() => new AgentRelationshipsClient({ chainId: 1, relationships: REL })).toThrow(/rpcUrl/);
  });

  it('rejects construction without relationships address', () => {
    // @ts-expect-error — testing runtime guard
    expect(() => new AgentRelationshipsClient({ rpcUrl: 'http://x', chainId: 1 })).toThrow(/relationships/);
  });

  it('writes throw when called without a WriteContext (walletClient required)', async () => {
    const c = new AgentRelationshipsClient({ rpcUrl: 'http://localhost:8545', chainId: 84532, relationships: REL });
    // @ts-expect-error — second arg required at runtime
    await expect(c.proposeEdge({ subject: A, object: B, relationshipType: RELATIONSHIP_TYPE.HAS_MEMBER as never })).rejects.toThrow();
    // @ts-expect-error — second arg required at runtime
    await expect(c.confirmEdge({ edgeId: ZERO_ID })).rejects.toThrow();
    // @ts-expect-error — second arg required at runtime
    await expect(c.revokeEdge({ edgeId: ZERO_ID })).rejects.toThrow();
    // @ts-expect-error — second arg required at runtime
    await expect(c.setRoles({ edgeId: ZERO_ID })).rejects.toThrow();
  });
});
