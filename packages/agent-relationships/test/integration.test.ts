/**
 * Integration tests against live Base Sepolia.
 * Skipped without BASE_SEPOLIA_RPC env.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { AgentRelationshipsClient } from '../src/client';

const RPC = process.env.BASE_SEPOLIA_RPC;
const REL = '0x35084a3D655240760BD3C0B24Fb8ca9776cf374E' as const;

const describeIf = RPC ? describe : describe.skip;

describeIf('AgentRelationshipsClient — Base Sepolia integration', () => {
  let client: AgentRelationshipsClient;
  beforeAll(() => {
    client = new AgentRelationshipsClient({
      rpcUrl: RPC!,
      chainId: 84532,
      relationships: REL,
    });
  });

  it('getEdge returns null for non-existent edgeId', async () => {
    const edgeId = '0x0000000000000000000000000000000000000000000000000000000000000099' as const;
    expect(await client.getEdge(edgeId)).toBeNull();
  });

  it('listEdgesFor returns [] for an address with no edges', async () => {
    expect(await client.listEdgesFor('0x0000000000000000000000000000000000000099')).toEqual([]);
  });

  it('listEdgesPointingAt returns [] for an address with no inbound edges', async () => {
    expect(await client.listEdgesPointingAt('0x0000000000000000000000000000000000000099')).toEqual([]);
  });
});
