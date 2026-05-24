# @agenticprimitives/types — Claude guide

## What this package owns
- Branded primitive types: `Address`, `Hex`, `ChainId`.
- `BrandedId<T>` helper for opaque IDs.
- Cross-cutting agent-identity shape: `AgentType` (closed enum) and
  `NameContext` (optional injected context downstream packages
  accept WITHOUT importing `@agenticprimitives/agent-naming`). See
  [ADR-0006](../../docs/architecture/decisions/0006-agent-naming-as-resolution-layer.md).
- Nothing else. This is a types-only leaf package.

## What this package does NOT own
- Runtime code of any kind. If you find yourself adding a function here, it belongs in the consuming package.
- Domain vocabulary (`Person`, `Org`, etc.).
- Anything used by only one other package.

## Vocabulary
**Owns:** `Address`, `Hex`, `ChainId`, `BrandedId`, `AgentType`,
`NameContext`.
**Disambiguation:**
- **`AgentType`** lives here as a cross-cutting closed enum (≥2 consumers:
  audit, tool-policy, delegation, mcp-runtime, agent-naming). Naming-domain
  authority — resolution, registry, records — belongs in `agent-naming`.
- **`NameContext`** is the injection shape (`agentName? + agentType?`)
  other packages accept as optional context. It is NOT a delegation
  primitive, NOT a session primitive, NOT custody authority.
**Does not use:** any concept named in any other package. See
[`docs/architecture/vocabulary-map.md`](../../docs/architecture/vocabulary-map.md).

## Read these first (in order)
1. `capability.manifest.json`
2. `src/index.ts`

## Stable public exports
- `Address`, `Hex` — branded `0x${string}` types.
- `ChainId` — branded number.
- `BrandedId<T>` — generic opaque-ID helper.
- `AgentType` — closed enum (`'person' | 'org' | 'service' | 'treasury'`).
- `NameContext` — `{ agentName?: string; agentType?: AgentType }`.

## Allowed imports
None. Zero deps.

## Forbidden imports
- `apps/*`
- Any other `@agenticprimitives/*` package.

## Drift triggers — STOP and route
- "Add a domain type (User, Org, Profile, Session, etc.)" — **STOP.** Domain types live in the package that owns the concept.
- "Add a runtime function or const" — **STOP.** Types-only.
- "Add a type used in only one package" — **STOP.** Move it to that package; only promote here when ≥2 packages need it.

## Before you write code
- [ ] Is this type used by ≥2 packages today (not "might be useful someday")?
- [ ] Is it a primitive (chain, address, ID), not domain vocabulary?
- [ ] Does the change preserve "no runtime code; no side effects"?
- [ ] Did I check [`docs/architecture/vocabulary-map.md`](../../docs/architecture/vocabulary-map.md) to make sure the name doesn't clash with a neighbor's concept?

If any answer is "no", the change probably belongs elsewhere.

## Security invariants (DO NOT BREAK)
- Types-only. No side effects. No runtime code.
- Branded types use TypeScript phantom types via `__brand` symbol — must remain compile-time only.

## Validate the package
```bash
pnpm --filter @agenticprimitives/types typecheck
pnpm check:forbidden-terms
```

## Common task routing
- Adding a new branded primitive → `src/index.ts`, after verifying ≥2 consumers.
- Anything else → does not belong here.

## Generated files (ignore)
`dist/`, `node_modules/`, `coverage/`, `*.tsbuildinfo`.
