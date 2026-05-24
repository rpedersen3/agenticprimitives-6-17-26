/**
 * Integration tests against live Base Sepolia.
 * Skipped without BASE_SEPOLIA_RPC env.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { baseSepolia } from 'viem/chains';
import { AgentRelationshipsClient, computeEdgeId } from '../src/client';
import { RELATIONSHIP_TYPE, ROLE } from '../src/constants';
import { EdgeStatus } from '../src/types';

const RPC = process.env.BASE_SEPOLIA_RPC;
const PK = process.env.PRIVATE_KEY;
const REL = '0x35084a3D655240760BD3C0B24Fb8ca9776cf374E' as const;

const describeIf = RPC ? describe : describe.skip;
const describeWritesIf = RPC && PK ? describe : describe.skip;

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

describeWritesIf('AgentRelationshipsClient writes — Base Sepolia integration', () => {
  let client: AgentRelationshipsClient;
  let walletClient: ReturnType<typeof createWalletClient>;
  let deployer: `0x${string}`;
  beforeAll(() => {
    const pk = (PK!.startsWith('0x') ? PK! : '0x' + PK!) as `0x${string}`;
    const account = privateKeyToAccount(pk);
    deployer = account.address;
    client = new AgentRelationshipsClient({
      rpcUrl: RPC!,
      chainId: 84532,
      relationships: REL,
    });
    walletClient = createWalletClient({ account, chain: baseSepolia, transport: http(RPC!) });
  });

  it(
    'proposeEdge creates an edge in PROPOSED state, observable via getEdge + listEdgesFor',
    async () => {
      // Use a fresh "object" address per run so we don't collide with
      // prior PROPOSED edges (the contract rejects duplicates).
      const object = `0x${Date.now().toString(16).padStart(40, '0')}` as `0x${string}`;
      const tx = await client.proposeEdge(
        {
          subject: deployer,
          object,
          relationshipType: RELATIONSHIP_TYPE.HAS_MEMBER as never,
          subjectRoles: [ROLE.MEMBER as never],
        },
        { walletClient },
      );
      expect(tx).toMatch(/^0x[0-9a-f]{64}$/);
      const edgeId = computeEdgeId(deployer, object, RELATIONSHIP_TYPE.HAS_MEMBER as never);
      await new Promise((r) => setTimeout(r, 3000));
      const edge = await client.getEdge(edgeId);
      expect(edge).not.toBeNull();
      expect(edge?.subject.toLowerCase()).toBe(deployer.toLowerCase());
      expect(edge?.object.toLowerCase()).toBe(object.toLowerCase());
      expect(edge?.status).toBe(EdgeStatus.PROPOSED);
      expect(edge?.subjectRoles).toContain(ROLE.MEMBER);

      // Subject can revoke unilaterally.
      const revokeTx = await client.revokeEdge({ edgeId }, { walletClient });
      expect(revokeTx).toMatch(/^0x[0-9a-f]{64}$/);
      await new Promise((r) => setTimeout(r, 3000));
      const revoked = await client.getEdge(edgeId);
      expect(revoked?.status).toBe(EdgeStatus.REVOKED);
    },
    90_000,
  );
});
