# Cross-cutting capabilities — routing index

A **cross-cutting capability** is a product-shaped feature that threads through ≥ 3 packages and carries its own threat model or invariants. Multi-sig and the audit/forensics trail are the current examples; treasury, recovery UX, and argument-level caveats are queued.

This file is **routing-only.** No content lives here — every row links out to (a) the architect's spec, (b) the canonical demo guide co-located with the implementation, and (c) the participating packages' `CLAUDE.md` files where the per-package "Capabilities this package participates in" section names the same capability.

The CI rail [`scripts/check-cross-cutting-capabilities.ts`](../../scripts/check-cross-cutting-capabilities.ts) walks this index every build and fails if any of those four artifacts is missing or broken.

## When does a feature qualify as cross-cutting?

All three must hold:

1. **Product-shaped** — a user can name it ("multi-sig," "audit trail," "treasury" — not "the way we handle nonces").
2. **Touches ≥ 3 packages** at non-trivial interface points.
3. Has its **own threat model or invariants** that are easier to reason about together than per-package.

Below the threshold: one-page convention doc or live in `CLAUDE.md`. The four-artifact treatment is reserved for things needing a coherent architect's story.

## The four artifacts (per capability)

| # | Where | Audience |
| --- | --- | --- |
| 1 | `specs/2XX-<capability>.md` | Architects + reviewers |
| 2 | `apps/<canonical-demo>/docs/<capability>/guide.md` | Adopters writing their own code |
| 3 | This file (index row) | Anyone exploring top-down |
| 4 | Per-package `CLAUDE.md` → "Capabilities this package participates in" | Package-focused contributors + Claude when working inside a package |

## Index

| Capability | Spec | Demo guide | Participating packages | Status |
| --- | --- | --- | --- | --- |
| **Multi-sig + threshold policy** | [`specs/207`](../../specs/207-smart-account-threshold-policy.md) (product surface) + [`specs/209`](../../specs/209-erc7579-module-taxonomy.md) (impl architecture) | [`apps/demo-web-pro/docs/multi-sig/guide.md`](../../apps/demo-web-pro/docs/multi-sig/guide.md) | `agent-account`, `delegation`, `tool-policy`, `audit`, `mcp-runtime` | Mostly closed (phase 6c) — contract + SDK + runtime shipped. Live wiring blocked on phase 6c.5-d (ERC-7579 module decomposition — extract `ThresholdValidator` + `GuardianRecoveryValidator` from core to fit EIP-170). 2 enforcers (`QuorumEnforcer`, `ApprovedHashRegistry`) already deployed to Base Sepolia. |
| **Audit / forensics trail** | [`specs/206`](../../specs/206-audit.md) | [`apps/demo-mcp/docs/audit/guide.md`](../../apps/demo-mcp/docs/audit/guide.md) | `audit`, `mcp-runtime`, `delegation`, `key-custody` | Closed (phase 5g) |
| **DTK interop + caveat enforcer registry** | [`docs/architecture/dtk-alignment-audit.md`](dtk-alignment-audit.md) (audit) + [`specs/208`](../../specs/208-argument-level-caveats.md) (next enforcer) + [`docs/architecture/enforcer-registry/`](enforcer-registry/) (canonical registry) | TBD — likely `apps/demo-web-pro/docs/interop/guide.md` when first DTK-tooling consumer wires up | `delegation`, contracts (per-enforcer AUDIT.md files at `apps/contracts/src/enforcers/<Name>.AUDIT.md`), `tool-policy` (T3+ delegations should carry argument-level caveats) | In-flight (phase 6b.1) — audit + registry + per-enforcer AUDIT.md shipped 2026-05-21. `pnpm check:sentinel-enforcers` CI rail prevents new sentinel-only SDK exports. Remaining: ArgumentRuleEnforcer (spec 208 impl), interop fixture corpus (phase 7), permission-card renderer (phase 7). |

## Queued

These will earn rows once their specs land:

- **Treasury** — spec TBD; phase 6e; demo home: `apps/demo-web-pro/docs/treasury/`. Depends on multi-sig + recovery.
- **Recovery UX** — phase 7; demo home: `apps/demo-web-pro/docs/recovery/`. Substrate already in spec 207 § 8.
- **Argument-level caveats** — [`specs/208`](../../specs/208-argument-level-caveats.md) (now drafted; ArgumentRuleEnforcer impl pending phase 6c.6); demo home: TBD between `apps/demo-mcp` (server-side enforcement) and `apps/demo-web-pro` (permission-card UX). Tracked under the **DTK interop + caveat enforcer registry** capability row above.

## How to add a new capability

1. **Spec lands first** — `specs/2XX-<capability>.md`. Treat the doctrine "spec-first for non-trivial architecture" as load-bearing.
2. **Decide the canonical demo app** — typically `apps/demo-web-pro` for user-facing capabilities, `apps/demo-mcp` for server-side enforcement, occasionally a new `apps/demo-*` if the demo is genuinely distinct.
3. **Add the demo guide** at `apps/<demo>/docs/<capability>/guide.md`. The guide is the developer tutorial — "I want to use this in my app." Per-use-case walkthroughs live as siblings at `apps/<demo>/docs/<capability>/flows/<use-case>.md`.
4. **Add the row to this index.**
5. **Update each participating package's `CLAUDE.md`** with a "Capabilities this package participates in" entry pointing back to the spec + demo guide.
6. **Run `pnpm check:cross-cutting-capabilities`** locally — it'll catch missing artifacts before CI does.

## How to remove a capability

If a capability is deprecated, gated to "won't fix," or merged into another:

1. Delete the row here.
2. The CI rail won't *require* removal of the demo guide + per-package sections (they may still be true for the current code), but contributors should clean those up in the same PR.
3. The spec stays as historical artifact — append a status note ("Status: deprecated 2026-12-XX; superseded by spec NNN").
