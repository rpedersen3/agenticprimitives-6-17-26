# @agenticprimitives/intent-marketplace

> **Status:** STUB (Wave 0.5 of the W1 implementation wave). Implementation lands in subsequent waves per [docs/architecture/w1-implementation-wave-plan.md](../../docs/architecture/w1-implementation-wave-plan.md).

Direct Lane intent matchmaking. Intent + ConstraintSet + AssumptionSet + ResolutionReceipt + IntentMatch + composite-score ranking. Resolver layer 4 folded into PassThrough stub in W1.

**Owns spine layers:** layers-2-3-5-6-7.
**Authoritative spec:** [`specs/239-*.md`](../../specs/) — see `spec.md` for the symlink to the canonical spec.

## What this package will own

See `CLAUDE.md` and `capability.manifest.json` for the bounded surface.

## Build

```bash
pnpm --filter @agenticprimitives/intent-marketplace typecheck
pnpm --filter @agenticprimitives/intent-marketplace test
pnpm --filter @agenticprimitives/intent-marketplace build
```
