# @agenticprimitives/verifiable-credentials

> **Status:** STUB (Wave 0.5 of the W1 implementation wave). Implementation lands in subsequent waves per [docs/architecture/w1-implementation-wave-plan.md](../../docs/architecture/w1-implementation-wave-plan.md).

W3C Verifiable Credentials envelope + Eip712Signature2026 proof + DOLCE+DnS Situation bases + ontology-shape schema registration. Substrate for layers 12–15 credential types.

**Owns spine layers:** envelope.
**Authoritative spec:** [`specs/242-*.md`](../../specs/) — see `spec.md` for the symlink to the canonical spec.

## What this package will own

See `CLAUDE.md` and `capability.manifest.json` for the bounded surface.

## Build

```bash
pnpm --filter @agenticprimitives/verifiable-credentials typecheck
pnpm --filter @agenticprimitives/verifiable-credentials test
pnpm --filter @agenticprimitives/verifiable-credentials build
```
