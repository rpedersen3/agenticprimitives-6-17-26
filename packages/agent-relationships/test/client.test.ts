import { describe, expect, it } from 'vitest';
import { AgentRelationshipsClient } from '../src/client';
import { RELATIONSHIP_TYPE } from '../src/constants';

const A = '0x1111111111111111111111111111111111111111' as const;
const B = '0x2222222222222222222222222222222222222222' as const;
const ZERO_ID = '0x0000000000000000000000000000000000000000000000000000000000000001' as const;

describe('AgentRelationshipsClient skeleton', () => {
  it('constructs with valid opts', () => {
    const c = new AgentRelationshipsClient({ rpcUrl: 'http://localhost:8545', chainId: 84532 });
    expect(c.opts.chainId).toBe(84532);
  });

  it('rejects construction without rpcUrl', () => {
    // @ts-expect-error — testing runtime guard
    expect(() => new AgentRelationshipsClient({ chainId: 1 })).toThrow();
  });

  it('reads throw R Phase 2', async () => {
    const c = new AgentRelationshipsClient({ rpcUrl: 'http://localhost:8545', chainId: 84532 });
    await expect(c.getEdge(ZERO_ID)).rejects.toThrow(/R Phase 2/);
    await expect(c.listEdgesFor(A)).rejects.toThrow(/R Phase 2/);
  });

  it('writes throw R Phase 4', async () => {
    const c = new AgentRelationshipsClient({ rpcUrl: 'http://localhost:8545', chainId: 84532 });
    await expect(
      c.proposeEdge({ subject: A, object: B, relationshipType: RELATIONSHIP_TYPE.HAS_MEMBER as never }),
    ).rejects.toThrow(/R Phase 4/);
    await expect(c.confirmEdge({ edgeId: ZERO_ID })).rejects.toThrow(/R Phase 4/);
    await expect(c.revokeEdge({ edgeId: ZERO_ID })).rejects.toThrow(/R Phase 4/);
    await expect(c.setRoles({ edgeId: ZERO_ID })).rejects.toThrow(/R Phase 4/);
  });
});
