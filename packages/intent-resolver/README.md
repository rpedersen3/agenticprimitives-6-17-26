# @agenticprimitives/intent-resolver

> **Status:** STUB (Wave 0.5 of the W1 implementation wave). Implementation lands in subsequent waves per [docs/architecture/w1-implementation-wave-plan.md](../../docs/architecture/w1-implementation-wave-plan.md).

Resolver layer skeleton (W1) — types + PassThroughResolver only. Full resolver engine deferred to W2.

**Owns spine layers:** layer-4-skeleton.
**Authoritative spec:** [`specs/239-*.md`](../../specs/) — see `spec.md` for the symlink to the canonical spec.

## What this package will own

See `CLAUDE.md` and `capability.manifest.json` for the bounded surface.

## Build

```bash
pnpm --filter @agenticprimitives/intent-resolver typecheck
pnpm --filter @agenticprimitives/intent-resolver test
pnpm --filter @agenticprimitives/intent-resolver build
```
