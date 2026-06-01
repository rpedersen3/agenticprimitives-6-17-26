# `@agenticprimitives/identity-directory`

`identity-directory` is the evidence-backed read model over agent facets. It
answers questions about agents by composing naming, profile, relationship,
credential, and indexer evidence.

## Owns

- Directory query interfaces.
- Evidence-backed agent lookup shapes.
- Intent/discovery query models.
- Port interfaces for storage, indexers, and facet sources.
- Read-model composition rules.

## Does Not Own

- Concrete storage adapters. Use `identity-directory-adapters`.
- Name registration. Use `agent-naming`.
- Profile authoring. Use `agent-profile`.
- Authorization or delegation.
- Product-specific search ranking.

## Dependencies

Depends on:

- `types`
- `audit`
- `ontology`

## Consumers

Used by:

- `connect`
- `identity-directory-adapters`
- agent discovery apps
- secure-home and relying-site flows that need facet lookup

## Architecture Rules

- Directory answers are read-model answers, not canonical identity.
- Evidence should be explainable and traceable.
- Empty result is an answer; do not silently fall back to another mechanism.
- Product hot paths should not use `eth_getLogs`.
- Ports define dependencies; adapters wire concrete deployments.

## Common Use

Use this package to answer "which Smart Agent does this name/profile/credential
point to?" or "which agents match this user intent by skills, geography,
relationships, and profile facets?"

## Validation

Run:

```bash
pnpm --filter @agenticprimitives/identity-directory typecheck
pnpm --filter @agenticprimitives/identity-directory test
```
