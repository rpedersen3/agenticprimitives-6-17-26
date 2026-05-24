# Agent Naming Concepts

`@agenticprimitives/agent-naming` gives Smart Agents stable human-readable
names and typed discovery records.

## AgentName

An `AgentName` is a normalized dotted name under `.agent`, such as
`alice.agent`, `acme.agent`, or `treasury.acme.agent`.

Names are identifiers for Smart Agents, not login credentials. A name resolves
to a Smart Agent address. The Smart Agent and its account policy decide who can
change that name or its records.

## Label

A label is one segment of a name: `alice`, `acme`, or `treasury`.

Phase 1 labels are intentionally conservative:

- ASCII lowercase letters, numbers, and hyphens only.
- No empty labels.
- No leading or trailing hyphens.
- Maximum 63 characters per label.

This avoids Unicode spoofing until a full IDN/punycode policy exists.

## Node And Namehash

A node is the ENS-compatible `bytes32` namehash of a normalized name.

```ts
namehash('agent');
namehash('acme.agent');
namehash('treasury.acme.agent');
```

`ZERO_NODE` is the all-zero root sentinel. `labelhash(label)` hashes one label;
`namehash(name)` recursively hashes the full path from root to leaf.

## Registry

The registry owns the namespace tree. For each node, it records:

- owner Smart Agent
- resolver contract
- parent node
- optional subregistry
- optional expiry

The registry answers "who controls this name?" and "where are this name's
records stored?"

## Resolver

The resolver stores typed records for a node. The current record bundle is
`AgentNameRecords`:

- `addr`
- `agentKind`
- `displayName`
- `a2aEndpoint`
- `mcpEndpoint`
- `metadataUri`
- `metadataHash`
- `passkeyCredentialDigest`
- `custodyPolicy`
- `nativeId`

The resolver is for discovery and metadata. It is not an authorization system.

## Subregistry

A subregistry manages child-name issuance for a subtree.

For example, `acme.agent` can set a subregistry that manages
`*.acme.agent`. That subregistry may be permissioned, invite-gated,
credential-gated, or permissionless with anti-spam rules.

The package exposes call builders for setting a subregistry and for claiming
names through a permissionless subregistry. The package does not decide which
policy is appropriate for a product.

## Primary Name

A primary name is the reverse record for a Smart Agent address.

Forward resolution:

```text
alice.agent -> 0xAliceSmartAgent
```

Reverse resolution:

```text
0xAliceSmartAgent -> alice.agent
```

Reverse resolution is trusted only when it round-trips: resolving the returned
name must return the same address.

## CAIP-10 Native ID

`nativeId` is a chain-agnostic account identifier such as:

```text
eip155:84532:0x0000000000000000000000000000000000000003
```

It helps external indexers and cross-resolver systems map a Smart Agent to a
native account identifier without this package generating UAID strings.

Encode-side validation is strict. Decode-side behavior is more permissive for
forward compatibility.

## Records And Service Discovery

Records make names useful to agents and tools:

- `a2aEndpoint` tells clients where a service agent's A2A endpoint lives.
- `mcpEndpoint` tells clients where its MCP endpoint lives.
- `metadataUri` and `metadataHash` anchor an off-chain profile.
- `displayName` gives UI a stable label.

Endpoint records are discovery hints. A consumer that needs endpoint-control
proof should compose with `@agenticprimitives/agent-identity`.
