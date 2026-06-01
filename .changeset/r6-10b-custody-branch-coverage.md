---
"@agenticprimitives-demo/contracts": patch
---

R6.10b — CustodyPolicy branch-coverage push.

Closes R6.9's secondary security-critical gap: CustodyPolicy at
30.0% branches. Adds `test/CustodyPolicyBranchR610b.t.sol` — 32 tests
exercising the schedule/apply/cancel error branches, view-revert
InvalidTier paths, effective-tier early-return branches, the rarer
action dispatcher cases (RotatePaymaster/RotateSessionIssuer stubs,
ChangeValueCeiling, SetRecoveryApprovals), and the handler error
branches (ZeroAddress, TrusteeAlreadyExists, CannotDowngradeWithTrustees,
InvalidMode, EmptyOwnerSet, InvalidThresholdValue).

Coverage after R6.10b:
- CustodyPolicy lines: 70.1% → **81.4%** (+11.3pp)
- CustodyPolicy branches: 30.0% → **53.0%** (+23.0pp)
- CustodyPolicy functions: 83.3% → **92.9%** (+9.6pp)
- security-critical rollup branches: 57.4% → **70.1%** (+12.7pp)
- Overall: 79.0% → 81.1% lines · 60.2% → 67.1% branches

No source changes.
