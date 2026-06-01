# `@agenticprimitives/identity-directory-adapters`

`identity-directory-adapters` wires concrete data sources into the
`identity-directory` ports. It is the edge between generic directory concepts and
deployment-specific storage or chain reads.

## Owns

- Directory adapter implementations.
- CAIP-10 adapter helpers.
- On-chain and naming adapters.
- Indexer and app-storage bridge adapters.
- Conversion between concrete data sources and directory evidence shapes.

## Does Not Own

- Directory domain model. Use `identity-directory`.
- Name-management logic. Use `agent-naming`.
- App-specific KV schema unless exposed as an adapter boundary.
- Authorization decisions.
- Product search UX.

## Dependencies

Depends on:

- `types`
- `agent-naming`
- `identity-directory`

## Consumers

Used by apps and services that need to wire a real deployment into the directory
read model.

## Architecture Rules

- Keep deployment-specific I/O in adapters, not core directory logic.
- Adapter reads should be explicit and bounded.
- Do not add fallback chains across unrelated evidence sources.
- Preserve evidence metadata so callers can explain why an answer was returned.

## Common Use

Use this package when connecting Cloudflare KV, app storage, an on-chain naming
registry, CAIP-10 mappings, or other concrete indexes to the generic
`identity-directory` query surface.

## Validation

Run:

```bash
pnpm --filter @agenticprimitives/identity-directory-adapters typecheck
pnpm --filter @agenticprimitives/identity-directory-adapters test
```
