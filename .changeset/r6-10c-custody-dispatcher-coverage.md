---
"@agenticprimitives-demo/contracts": patch
---

R6.10c — CustodyPolicy action-dispatcher happy paths + remaining
branch families.

Builds on R6.10b. Adds `test/CustodyPolicyDispatcherR610c.t.sol` —
18 tests covering the previously-untested dispatcher actions
(RemoveCustodian, AddPasskeyCredential, RemovePasskeyCredential,
RemoveTrustee, RotateAllCustodians × 4 variants, ApplySystemUpdate,
RotateDelegationManager), the `_verifyQuorum` `UnauthorizedTrustee`
branch, the recovery cancel-window in-vs-out-of-window logic, and
the `_applyRemoveGuardian` `RecoveryRequiresGuardians` /
`TrusteeDoesNotExist` paths.

Coverage after R6.10b + R6.10c combined:
- CustodyPolicy lines: 70.1% → **92.4%** (+22.3pp)
- CustodyPolicy branches: 30.0% → **68.0%** (+38.0pp)
- CustodyPolicy functions: 83.3% → 95.2% (+11.9pp)
- security-critical rollup lines: 82.1% → 90.3%
- security-critical rollup branches: 57.4% → **76.6%** (+19.2pp)
- Overall: 79.0% → 83.1% lines · 60.2% → 70.6% branches

No source changes.
