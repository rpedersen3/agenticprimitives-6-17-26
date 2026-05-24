/**
 * Integration tests against live Base Sepolia.
 * Skipped without BASE_SEPOLIA_RPC env.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { AgentIdentityClient } from '../src/client';

const RPC = process.env.BASE_SEPOLIA_RPC;
const PROF = '0x189D7c19f5B611CD85e2Ef748d1FA546F3402275' as const;

const describeIf = RPC ? describe : describe.skip;

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
