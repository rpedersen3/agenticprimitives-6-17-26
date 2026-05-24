/**
 * Integration tests against live Base Sepolia.
 * Skipped without BASE_SEPOLIA_RPC env.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { baseSepolia } from 'viem/chains';
import { AgentIdentityClient } from '../src/client';
import { canonicalProfileJson } from '../src/profile';
import type { AgentCard } from '../src/types';

const RPC = process.env.BASE_SEPOLIA_RPC;
const PK = process.env.PRIVATE_KEY;
const PROF = '0x189D7c19f5B611CD85e2Ef748d1FA546F3402275' as const;

const describeIf = RPC ? describe : describe.skip;
const describeWritesIf = RPC && PK ? describe : describe.skip;

describeIf('AgentIdentityClient — Base Sepolia integration', () => {
  let client: AgentIdentityClient;
  beforeAll(() => {
    client = new AgentIdentityClient({
      rpcUrl: RPC!,
      chainId: 84532,
      profileResolver: PROF,
    });
  });

  it('fetchProfile returns null for an unregistered agent', async () => {
    // No profile set for this random address → metadata-uri is empty
    // → client returns null.
    expect(await client.fetchProfile('0x0000000000000000000000000000000000000099')).toBeNull();
  });
});

describeWritesIf('AgentIdentityClient writes — Base Sepolia integration', () => {
  let client: AgentIdentityClient;
  let walletClient: ReturnType<typeof createWalletClient>;
  let deployer: `0x${string}`;
  const URI = 'memory://profile.json';
  const profile: AgentCard = {
    type: 'service',
    displayName: 'Demo Deployer Profile',
    description: 'live SDK write test',
  };

  beforeAll(() => {
    const pk = (PK!.startsWith('0x') ? PK! : '0x' + PK!) as `0x${string}`;
    const account = privateKeyToAccount(pk);
    deployer = account.address;
    walletClient = createWalletClient({ account, chain: baseSepolia, transport: http(RPC!) });
    // Inject an in-memory fetcher so fetchProfile can verify the
    // round-trip without needing IPFS / HTTP for the test.
    const canonical = canonicalProfileJson(profile);
    const inMemoryFetch: typeof fetch = async (url) => {
      if (url === URI) {
        return new Response(canonical, { status: 200 });
      }
      return new Response('not found', { status: 404 });
    };
    client = new AgentIdentityClient({
      rpcUrl: RPC!,
      chainId: 84532,
      profileResolver: PROF,
      fetch: inMemoryFetch,
    });
  });

  it(
    'publishProfile registers (if needed) + anchors metadata; fetchProfile round-trips',
    async () => {
      const tx = await client.publishProfile(
        {
          agent: deployer,
          profile,
          metadataURI: URI,
          registerWith: {
            displayName: 'Demo Deployer Profile',
            description: 'live SDK write test',
          },
        },
        { walletClient },
      );
      expect(tx).toMatch(/^0x[0-9a-f]{64}$/);
      await new Promise((r) => setTimeout(r, 4000));
      const fetched = await client.fetchProfile(deployer);
      expect(fetched).not.toBeNull();
      expect(fetched?.displayName).toBe('Demo Deployer Profile');
      expect(fetched?.type).toBe('service');
    },
    90_000,
  );
});
