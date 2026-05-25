# Agent Identity Migration Notes

## Current Status

Phase 1 — types, CAIP-10 helpers, canonical JSON hashing, call builders, and
client skeleton. Contract-backed reads/writes land in Phase 2 / 4.

## Canonical-Identifier-First Profiles

Old pattern: profile JSON keyed by email, EOA, or `.agent` name.

New pattern ([spec 220](../../../specs/220-agent-identity-bootstrap.md)):

```text
Smart Agent address  →  subject for on-chain anchor
                    →  AgentCard describes this address
```

Store and query profiles by `Address` / CAIP-10, not by name string.

## Pairing With Agent Naming

Resolver records (`agent-naming/records`) carry discovery fields (`displayName`,
`mcpEndpoint`, `nativeId`). AgentCard carries richer typed manifests at
`metadata-uri`.

Typical split:

- Small, hot fields on naming records
- Full AgentCard off-chain with `metadata-hash` integrity check

## From UAID-Centric To CAIP-10

If integrations expected server-generated UAIDs, switch to CAIP-10 `nativeId`
and derive UAIDs locally if still required ([ADR-0008](../../../docs/architecture/decisions/0008-caip10-nativeid-record-predicate.md)).

## Breaking Change Checklist

1. `README.md`, `docs/api.md`
2. `docs/security.md` when hash or verification rules change
3. `capability.manifest.json`
4. `specs/217-agent-profile.md`
5. Golden tests for `profileContentHash` and CAIP-10 vectors
