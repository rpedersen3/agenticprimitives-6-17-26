---
'@agenticprimitives/contracts': patch
---

R6.3 — Slither inline suppress comments + Aderyn CI integration.

### Why

R6.1 recon § 1.2 + § 1.4 triaged 9 Slither warnings as intentional
patterns / false positives:

- 7× `unused-return` on `ECDSA.tryRecover` (third return value
  `sigVersion` discarded by design — the `err` discriminant + the
  explicit `recovered == expected` comparison IS the auth)
- 2× `incorrect-equality` on `registeredAt == 0` /
  `createdAt == 0` (sentinel storage-default checks; not numeric
  precision concerns)

Each was correct behaviour but the noise made it harder to spot a
real future regression. R6.3 documents them inline.

### Slither suppress comments

7 ECDSA `tryRecover` sites annotated with
`// slither-disable-next-line unused-return` + 1-line R6.3
justification:

- `packages/contracts/src/AgentAccount.sol` (4 sites:
  `_verifyEcdsa` ×2, `_verifySignerEcdsa` ×2)
- `packages/contracts/src/UniversalSignatureValidator.sol`
  (`_ecdsaRecover` ×2)
- `packages/contracts/src/SmartAgentPaymaster.sol`
  (`_validatePaymasterUserOp` ×1)

Sentinel-equality annotations:

- `packages/contracts/src/naming/AgentNameRegistry.sol`
  (`setPrimaryName`): inline `// slither-disable-next-line incorrect-equality`
- `packages/contracts/src/relationships/AgentRelationship.sol`
  (7 occurrences of `e.createdAt == 0`): contract-scope
  `slither-disable-start incorrect-equality` /
  `slither-disable-end` wrapper with a clear comment block
  explaining the sentinel idiom.

### Aderyn CI integration

New `aderyn` job in `.github/workflows/security.yml` runs alongside
the existing `slither` job. Aderyn (Cyfrin's AI-first Solidity
scanner) catches a different rule pack — combining both gives
broader coverage of the Solidity surface.

- Installed from the upstream release tarball (no third-party
  action; supply-chain surface stays small).
- Non-blocking by design (`continue-on-error: true`) — Aderyn's
  detector pack is still evolving and a noisy report shouldn't
  block PRs while the triage policy stabilises.
- Report uploaded as a CI artifact (`aderyn-report.md`).
- Once the false-positive rate is known we flip to `fail-on: high`.

### Tests

No functional changes — comments only. 544/545 full suite green
(only failure: pre-existing R5.9 env-bleed in
`DeployAuthorityResolution.t.sol`).

### Audit doc

Updated the "Missing — CodeQL for Solidity" CI-posture row to
PARTIAL CLOSED: two independent Solidity SAST scanners
(Slither + Aderyn) now run in CI.

### Closes

- All 22 Slither alerts triaged (1 closed by R6.2 reentrancy fix; 9
  by R6.3 suppress comments; 12 false-positive `uninitialized-local`
  remain documented for R6.4 cleanup).
- CON-CI-001 (architectural intent: multiple Solidity SAST) —
  partial.
