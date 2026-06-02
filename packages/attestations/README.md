# @agenticprimitives/attestations

> **Status:** STUB (Wave 0.5 of the W1 implementation wave). Implementation lands in subsequent waves per [docs/architecture/w1-implementation-wave-plan.md](../../docs/architecture/w1-implementation-wave-plan.md).

AttestationRegistry SDK — EAS-aligned with bilateral consent. Owns Association + JointAgreement + Evidence + Outcome + Validation + TrustUpdate credential types asserted into a single on-chain registry per ADR-0023.

**Owns spine layers:** layers-12-15.
**Authoritative spec:** [`specs/242-*.md`](../../specs/) — see `spec.md` for the symlink to the canonical spec.

## What this package will own

See `CLAUDE.md` and `capability.manifest.json` for the bounded surface.

## Build

```bash
pnpm --filter @agenticprimitives/attestations typecheck
pnpm --filter @agenticprimitives/attestations test
pnpm --filter @agenticprimitives/attestations build
```
