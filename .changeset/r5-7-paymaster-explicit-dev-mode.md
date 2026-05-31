---
'@agenticprimitives/contracts': minor
---

R5.7 — SmartAgentPaymaster: explicit `devMode_` + `verifyingSigner_`
at construction (P0-2 closure).

### Breaking

- **`SmartAgentPaymaster` constructor signature changed.** Pre-R5.7:
  `constructor(IEntryPoint, address initialOwner, address governance)`.
  Post-R5.7: `constructor(IEntryPoint, address initialOwner, address
  governance, bool devMode_, address verifyingSigner_)`. The implicit
  `_dev = true` default — which silently shipped every fresh deploy
  in accept-all mode — has been removed. Callers must pass both new
  args explicitly. Production: `devMode_=false` + non-zero
  `verifyingSigner_` (or zero for fail-closed allowlist mode).

### Why

External senior-architect audit P0-2: pre-R5.7 the constructor
forcibly set `_dev = true`, so production deploys had to remember
a post-broadcast `setDevMode(false) + setVerifyingSigner(...)` tx.
A forgotten or delayed step would sponsor any arbitrary userOp on
the freshly-deployed network. The construction-time enforcement
removes the race window — production deploys ship fail-closed from
block 1.

### Deploy script changes

- `script/Deploy.s.sol` now computes `paymasterDevMode = _isTestnetNetwork(network)`
  and passes it (plus `PAYMASTER_VERIFYING_SIGNER`) into the constructor.
  Production deploys without a verifying signer print a multi-line
  warning + start in fail-closed allowlist mode. The previous
  step-7 `setVerifyingSigner + setDevMode(false)` block was removed
  (redundant; the constructor handles it).
- `script/DeployPaymaster.s.sol` (incremental deploy) adds env vars
  `PAYMASTER_DEV_MODE` (default `false`) + `PAYMASTER_VERIFYING_SIGNER`
  (default `address(0)`).

### Tests

- 4 new tests in `test/SmartAgentPaymaster.t.sol`:
  - `test_R5_7_constructed_with_devMode_false_starts_in_production_mode`
  - `test_R5_7_constructed_with_verifyingSigner_wires_it_atomically`
  - `test_R5_7_constructed_with_verifyingSigner_emits_event`
  - `test_R5_7_constructed_with_zero_verifyingSigner_does_not_emit`
- 32/32 paymaster tests pass; 540/540 contracts suite green.

### Audit doc

- `PKG-PAYMASTER-002` (new row, R5.7 closure) added under
  `### SmartAgentPaymaster.sol`. `CON-SmartAgentPaymaster-002`
  superseded by this row (was about the missing public getter +
  preflight check; the public `devMode()` getter has been there
  all along and is now also enforced at construction).
