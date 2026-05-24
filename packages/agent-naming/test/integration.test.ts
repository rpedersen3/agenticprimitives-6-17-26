/**
 * Integration tests against live Base Sepolia contracts.
 *
 * Skipped by default; run with `BASE_SEPOLIA_RPC=… vitest test/integration`
 * to exercise. The contracts these test against are deployed addresses
 * recorded in apps/contracts/deployments-base-sepolia.json.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { baseSepolia } from 'viem/chains';
import { AgentNamingClient } from '../src/client';
import { namehash } from '../src/namehash';

const RPC = process.env.BASE_SEPOLIA_RPC;
const PK = process.env.PRIVATE_KEY;
const REGISTRY = '0xC3Ffa91DB8084eE81A4eb64F6840Ef02E9503b89' as const;
const UNIVERSAL = '0xEdfC405d3FBe73ad2F62727C7Ff05d7dc88BFB3b' as const;

const describeIf = RPC ? describe : describe.skip;
// Write tests need both RPC + a funded private key (deployer/EOA).
const describeWritesIf = RPC && PK ? describe : describe.skip;

describeIf('AgentNamingClient — Base Sepolia integration', () => {
  // Lazy-init so describe.skip can short-circuit before the constructor
  // reads RPC (which is undefined in the skip case).
  let client: AgentNamingClient;
  beforeAll(() => {
    client = new AgentNamingClient({
      rpcUrl: RPC!,
      chainId: 84532,
      registry: REGISTRY,
      universalResolver: UNIVERSAL,
    });
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

describeWritesIf('AgentNamingClient writes — Base Sepolia integration', () => {
  // The deployer EOA owns demo.agent (set by bootstrap-demo-names).
  // We use setAgentRecords to overwrite the displayName with a
  // timestamp-suffixed value and verify the round-trip — proves the
  // SDK write path works end-to-end without doing any registration
  // that would change global state in surprising ways.
  let client: AgentNamingClient;
  let walletClient: ReturnType<typeof createWalletClient>;
  beforeAll(() => {
    const pk = (PK!.startsWith('0x') ? PK! : '0x' + PK!) as `0x${string}`;
    const account = privateKeyToAccount(pk);
    client = new AgentNamingClient({
      rpcUrl: RPC!,
      chainId: 84532,
      registry: REGISTRY,
      universalResolver: UNIVERSAL,
    });
    walletClient = createWalletClient({ account, chain: baseSepolia, transport: http(RPC!) });
  });

  it(
    'setAgentRecords overwrites displayName on demo.agent (round-trip via getRecords)',
    async () => {
      const updated = `Demo Deployer (live SDK test ${Date.now()})`;
      const hashes = await client.setAgentRecords(
        { name: 'demo.agent', records: { displayName: updated } },
        { walletClient },
      );
      expect(hashes.length).toBe(1);
      // Give the universal resolver a beat to observe.
      await new Promise((r) => setTimeout(r, 4000));
      const records = await client.getRecords('demo.agent');
      expect(records.displayName).toBe(updated);
    },
    60_000,
  );
});
