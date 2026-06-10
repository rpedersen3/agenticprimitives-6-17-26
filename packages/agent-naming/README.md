# @agenticprimitives/agent-naming

**The name is a facet. The address is the identity.** Agent naming is being settled right now — GoDaddy launched an Agent Naming Service, ERC-8004 put agent registries on mainnet, and every discovery stack needs an answer to "which agent answers to this name?" Most naming systems get the dependency backwards: the name becomes the identity, and losing the name (or the registrar) means losing everything attached to it. Here, every person, org, service agent, and treasury is a canonical ERC-4337 Smart Agent address — and a `.agent` name is a replaceable record pointing *at* that address ([ADR-0010](../../docs/architecture/decisions/0010-smart-agent-canonical-identifier.md)). Rotate the name, keep the identity. Rotate your credentials, keep the name. Nothing downstream breaks.

Part of [agenticprimitives](../../README.md) — the trust substrate for the agent economy: one canonical Smart Agent identity with custody, delegation, naming, credentials, and audit evidence designed as one system.

Use this package to resolve names like `alice.agent` and `treasury.acme.agent` to Smart Agent addresses, read typed service-discovery records (A2A endpoint, MCP endpoint, CAIP-10 `nativeId`), and build encoded calls for name-management transactions. Names are hierarchical — orgs hand out subnames under their own subregistry — and normalization is deterministic and on-chain-verifiable.

> **Layer:** Discover — a naming **facet** (not canonical identity — that is `agent-account`).
> **Canonical key:** the Smart Agent address the name resolves to.

## Use this when

- You need forward resolution: `alice.agent → 0x…`.
- You need reverse resolution from a Smart Agent address to its primary name — with a round-trip check, so a name is only trusted when it resolves back to the same address.
- You need typed records such as `displayName`, `a2aEndpoint`, `mcpEndpoint`, `nativeId`, or `metadataUri` — service discovery without hardcoded URLs.
- You need pure call builders for name registration, resolver updates, primary-name updates, or owner rotation that compose into custody-policy ceremonies.

## Do not use this for

- Passkey ceremonies or auth flows — `@agenticprimitives/connect-auth`.
- Smart-account deployment or UserOps — `@agenticprimitives/agent-account`.
- Account safety policy and approval scheduling — `@agenticprimitives/account-custody`.
- Permission-token minting or attenuation — `@agenticprimitives/delegation`.
- MCP/A2A transport wiring — demo apps or runtime packages.

## Install

Workspace-internal; not yet published.

```bash
pnpm add @agenticprimitives/agent-naming
```

## 60-second quickstart

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

## How it's different

The reference points are **ENS and Unstoppable Domains** — both excellent at what they do, both built around a different center of gravity:

- **Name-as-asset vs. name-as-facet.** ENS and Unstoppable treat the name as the prized object; identity accretes around it. Here the Smart Agent address is canonical and forced-unique names are assigned at identity bootstrap ([spec 220 §5](../../specs/220-agent-identity-bootstrap.md)) — the name is a pointer, replaceable without identity loss, and `addr` + `nativeId` must reference the same Smart Agent.
- **Agent-native records.** Typed predicates for `a2aEndpoint`, `mcpEndpoint`, CAIP-10 `nativeId`, and a public-safe passkey credential digest — the records an agent economy actually resolves, not a TXT free-for-all. Unknown predicates are ignored on decode and rejected by typed encoders.
- **Custody-governed rotation.** Name-owner rotation ships as pure encoded call builders (`/custody` subpath) that compose into the owner Smart Agent's custody-policy ceremonies — quorums and trustees, not a private key that can be phished once.
- **Disciplined reads.** Product reads use `readContract` only — no `eth_getLogs` walks, no silent fallbacks ([ADR-0012](../../docs/architecture/decisions/0012-no-eth-getlogs-in-product-read-paths.md), [ADR-0013](../../docs/architecture/decisions/0013-no-silent-fallbacks.md)). Reverse resolution is a single on-chain `reverseResolveString` read, then a forward round-trip before it is trusted.

The `.agent` TLD is the naming protocol; which names a given deployment registers is app-layer configuration — this package stays generic.

## Main concepts

- **Canonical SA**: the ERC-4337 address every name must reference (`addr`, `nativeId`). Owned by `agent-account`, not this package.
- **AgentName**: a normalized dotted name under `.agent` (a facet label).
- **Label / Node**: one segment (`treasury`); the recursive `namehash(name)`.
- **Registry / Resolver**: name records (owner, resolver, parent, subregistry); typed records for a node.
- **Primary name**: the reverse record for a Smart Agent address.

See [`docs/concepts.md`](docs/concepts.md).

## Common recipes

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

More examples: [`examples/basic.ts`](examples/basic.ts) · [`examples/records.ts`](examples/records.ts) · [`examples/custody-rotation.ts`](examples/custody-rotation.ts)

## Runtime support

Pure helpers and record encoders work in browser, Node, and Workers. The client uses `viem` public and wallet clients and requires an RPC URL for chain reads or transaction submission.

## Subpath exports

- `@agenticprimitives/agent-naming` — public helpers, client, ABIs, and types.
- `@agenticprimitives/agent-naming/records` — predicate ids and typed record encode/decode helpers.
- `@agenticprimitives/agent-naming/custody` — pure encoded call builders for name-management transactions.

## Security invariants

- Name normalization is deterministic — equal normalizations produce equal namehashes.
- Reverse resolution must round-trip before it is trusted.
- Unknown predicates are ignored on decode and rejected by typed encoders.
- Raw passkey credential IDs are never stored — only a digest.
- Endpoint records are discovery hints, not proof of endpoint control.
- Product reads use `readContract`; no `eth_getLogs` in hot paths ([ADR-0012](../../docs/architecture/decisions/0012-no-eth-getlogs-in-product-read-paths.md)).

See [`docs/security.md`](docs/security.md) and [`AUDIT.md`](AUDIT.md).

## Documentation map

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

## Status

Testnet/pilot-ready. Production launch is gated on the public checklist in the root [`README.md`](../../README.md#status--honest-version) — including third-party contract audit and governance key rotation. Track every security finding live in [`docs/audits/findings.yaml`](../../docs/audits/findings.yaml).

## License

UNLICENSED.
