# Caveat enforcer registry

**Source of truth:** [`enforcers.json`](./enforcers.json). This page is the human-readable view; the JSON is what CI rails, SDK lint, and future tooling consume.

## What's in here

Every caveat enforcer in agenticprimitives' orbit — those we ship, those we plan, those we're missing relative to MetaMask DTK / smart-agent — with structured metadata: contract address per chain, SDK builder, audit doc, status, DTK parity verdict.

## Status field

| Status | Meaning |
| --- | --- |
| `shipped` | Contract deployed on at least one supported chain; SDK builder exported; AUDIT.md exists. |
| `planned` | Spec exists; contract + SDK in flight or queued for a specific phase. |
| `gap` | DTK or smart-agent has it; we don't, and no work is queued yet. |
| `divergent` | We deliberately diverge from DTK on this primitive (e.g. QuorumEnforcer is ours-only). |
| `sentinel-footgun` | SDK exports a builder pointing at a non-deployed sentinel address. Would revert at redeem. Cleanup or contract delivery required. |

## Current snapshot (auto-generated section)

<!--
This table is regenerated from `enforcers.json` by `scripts/generate-enforcer-registry.ts`.
DO NOT edit by hand — edit `enforcers.json` instead.
-->

| Name | Status | Category | DTK parity | Chain (Base Sepolia) |
| --- | --- | --- | --- | --- |
| TimestampEnforcer | shipped | time | match | `0x81AB5167…` |
| AllowedTargetsEnforcer | shipped | scope | match | `0x4D00295D…` |
| AllowedMethodsEnforcer | shipped | scope | match | `0xdE873dEa…` |
| ValueEnforcer | shipped | value | match | `0x49F0B31b…` |
| QuorumEnforcer | shipped | auth | divergent (ours-only) | `0x3418A529…` |
| ArgumentRuleEnforcer | planned | argument | subsumes 4 DTK enforcers | (not yet deployed) |
| RateLimitEnforcer | gap | rate | DTK LimitedCallsEnforcer is the partial equivalent | — |
| MCP_TOOL_SCOPE_ENFORCER | sentinel-footgun | scope | n/a | — (sentinel) |
| DATA_SCOPE_ENFORCER | sentinel-footgun | scope | n/a | — (sentinel) |
| DELEGATE_BINDING_ENFORCER | sentinel-footgun | binding | n/a | — (sentinel) |
| AllowedCalldataEnforcer | gap | argument | DTK has it; subsumed by spec 208's ArgumentRuleEnforcer | — |
| ERC20TransferAmountEnforcer | gap | argument | DTK has it; subsumed by spec 208 | — |
| ERC20BalanceChangeEnforcer | gap | balance | DTK has it; phase 8 | — |
| LimitedCallsEnforcer | gap | rate | DTK has it; phase 7 | — |
| BlockNumberEnforcer | gap | time | DTK has it; low priority | — |
| DeployedEnforcer | gap | scope | DTK has it; low priority | — |
| IdEnforcer | divergent | replay | We use salt + isRevoked instead of DTK's per-id flag | — |

## How to add a new enforcer

1. Land the spec (`specs/2XX-<feature>.md`) describing the new caveat shape + threat model.
2. Implement `apps/contracts/src/enforcers/<Name>Enforcer.sol`.
3. Write `apps/contracts/src/enforcers/<Name>Enforcer.AUDIT.md` (per-enforcer audit page; see template at bottom of this doc).
4. Add SDK builder in `packages/delegation/src/caveats.ts` + export.
5. Add entry to `enforcers.json` with status `planned` (during impl) → `shipped` (after deploy + audit landed).
6. Update `apps/contracts/deployments-<network>.json` with the deployed address.
7. Run `pnpm check:enforcer-registry` — catches drift between source / SDK / manifest / deployments JSON / audit pages.
8. Run `pnpm check:sentinel-enforcers` — catches any sentinel-only exports that would revert at redeem.

## How sentinel-footguns are caught

The `pnpm check:sentinel-enforcers` rail walks `enforcers.json`, picks every entry with `status === 'sentinel-footgun'`, and either (a) verifies the corresponding SDK export is gated behind a deprecation warning, or (b) fails the build until the entry is moved to `gap` (intent: don't ship) or `planned` (intent: ship soon, contract incoming).

This prevents a regression where someone adds a new sentinel-only enforcer without realizing it'll revert at redeem time.

## Per-enforcer audit pages

Each `shipped` enforcer has an `AUDIT.md` co-located with the source: `apps/contracts/src/enforcers/<Name>.AUDIT.md`. The page covers:

- charter (what THIS enforcer does, what it doesn't)
- security invariants
- threat model + findings
- test posture
- DTK / smart-agent parity notes

This mirrors the per-package `AUDIT.md` convention. The registry's `auditPath` field links each shipped enforcer to its audit page.

## Template — per-enforcer AUDIT.md

```markdown
# `<Name>Enforcer` — Security & Architecture Audit

**Status:** alpha | beta | shipped
**Last refreshed:** YYYY-MM-DD
**Owners:** delegation package CODEOWNERS + apps/contracts CODEOWNERS
**Registry entry:** `docs/architecture/enforcer-registry/enforcers.json` (entry: `<Name>Enforcer`)
**Spec reference:** `specs/2XX-…`

## 1. Charter
One paragraph: what this enforcer constrains; what it does NOT touch.

## 2. Security invariants
Bullet list of "if this enforcer doesn't enforce X, the trust model breaks."

## 3. Threat model
Table: threat | likelihood | impact | mitigation | status.

## 4. DTK / smart-agent parity
One paragraph each:
  - DTK equivalent (if any) + parity verdict
  - smart-agent equivalent (if any) + porting notes

## 5. Test posture
Coverage summary. Forge test count. Property tests if any. Fixture corpus if any.

## 6. Open findings
Table: ID | severity | finding | status. Empty for low-risk enforcers.

## 7. Cross-references
- Registry entry
- Per-package AUDIT.md that depends on this enforcer
- Specs that motivate the design
```

## Why this exists

- DTK alignment audit (`docs/architecture/dtk-alignment-audit.md`) found 14 enforcers in the wider landscape; we ship 5. The audit is prose — fine for reading once, useless as a programmatic source of truth.
- Spec 207 + 208 + future enforcer specs each touch some subset of these contracts. Without a registry, status across specs drifts.
- The SDK currently exports 3 sentinel-only enforcers (`MCP_TOOL_SCOPE_ENFORCER`, `DATA_SCOPE_ENFORCER`, `DELEGATE_BINDING_ENFORCER`) — these would revert at redeem because no contract is deployed at those addresses. Audit § 5.5 flagged this as a "demo footgun"; the lint rail backed by this registry catches it.
- Permission-card rendering (phase 7+) is going to consume this registry to turn caveats into human-readable summaries — "this delegation lets the agent call USDC.transfer to {addr,addr}, ≤100 USDC, 50 times" reads off the enforcer + its decoded terms.

## See also

- [`docs/architecture/dtk-alignment-audit.md`](../dtk-alignment-audit.md) — the prose audit this registry structures.
- [`specs/202-delegation.md`](../../../specs/202-delegation.md) — delegation core.
- [`specs/208-argument-level-caveats.md`](../../../specs/208-argument-level-caveats.md) — the ArgumentRuleEnforcer spec.
- [`packages/delegation/AUDIT.md`](../../../packages/delegation/AUDIT.md) — per-package audit that references this registry.
