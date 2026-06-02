# @agenticprimitives/payments

> **Status:** STUB (Wave 0.5 of the W1 implementation wave). Implementation lands in subsequent waves per [docs/architecture/w1-implementation-wave-plan.md](../../docs/architecture/w1-implementation-wave-plan.md).

PaymentMandate + ContextBinding + MandateConstraints + open/closed mode discrimination. Three W1 rails (x402, wallet, sponsored-userop). PaymentReceipt asserted into AttestationRegistry per ADR-0023.

**Owns spine layers:** layer-9b.
**Authoritative spec:** [`specs/243-*.md`](../../specs/) — see `spec.md` for the symlink to the canonical spec.

## What this package will own

See `CLAUDE.md` and `capability.manifest.json` for the bounded surface.

## Build

```bash
pnpm --filter @agenticprimitives/payments typecheck
pnpm --filter @agenticprimitives/payments test
pnpm --filter @agenticprimitives/payments build
```
