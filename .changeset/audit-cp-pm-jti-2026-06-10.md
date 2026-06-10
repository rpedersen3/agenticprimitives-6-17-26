---
"@agenticprimitives/contracts": patch
"@agenticprimitives/mcp-runtime": patch
---

2026-06-10 audit batch — CP-1/CP-2 (custody), PM-1/PM-2 (paymaster), NEW-MCP-1 (JTI).

Contract + package fixes from the post-NO-GO hardening program. The
`@agenticprimitives/contracts` ABIs move (CustodyPolicy + SmartAgentPaymaster
bytecode changed) — a Base Sepolia redeploy is required to make these enforced
on-chain.

- **CP-1 (Medium)** — `CustodyPolicy.onInstall` now floors unset tiers from the
  spec default-approvals matrix and HARD-REVERTS `UnconfiguredTier(4/5)` for any
  non-single install with the admin/critical tiers unset, so a direct install
  bypassing the factory can't collapse a high tier to 1-of-n. `_approvalsValue`
  fails closed on a T6 read (recovery quorum lives in `recoveryApprovals`).
- **CP-2 (Medium)** — `onInstall` rejects `recoveryApprovals > trusteeCount`
  (an unsatisfiable threshold that would brick the T6 recovery lifeline).
- **PM-1 (Medium)** — `SmartAgentPaymaster._validatePaymasterUserOp` no longer
  reads external governance storage (an ERC-7562 validation-scope violation that
  got sponsored ops dropped by bundlers). It reads an own-storage `_pausedMirror`,
  refreshed out-of-band by `syncPauseFromGovernance()` / `setPauseMirror`.
- **PM-2 (Medium)** — adds a governance-only, 48h-TIMELOCKED deposit-withdrawal
  path (`scheduleDepositWithdrawal` / `executeDepositWithdrawal` /
  `cancelDepositWithdrawal`); the owner→governance handoff for the inherited
  instant `withdrawTo` is documented in the contract's production checklist.
- **NEW-MCP-1 (High)** — **breaking:** `createMemoryJtiStore`'s `environment` is
  now a REQUIRED field, never inferred. The prior `NODE_ENV` fallback resolved to
  `'development'` on Workers/SES (where `process.env` is absent) and silently
  skipped the production refusal, shipping non-durable replay protection. Callers
  must pass `{ environment: 'production' | 'development' }`.
