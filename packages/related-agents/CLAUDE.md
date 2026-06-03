# @agenticprimitives/related-agents — Claude guide

> **Status:** w1-foundational. Spec [246](../../specs/246-related-agents-vault.md) + [ADR-0025](../../docs/architecture/decisions/0025-related-agent-links-are-private.md).

## What this package owns

- **`buildRelatedAgentCredential`** — the private, holder-resident situation credential that links a
  person to a RELATED agent (e.g. an org they created via a relying app). Self-issued (holder = issuer
  = personSA), `visibility = private`. DOLCE+DnS Situation via `verifiable-credentials.buildSituation`.
- **`relatedAgentReadCaveats`** — the scoped-read caveat set a grantee (relying site OR broker org)
  gets on the org (time-bound + zero-value + target-scoped). Reuses `delegation` caveat primitives.
- **List-query shapes** — `RelatedAgentLink`, `ListRelatedAgentsResponse`, `DelegatedAgentLink`,
  `ListDelegatedAgentsResponse` (the wire shapes Connect serves; carry NO person id).

## What this package does NOT own

- **Storage.** The vault (Connect-home KV) + the query endpoints are app/Connect-level.
- **Vocabulary.** `purpose` is a free string (`jp-adopter-org` is the APP's term). No vertical content.
- **On-chain edges.** `agent-relationships` owns those; person↔org is NEVER an on-chain edge (ADR-0025).
- **The VC envelope / signing.** That's `verifiable-credentials` (`signCredential`). Delegation minting
  is `delegation` (`DelegationClient.issueDelegation`).

## Hard rule (ADR-0025)

A person↔org link is a **private vault credential**, never a public on-chain relationship and never
relying-app-local person→org state. The public graph is org↔org and only on explicit consent.

## Allowed imports

`@agenticprimitives/{types, verifiable-credentials, delegation}`, `viem`.

## Forbidden imports

`@agenticprimitives/agent-relationships` (on-chain edges — sibling, not a dependency), `apps/*`, MCP /
transport packages, vertical vocabulary, deployment hostnames.

## Drift triggers — STOP and route

- "Write the person→org link as an AgentRelationship edge" — **STOP.** ADR-0025; it's a private vault
  credential.
- "Hardcode the JP `jp-adopter-org` purpose / a hostname here" — **STOP.** ADR-0021; `purpose` is a free
  string supplied by the app.
- "Store the vault in this package" — **STOP.** Storage is Connect/app-level; this package is shape only.

## Validate

```bash
pnpm --filter @agenticprimitives/related-agents typecheck
pnpm --filter @agenticprimitives/related-agents test
```
