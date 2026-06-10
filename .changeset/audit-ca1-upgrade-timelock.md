---
"@agenticprimitives/contracts": patch
---

CA-1 — AgentAccount upgrade timelock is now enforced (2026-06-10 audit).

The per-account upgrade timelock was dead code (set via `setUpgradeTimelock` but
never consulted — `_authorizeUpgrade` was an empty `onlySelf` and the only
`_pendingUpgrade` writer reverted), so a direct `upgradeToAndCall` fired
immediately. Now:
- `scheduleUpgrade(newImpl)` (onlySelf) is the production queue writer; the
  matured upgrade is applied via `executePendingUpgrade`.
- `_authorizeUpgrade` reverts `DirectUpgradeBlocked` when a timelock is set and
  the call is not an authorized context.
- **Simple-path only:** a transient `_upgradeAuthorizedCtx` exempts the
  custody-module path (`CustodyPolicy.ApplySystemUpdate`, which has its own T5
  quorum + timelock) so there is no double delay.

AgentAccount bytecode changed → batches into the pending Base Sepolia redeploy.
