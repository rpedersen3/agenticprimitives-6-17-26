---
'@agenticprimitives/contracts': patch
---

R6.2 / CON-SUBREGISTRY-003 — `PermissionlessSubregistry` reentrancy
guard.

### Why

Slither flagged `register()` for `reentrancy-no-eth`: the prior-claim
check (`claimedBy[msg.sender] != 0`) was followed by the external
call to `REGISTRY.register(...)` BEFORE the state write
`claimedBy[msg.sender] = childNode`. If the registry (or any resolver
it invokes) re-enters `register()`, the second call passes the
guard because the write hasn't happened yet — letting one caller
claim two names.

Identified by R6.1 contracts hardening recon
(`docs/audits/r6-contracts-recon-2026-05-31.md` § 1.1 / § 4.1).

### Fix

`PermissionlessSubregistry` now inherits from OpenZeppelin's
`ReentrancyGuard`. `register()` carries the `nonReentrant` modifier.

### Tests

- New `test_R6_2_reentrancyGuardBlocksNestedRegister` — uses a
  `MaliciousRegistry` mock whose `receive()` re-enters the
  subregistry. Reentry is blocked.
- New `test_R6_2_sequentialCallsFromDifferentSendersStillWork` —
  confirms the modifier resets between calls.
- 13/13 PermissionlessSubregistry tests pass.
- 547/547 contracts suite green (+2 R6.2 tests).

### Audit doc

`CON-SUBREGISTRY-003` marked CLOSED.

### First implementation PR of the R6 wave

The R6.1 recon doc (`docs/audits/r6-contracts-recon-2026-05-31.md`)
identifies the full wave plan. R6.2 is the small Slither finding.
The headline R6 PR is **R6.5** — wire pause checks into
`AgentAccount` (currently 0 pause checks across 13 mutating
entrypoints).
