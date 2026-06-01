# `@agenticprimitives/ontology`

`ontology` provides controlled vocabularies and semantic terms for the platform.
It prevents packages and apps from inventing incompatible words for the same
agent, facet, relationship, skill, or shape.

## Owns

- Agent and facet vocabulary.
- Relationship and skill terms.
- Shape and semantic type definitions.
- Stable identifiers for shared concepts.
- Ontology artifacts consumed by directory and profile flows.

## Does Not Own

- Runtime authorization.
- Chain account logic.
- Profile storage.
- Directory adapters.
- Product-specific labels or marketing copy.

## Dependencies

`ontology` has no internal `@agenticprimitives/*` package dependencies.

## Consumers

Used by:

- `identity-directory`
- profile and discovery tooling
- apps that need consistent terms for skills, facets, and relationships

## Architecture Rules

- Terms should be stable and reusable across products.
- Do not encode one app's language as platform doctrine.
- Keep semantic definitions separate from authorization policy.
- Prefer adding a clear term over overloading an existing one.

## Common Use

Use this package when directory, profile, or discovery code needs shared
vocabulary for agent types, skills, service capabilities, relationship roles, or
facet classes.

## Validation

Run:

```bash
pnpm --filter @agenticprimitives/ontology typecheck
pnpm --filter @agenticprimitives/ontology test
```
