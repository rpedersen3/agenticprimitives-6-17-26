# Multi-sig + threshold policy — developer guide

This is the tutorial for adopting agenticprimitives' multi-sig surface in your own app. It pairs with [spec 207](../../../../specs/207-smart-account-threshold-policy.md), which is the architect's design doc — read the spec first if you need the threat model, invariants, or rationale; read this guide if you need to know which calls to make.

The canonical implementation that this guide walks through lives in `apps/demo-web-pro/src/flows/`. Each per-use-case page under `flows/` corresponds to a route in the demo app — you can run the demo, click through the flow, and read the matching guide alongside the actual code.

> **Status:** stub. Sub-pages will be written as the corresponding implementation phases land (6c.2-c, 6c.3, 6c.4). This stub exists today so the cross-cutting-capabilities CI rail has its artifact + so contributors writing 6c.2-c know where to anchor their docs.

## Doctrine in 30 seconds

- **Multi-sig is safety + recovery, not a "ceremony."** Users see "approvals required" and "backup signer," not "sign hash."
- **`hybrid` is the default consumer mode.** `single` is demo-only. The flow always prompts users to add a backup signer immediately after account deploy.
- **One `AgentAccount` substrate, explicit policy modes.** The same contract runs all four modes (`single` / `hybrid` / `threshold` / `org`); what changes is the policy state.
- **Threshold=1 is the trivial case, not a separate code path.**

See the [safety + recovery doctrine memory](../../../../specs/207-smart-account-threshold-policy.md#doctrine-multi-sig-is-safety--recovery-not-a-ceremony) for the full background.

## What you'll build by following this guide

A web app that:

1. Connects a wallet (MetaMask + EIP-6963; passkey too)
2. Creates an `AgentAccount` in `hybrid` mode (EOA primary + passkey backup)
3. Issues a T1-Read delegation (1-of-1 — the trivial case)
4. Issues a T3-Value delegation (threshold + on-chain `acceptSessionDelegation`)
5. Proposes + executes a T4 admin action (`AddOwner`)
6. Adds a guardian + runs a recovery flow

## Per-use-case walkthroughs

Each page walks through one of the five canonical use cases from spec 207 § 4.1. Code references in the walkthroughs link directly to `apps/demo-web-pro/src/flows/<use-case>/`.

- [`flows/hybrid-recovery.md`](flows/hybrid-recovery.md) — *stub.* Use case 1: individual user, seamless recovery. Adds a backup passkey, flips mode `single → hybrid`.
- [`flows/threshold-approval.md`](flows/threshold-approval.md) — *stub.* Use case 2: high-risk agent delegation. T3-Value with caveats + on-chain blessing.
- [`flows/org-treasury.md`](flows/org-treasury.md) — *stub.* Use case 3: org treasury. `org` mode + per-action threshold + timelocked admin.
- [`flows/steward-attenuation.md`](flows/steward-attenuation.md) — *stub.* Use case 4: steward → agent attenuation (cross-delegation; spec 207 § 11 + future spec).
- [`flows/recovery.md`](flows/recovery.md) — *stub.* Use case 5: lost device recovery. Multi-passkey + guardian quorum + timelock + cancel window.

## SDK quick reference

The multi-sig surface threads through these packages — none of them advertise a "multi-sig API." The threshold/quorum concepts are first-class within the existing primitives.

```ts
// Account-side: thresholds, admin actions, recovery.
import { AgentAccountClient } from '@agenticprimitives/agent-account';
// (in 6c.3) Owner-set signature aggregation:
//   client.packSafeSignatures([sig1, sig2, ...]);
// (in 6c.3) Admin actions:
//   client.proposeAdmin({ action, args, signers });
//   client.executeAdmin({ proposalId, signers });

// Delegation-side: quorum caveats + verify integration.
import {
  buildQuorumCaveat,           // (lands in 6c.3)
  mintDelegationToken,
  verifyDelegationToken,
} from '@agenticprimitives/delegation';

// Tool-policy: risk tiers + policy decision.
import {
  evaluatePolicy,
  Tier,                        // (lands in 6c.3)
  RISK_TIER_REQUIREMENTS,      // (lands in 6c.3)
} from '@agenticprimitives/tool-policy';
```

## Threshold defaults

| N owners | T1 Read | T2 Write | T3 Value | T4 Admin | T5 Critical | T6 Recovery |
| --- | --- | --- | --- | --- | --- | --- |
| 2 | 1 | 2 | 2 | 2 | 2 | majority of guardians |
| 3 | 1 | 2 | 2 | 3 | 3 | majority of guardians |
| 5 | 1 | 3 | 3 | 4 | 5 | majority of guardians |
| 7 | 1 | 4 | 4 | 5 | 6 | majority of guardians |

Source of truth: spec 207 § 5.1. The factory installs these defaults at deploy; users can override via `createAccount*` parameters or post-deploy via a T5 `SetThreshold` admin action.

## What this guide doesn't cover

- **Permission-card UX** — phase 7 work. See [spec 207 § 13 open follow-ups](../../../../specs/207-smart-account-threshold-policy.md#13-resolved-decisions--open-follow-ups).
- **Argument-level caveats** (token / recipient / per-call value predicates) — drafting in spec 208.
- **Cross-chain account semantics** — spec 207 binds all signatures to `(address(this), chainid)`; cross-chain is out of scope for v0.

## Related capability

- **Audit / forensics trail** — every signing + delegation op emits an audit row. See [`apps/demo-mcp/docs/audit/guide.md`](../../../demo-mcp/docs/audit/guide.md). When you wire multi-sig, the same correlation IDs stitch threshold-approval flows across services.
