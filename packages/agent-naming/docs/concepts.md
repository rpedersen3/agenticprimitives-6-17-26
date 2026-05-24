# Agent Naming Concepts

`@agenticprimitives/agent-naming` registers a **naming facet** for Smart
Agents: human-readable `.agent` labels and typed discovery records that **point
at** the canonical Smart Agent address ([ADR-0010](../../../docs/architecture/decisions/0010-smart-agent-canonical-identifier.md)).

This package does **not** own identity. The ERC-4337 Smart Agent address
(from `@agenticprimitives/agent-account`) is the canonical identifier. Names are
facet registrations — useful for UX and discovery, never the root authority.

## Canonical Identifier Vs Naming Facet

| Concept | Owner | Example |
| --- | --- | --- |
| Canonical identity | `agent-account` | `0xabc…` / `eip155:84532:0xabc…` |
| Naming facet | `agent-naming` | `alice.agent` → `addr` + `nativeId` records |
| Profile facet | `agent-identity` | AgentCard at `metadata-uri` |
| Control credentials | `identity-auth` + `custody` | Passkey / SIWE → custodian on the SA |

Cross-package APIs use `Address` or CAIP-10 `nativeId`, not bare names.

## AgentName

An `AgentName` is a normalized dotted name under `.agent`, such as
`alice.agent`, `acme.agent`, or `treasury.acme.agent`.

Names are **not** login credentials and **not** CREATE2 salt inputs. A name
resolves to a Smart Agent address via resolver records. The Smart Agent and its
custody policy decide who can change that name or its records.

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

`nativeId` is the canonical Smart Agent identifier in CAIP-10 form:

```text
eip155:84532:0x0000000000000000000000000000000000000003
```

It MUST equal the `addr` record for EVM chains. It back-links external registries
(ERC-8004, HCS, ANS) to the same canonical SA. This package does not generate
UAID strings ([ADR-0008](../../../docs/architecture/decisions/0008-caip10-nativeid-record-predicate.md)).

Encode-side validation is strict. Decode-side behavior is more permissive for
forward compatibility.

## Forced-Unique Labels

When `alice.agent` is taken, bootstrap uses a sequential suffix:
`alice2.agent`, `alice3.agent`, … ([spec 220 § 5](../../../specs/220-agent-identity-bootstrap.md)).
The canonical SA address does not change when the suffix increments — only the
naming facet label does.

## Records And Service Discovery

Records make names useful to agents and tools:

- `a2aEndpoint` tells clients where a service agent's A2A endpoint lives.
- `mcpEndpoint` tells clients where its MCP endpoint lives.
- `metadataUri` and `metadataHash` anchor an off-chain profile.
- `displayName` gives UI a stable label.

Endpoint records are discovery hints. A consumer that needs endpoint-control
proof should compose with `@agenticprimitives/agent-identity`.
