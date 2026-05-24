import {
  AgentNamingClient,
  labelhash,
  namehash,
  normalizeAgentName,
} from '@agenticprimitives/agent-naming';

const normalized = normalizeAgentName('  Treasury.Acme.Agent  ');
const labelNode = labelhash('treasury');
const nameNode = namehash(normalized);

console.log({ normalized, labelNode, nameNode });

const naming = new AgentNamingClient({
  rpcUrl: 'https://base-sepolia.example/rpc',
  chainId: 84532,
  registry: '0x0000000000000000000000000000000000000001',
  universalResolver: '0x0000000000000000000000000000000000000002',
});

async function main() {
  const address = await naming.resolveName('treasury.acme.agent');
  const records = await naming.getRecords('treasury.acme.agent');

  if (address) {
    const primaryName = await naming.reverseResolve(address);
    console.log({ address, primaryName, records });
  }
}

void main();
