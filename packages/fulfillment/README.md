# @agenticprimitives/fulfillment

> **Status:** STUB (Wave 0.5 of the W1 implementation wave). Implementation lands in subsequent waves per [docs/architecture/w1-implementation-wave-plan.md](../../docs/architecture/w1-implementation-wave-plan.md).

FulfillmentCase lifecycle + Task/Message/Artifact (re-exported from mcp-runtime/a2a) + HandoffPolicy + EvidenceCredential + OutcomeCredential issuance.

**Owns spine layers:** layers-10-12.
**Authoritative spec:** [`specs/244-*.md`](../../specs/) — see `spec.md` for the symlink to the canonical spec.

## What this package will own

See `CLAUDE.md` and `capability.manifest.json` for the bounded surface.

## Build

```bash
pnpm --filter @agenticprimitives/fulfillment typecheck
pnpm --filter @agenticprimitives/fulfillment test
pnpm --filter @agenticprimitives/fulfillment build
```
