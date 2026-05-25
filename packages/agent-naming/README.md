# @agenticprimitives/agent-naming

Human-readable `.agent` **naming facets** for Smart Agents.

The canonical identifier is the Smart Agent address
(`@agenticprimitives/agent-account`). This package registers names and records
that point **at** that address — it does not create or own identity.

> **Layer:** Discover — a naming **facet** (not canonical identity — that is `agent-account`).
> **Canonical key:** the Smart Agent address the name resolves to.

Use this package to resolve names like `alice.agent`, `acme.agent`, and
`treasury.acme.agent` to Smart Agent addresses, read typed service-discovery
records, and build encoded calls for name-management transactions.

## Use This When

- You need forward resolution: `alice.agent -> 0x...`.
- You need reverse resolution from a Smart Agent address to its primary name.
- You need typed records such as `displayName`, `a2aEndpoint`, `mcpEndpoint`,
  `nativeId`, or `metadataUri`.
- You need pure call builders for name registration, resolver updates, primary
  name updates, or owner rotation.

## Do Not Use This For

- Passkey ceremonies or auth flows. Use `@agenticprimitives/connect-auth`.
- Smart-account deployment or UserOps. Use `@agenticprimitives/agent-account`.
- Account safety policy and approval scheduling. Use `@agenticprimitives/account-custody`.
- Permission-token minting or attenuation. Use `@agenticprimitives/delegation`.
- MCP/A2A transport wiring. Use demo apps or runtime packages.

## Install

This package is workspace-internal and not yet published.

```bash
pnpm add @agenticprimitives/agent-naming
```

## 60-Second Quickstart

```ts
import {
  AgentNamingClient,
  labelhash,
  namehash,
  normalizeAgentName,
} from '@agenticprimitives/agent-naming';

normalizeAgentName('  ALICE.AGENT  '); // "alice.agent"
labelhash('alice'); // 0x...
namehash('treasury.acme.agent'); // 0x...

const naming = new AgentNamingClient({
  rpcUrl: 'https://base-sepolia.example/rpc',
  chainId: 84532,
  registry: '0x0000000000000000000000000000000000000001',
  universalResolver: '0x0000000000000000000000000000000000000002',
});

const address = await naming.resolveName('alice.agent');
const primaryName = await naming.reverseResolve('0x0000000000000000000000000000000000000003');
const records = await naming.getRecords('treasury.acme.agent');
```

## Main Concepts

- **Canonical SA**: the ERC-4337 address every name must reference (`addr`,
  `nativeId`). Owned by `agent-account`, not this package.
- **AgentName**: a normalized dotted name under `.agent` (a facet label).
- **Label**: one segment of a name, such as `treasury`.
- **Node**: ENS-compatible `namehash(name)`.
- **Registry**: owns name records: owner, resolver, parent, subregistry.
- **Resolver**: stores typed records for a node.
- **Primary name**: reverse record for a Smart Agent address.
- **Records**: typed data such as endpoints, display name, CAIP-10 `nativeId`,
  and public-safe passkey credential digest.

See [`docs/concepts.md`](docs/concepts.md).

## Common Recipes

```ts
import {
  decodeRecords,
  encodeRecords,
  PREDICATE_ID,
} from '@agenticprimitives/agent-naming/records';

const encoded = encodeRecords({
  addr: '0x0000000000000000000000000000000000000003',
  agentKind: 'service', // a treasury is a service agent; 'treasury' is a profile subtype
  displayName: 'Acme Treasury',
  nativeId: 'eip155:84532:0x0000000000000000000000000000000000000003',
});

const decoded = decodeRecords({
  strings: { [PREDICATE_ID.displayName]: 'Acme Treasury' },
  addresses: { [PREDICATE_ID.addr]: '0x0000000000000000000000000000000000000003' },
  bytes32s: {},
});
```

More examples:

- [`examples/basic.ts`](examples/basic.ts)
- [`examples/records.ts`](examples/records.ts)
- [`examples/custody-rotation.ts`](examples/custody-rotation.ts)

## Runtime Support

Pure helpers and record encoders work in browser, Node, and Workers. The client
uses `viem` public and wallet clients and requires an RPC URL for chain reads or
transaction submission.

## Subpath Exports

- `@agenticprimitives/agent-naming` — public helpers, client, ABIs, and types.
- `@agenticprimitives/agent-naming/records` — predicate ids and typed
  record encode/decode helpers.
- `@agenticprimitives/agent-naming/custody` — pure encoded call builders for
  name-management transactions.

## Security Invariants

- Product reads use `readContract`; no `eth_getLogs` in hot paths
  ([ADR-0012](../../docs/architecture/decisions/0012-no-eth-getlogs-in-product-read-paths.md)).
  `reverseResolve` string reconstruction is transitional log debt — do not copy.
- Name normalization is deterministic.
- Reverse resolution must round-trip before it is trusted.
- Unknown predicates are ignored on decode and rejected by typed encoders.
- Raw passkey credential IDs are never stored.
- Endpoint records are discovery hints, not proof of endpoint control.

See [`docs/security.md`](docs/security.md) and [`AUDIT.md`](AUDIT.md).

## Documentation Map

- [`docs/concepts.md`](docs/concepts.md) — naming model and vocabulary.
- [`docs/api.md`](docs/api.md) — human-readable public API guide.
- [`docs/security.md`](docs/security.md) — security posture and invariants.
- [`docs/troubleshooting.md`](docs/troubleshooting.md) — common errors.
- [`docs/migration.md`](docs/migration.md) — version and migration notes.
- [`CLAUDE.md`](CLAUDE.md) — agent routing and drift prevention.
- [`spec.md`](spec.md) — canonical spec pointer.

## Validation

```bash
pnpm check:agent-naming
pnpm check:public-exports
pnpm check:forbidden-terms
```

## License

UNLICENSED.
