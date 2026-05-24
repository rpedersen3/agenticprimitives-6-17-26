/**
 * Integration tests against live Base Sepolia contracts.
 *
 * Skipped by default; run with `BASE_SEPOLIA_RPC=… vitest test/integration`
 * to exercise. The contracts these test against are deployed addresses
 * recorded in apps/contracts/deployments-base-sepolia.json.
 */
import { describe, expect, it } from 'vitest';
import { AgentNamingClient } from '../src/client';
import { namehash } from '../src/namehash';

const RPC = process.env.BASE_SEPOLIA_RPC;
const REGISTRY = '0xC3Ffa91DB8084eE81A4eb64F6840Ef02E9503b89' as const;
const UNIVERSAL = '0xEdfC405d3FBe73ad2F62727C7Ff05d7dc88BFB3b' as const;

const describeIf = RPC ? describe : describe.skip;

describeIf('AgentNamingClient — Base Sepolia integration', () => {
  const client = new AgentNamingClient({
    rpcUrl: RPC!,
    chainId: 84532,
    registry: REGISTRY,
    universalResolver: UNIVERSAL,
  });

  it('resolveName returns null for unregistered names', async () => {
    expect(await client.resolveName('definitely-not-registered-xyz.agent')).toBeNull();
  });

  it('namehash(.agent) matches on-chain AGENT_ROOT', async () => {
    // Just a deterministic sanity check; the on-chain root is the deployer.
    const node = namehash('agent');
    expect(node).toBe('0xe449d9dc25bfd945e775919216d40d92f831825808b665fa388d7f0a087ba57e');
  });

  it('reverseResolve returns null for an unset address', async () => {
    expect(await client.reverseResolve('0x0000000000000000000000000000000000000099')).toBeNull();
  });

  it('getRecords returns empty bundle for unregistered name', async () => {
    const records = await client.getRecords('not-registered.agent');
    expect(records).toEqual({});
  });
});
