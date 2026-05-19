# @agenticprimitives/types — Claude guide

## What this package owns
- Branded primitive types: `Address`, `Hex`, `ChainId`.
- `BrandedId<T>` helper for opaque IDs.
- Nothing else. This is a types-only leaf package.

## What this package does NOT own
- Runtime code of any kind. If you find yourself adding a function here, it belongs in the consuming package.
- Domain vocabulary (`Person`, `Org`, etc.).
- Anything used by only one other package.

## Read these first (in order)
1. `capability.manifest.json`
2. `src/index.ts`

## Stable public exports
- `Address`, `Hex` — branded `0x${string}` types.
- `ChainId` — branded number.
- `BrandedId<T>` — generic opaque-ID helper.

## Allowed imports
None. This package has zero deps.

## Forbidden imports
- `apps/*`
- Any other `@agenticprimitives/*` package (this is a leaf).

## Security invariants (DO NOT BREAK)
- Types-only. No side effects. No runtime code.
- Branded types use TypeScript phantom types via `__brand` symbol — must remain compile-time only.

## Validate the package
```bash
pnpm --filter @agenticprimitives/types typecheck
```

## Common task routing
- Adding a new branded primitive → `src/index.ts`, then verify ≥2 packages will consume it before adding.
- Anything else → does not belong in this package.

## Generated files (ignore)
`dist/`, `node_modules/`, `coverage/`, `*.tsbuildinfo`.
