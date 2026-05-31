# @agenticprimitives/contracts

## 1.0.0-alpha.4

### Minor Changes

- efd2927: R5.7 — SmartAgentPaymaster: explicit `devMode_` + `verifyingSigner_`
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

- 524d311: R5.9 — Per-role authority addresses in `Deploy.s.sol` (P0-1 extension).

  ### Why

  External senior-architect audit P0-1 wanted role separation in the
  deploy script. R5.4 collapsed every governance / admin / ownership
  role onto a single `GOVERNANCE_MULTISIG` address, which closed the
  deployer-aggregation failure mode but left every role co-located on
  the same multisig. R5.9 adds per-role env vars so an operator can
  point each role at a distinct multisig.

  ### Per-role env-var matrix

  Each unset env var falls back to the resolved `authority` (so the
  R5.4 single-multisig flow keeps working when no role env vars are
  set):

  **Multisig-shaped (contract required on production):**
  - `TIMELOCK_ADMIN`
  - `TIMELOCK_PROPOSER`
  - `TIMELOCK_EXECUTOR`
  - `GOVERNANCE_GUARDIAN`
  - `GOVERNANCE_SIGNER`
  - `PAYMASTER_OWNER`
  - `NAMING_ROOT_OWNER`
  - `ONTOLOGY_ADMIN`
  - `SHAPE_ADMIN`
  - `RELATIONSHIP_TYPE_ADMIN`

  **EOA-shaped hot keys (R5.4 existing):**
  - `BUNDLER_SIGNER`
  - `SESSION_ISSUER`

  ### Implementation
  - New `Roles` struct bundles every distinct on-chain role.
  - New `_resolveContractRole(roleName, defaultAuth, network)` helper
    enforces `.code.length > 0` on production networks for multisig-
    shaped roles. Misconfigured env vars (pointing at an EOA on
    mainnet) revert with a clear `Deploy: <ROLE> must be a contract
on production networks (Smart Agent / Safe / Timelock)` message.
  - New `_resolveEoaRole(roleName, defaultAuth)` helper for hot keys
    (no contract check).
  - Existing `_resolveBundlerSigner` and `_resolveSessionIssuer`
    refactored to call the new EOA helper.

  ### Tests

  5 new R5.9 tests in `test/DeployAuthorityResolution.t.sol`:
  - env-set-with-contract returns env on production
  - env-unset returns default
  - env-set-with-EOA rejected on production
  - env-set-with-EOA accepted on testnet
  - every role string round-trips via the resolver

  545/545 contracts suite green (was 540; +5 R5.9 tests).

  ### Backwards compatibility

  Operators who don't need role separation: nothing changes. Leave the
  new env vars unset and everything routes to `GOVERNANCE_MULTISIG`
  (R5.4 behavior preserved).

## 0.1.0-alpha.3

### Patch Changes

- 4dde508: R4.9 verification — first publish via OIDC Trusted Publishing.

  No code changes — this prerelease bump only exists to exercise the new
  auth path end-to-end. After this lands at `0.1.0-alpha.3` on npm via the
  Release workflow's `Publish via changesets` step, R4 is fully verified:
  - permissions.id-token: write produces a Sigstore OIDC token
  - changesets/action delegates to pnpm publish
  - pnpm publish authenticates to registry.npmjs.org via that token
  - npm matches the token against the `npm trust github` configuration
    landed in R4.7 (workflow file = `release.yml`, repo =
    `agentictrustlabs/agenticprimitives`, permission = `publish`)
  - Sigstore provenance attestation is signed by the same OIDC token
    and published to the transparency log
  - Per-package CycloneDX SBOM is attached to the GH Release

  Rollback path (if the publish step fails): the bootstrap publishes
  landed at `0.1.0-alpha.2`, so consumers on that pin stay frozen. The
  `NPM_TOKEN` repo secret can be re-set + the env line re-added to
  `release.yml` to revert R4.8.

## 0.1.0-alpha.2

### Minor Changes

- R1 — CROSS-STACK-001 closure + storage-layout snapshot gate.

  ### Breaking
  - **`DelegationManager.DELEGATION_TYPEHASH` byte value changed.** The
    contract previously hashed the non-standard EIP-712 type string
    `Delegation(...,bytes32 caveatsHash,...)` (inlining a precomputed
    caveats digest). It now hashes the canonical EIP-712 form
    `Delegation(...,Caveat[] caveats,...)Caveat(address enforcer,bytes terms)`
    to converge with the off-chain `DELEGATION_EIP712_TYPES` used by
    `@agenticprimitives/delegation` + viem. Any signature minted against
    the pre-R1 typehash (`0xac5469bad161df7c56017782e0a87a91008dbe46dacd5eb42e48e7f4b4fc4e39`)
    will not verify against the post-R1 typehash
    (`0x52f4b7596c22f77177e8e563e6502ad014a696bfc92f9c6cabcaf5738c4ed265`).
    Cross-stack signatures now round-trip (off-chain → on-chain) without
    bespoke re-hashing.

  ### Added
  - `pnpm check:storage-layouts` — snapshot gate over `AgentAccount`,
    `CustodyPolicy`, `DelegationManager`, `SmartAgentPaymaster`. Locks
    slot/offset/type for each storage variable. Drift fails CI.

  ### Notes
  - Forge test `test_DELEGATION_TYPEHASH_is_a_known_constant` and the
    TS-side `cross-stack-typehashes` integration test independently lock
    the converged typehash byte value.
  - Audit row `CROSS-STACK-001` + `XCON-003` + `CON-AgentAccount-003`
    closed in `docs/audits/2026-05-packages-contracts-production-readiness.md`.
  - Released as `0.1.0-alpha.2` (changeset pre-mode reentered).
