# `@agenticprimitives/types`

`types` is the shared type substrate for the monorepo. It defines branded
primitives and cross-package domain types that need to mean the same thing
everywhere.

## Owns

- `Address`, `Hex`, and other branded low-level values.
- Shared Smart Agent identifiers and common domain shapes.
- Package-neutral types that do not require chain, transport, auth, or app
  dependencies.

## Does Not Own

- Runtime validation that belongs to a higher-level package.
- Contract clients, auth ceremonies, custody policy, delegation verification, or
  product UI.
- Protocol-specific adapters.

## Dependencies

`types` is a leaf package. Other packages may depend on it, but it should not
depend on other `@agenticprimitives/*` packages.

## Consumers

Almost every package imports `types`. This is intentional: it keeps public APIs
compatible without introducing a higher-level dependency.

## Architecture Rules

- Keep this package transport-agnostic.
- Do not add app terms, white-label labels, chain deployment config, or runtime
  clients.
- Prefer small branded primitives over broad product objects.
- A type belongs here only when multiple packages need the same stable meaning.

## Common Use

Use `types` when a package needs to accept or return a Smart Agent address,
hex-encoded data, chain-aware account identifier, or other shared primitive
without depending on the package that produced it.

## Validation

Run:

```bash
pnpm check:types
```
