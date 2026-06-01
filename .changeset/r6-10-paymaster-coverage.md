---
"@agenticprimitives-demo/contracts": patch
---

R6.10 — SmartAgentPaymaster validation-path coverage push.

Adds `test/SmartAgentPaymasterValidateR610.t.sol` (20 tests) that
exercise `_validatePaymasterUserOp` via real `validatePaymasterUserOp`
calls (using `vm.prank(address(ep))` to satisfy
BasePaymaster's `_requireFromEntryPoint` gate).

R6.9 surfaced SmartAgentPaymaster at 50.9% lines / 22.2% branches —
below the 70% security-critical floor. The pre-existing tests
asserted off-chain hash recovery sanity but never exercised the
validation body's branches.

Coverage after R6.10:
- SmartAgentPaymaster lines: 50.9% → **98.2%** (+47.3pp)
- SmartAgentPaymaster branches: 22.2% → **100%** (+77.8pp)
- security-critical rollup: 82.1% → 85.1% lines, 57.4% → 63.2% branches
- Overall: 79.0% → 80.5% lines, 60.2% → 63.3% branches

Branches now exercised: dev-mode short-circuit (× 2), pause revert
+ recovery + EOA-governance skip, verifying-mode happy-path
validationData packing, malformed-length revert (× 2), wrong-signer
revert, zero-sig + garbage-sig recover-error revert, allowlist
accept + reject + revoke, EntryPoint gate, EntryPoint-binding +
chainId binding in `getHash`, `_postOp` no-op, validUntil=0 and
validUntil=max bit-packing round-trip.

No source changes.
