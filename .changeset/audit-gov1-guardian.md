---
"@agenticprimitives/contracts": patch
---

GOV-1 — guardian role is timelock-rotatable (2026-06-10 audit).

`AgenticGovernance.guardian` moved from `immutable` to a storage var the timelock
can rotate via `setGuardian` (onlyTimelock, non-zero). A compromised guardian
that perpetually re-pauses the system can now be replaced after one timelock
window WITHOUT a governance redeploy — the DoS is bounded, not permanent.
Bytecode changed → batches into the pending Base Sepolia redeploy.
