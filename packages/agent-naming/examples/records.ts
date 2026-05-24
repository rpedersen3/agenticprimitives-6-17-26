import {
  AGENT_KIND_ID,
  PREDICATE_ID,
  decodeRecords,
  encodeRecords,
} from '@agenticprimitives/agent-naming/records';

const agentAddress = '0x0000000000000000000000000000000000000003';

const encoded = encodeRecords({
  addr: agentAddress,
  agentKind: 'treasury',
  displayName: 'Acme Treasury',
  a2aEndpoint: 'https://a2a.acme.example',
  mcpEndpoint: 'https://mcp.acme.example',
  metadataUri: 'https://metadata.acme.example/treasury.json',
  metadataHash: '0x1111111111111111111111111111111111111111111111111111111111111111',
  passkeyCredentialDigest: '0x2222222222222222222222222222222222222222222222222222222222222222',
  custodyPolicy: '0x0000000000000000000000000000000000000004',
  nativeId: `eip155:84532:${agentAddress}`,
});

console.log(encoded);

const decoded = decodeRecords({
  strings: {
    [PREDICATE_ID.displayName]: 'Acme Treasury',
    [PREDICATE_ID.a2aEndpoint]: 'https://a2a.acme.example',
    [PREDICATE_ID.nativeId]: `eip155:84532:${agentAddress}`,
  },
  addresses: {
    [PREDICATE_ID.addr]: agentAddress,
  },
  bytes32s: {
    [PREDICATE_ID.agentKind]: AGENT_KIND_ID.treasury,
  },
});

console.log(decoded);
