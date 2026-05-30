# Agent Identity Concepts

`@agenticprimitives/agent-profile` registers a **profile facet** for Smart
Agents: typed off-chain `AgentCard` JSON and optional endpoint-verification
([ADR-0010](../../../docs/architecture/decisions/0010-smart-agent-canonical-identifier.md)).

This package is **not** the canonical identity. The Smart Agent address from
`agent-account` is. Profiles describe that agent; on-chain anchors use the SA as
subject.

## Three-Package Identity Stack

Per [ADR-0007](../../../docs/architecture/decisions/0007-agent-identity-stack-three-packages.md):

| Package | Facet |
| --- | --- |
| `agent-account` | Canonical SA address |
| `agent-naming` | Human-readable `.agent` name + resolver records |
| `agent-profile` | AgentCard profile + endpoint verification |
| `agent-relationships` | Trust edges between **addresses** (not names) |

`agent-naming` and `agent-profile` are **siblings**. Neither imports the other.
Apps compose: name → address → profile.

## AgentCard

`AgentCard` is a discriminated union on `type`:

- `person`, `org`, `service`, `treasury`
- `mcpServer`, `multisig`

Type-specific fields (`aiAgent`, `mcpServer`, `multisig`, …) extend the base
card. Large blobs live off-chain (IPFS, HTTPS); on-chain storage is
`metadata-uri` + `metadata-hash` predicates.

## Content Hash

`canonicalProfileJson` + `profileContentHash` produce a deterministic keccak256
hash. The client (Phase 2+) refuses profiles whose hash disagrees with the
on-chain `metadata-hash` record — anti-tamper invariant.

Hashes align with `metadata-hash` predicates in `agent-naming/records`.

## CAIP-10 Native ID

`buildCaip10Address` / `parseCaip10` implement the HCS-14 / ERC-8004 account id
shape:

```text
eip155:84532:0x…
```

Use this to back-link external registries to the canonical SA. **Do not** treat
CAIP-10 as a separate identity — it is the same SA in portable form.

UAID strings are **not** generated here ([ADR-0008](../../../docs/architecture/decisions/0008-caip10-nativeid-record-predicate.md)).

## Endpoint Verification

Verification methods answer: "does this MCP / A2A URL actually belong to this
Smart Agent?"

Methods include `dns-txt`, `signed-url`, `http-challenge`,
`verifiable-presentation`. This is distinct from:

- **Naming** reverse resolution (name ↔ address)
- **Delegation** token verification (agent → agent authority)

## Vocabulary: "Profile"

| Package | Meaning of "profile" |
| --- | --- |
| `agent-profile` | Public AgentCard manifest about an SA |
| `connect-auth` | JWT session user profile (private, app-specific) |

Do not merge these concepts in APIs or storage.
