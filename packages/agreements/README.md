# @agenticprimitives/agreements

> **Status:** STUB (Wave 0.5 of the W1 implementation wave). Implementation lands in subsequent waves per [docs/architecture/w1-implementation-wave-plan.md](../../docs/architecture/w1-implementation-wave-plan.md).

Commitment-only AgreementRegistry SDK. Owns AgreementCredential shape (PD-22) + commitment math + bilateral status transitions + joint-assertion gateway.

**Owns spine layers:** layer-8.
**Authoritative spec:** [`specs/241-*.md`](../../specs/) — see `spec.md` for the symlink to the canonical spec.

## What this package will own

See `CLAUDE.md` and `capability.manifest.json` for the bounded surface.

## Build

```bash
pnpm --filter @agenticprimitives/agreements typecheck
pnpm --filter @agenticprimitives/agreements test
pnpm --filter @agenticprimitives/agreements build
```
