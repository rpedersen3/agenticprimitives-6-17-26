# @agenticprimitives/agent-account

## 1.0.0-alpha.6

### Patch Changes

- @agenticprimitives/types@1.0.0-alpha.6
- @agenticprimitives/connect-auth@1.0.0-alpha.6

## 1.0.0-alpha.5

### Patch Changes

- @agenticprimitives/types@1.0.0-alpha.5
- @agenticprimitives/connect-auth@1.0.0-alpha.5

## 1.0.0-alpha.4

### Minor Changes

- 53156b5: R5.12c — Add `AgentAccountClient.assertSaMatchesCustodianDerivation`
  for sponsored-deploy invariant gating (PKG-AGENT-ACCOUNT-005 closure).

  ### New API

  ```ts
  import { AgentAccountClient, SaMismatchError } from '@agenticprimitives/agent-account';

  // In a relying broker (e.g. demo-a2a /session/direct-deploy):
  const verifiedWallet = recoverSiweAddress(...);

  try {
    await client.assertSaMatchesCustodianDerivation({
      claimed: body.smartAccountAddress, // CLIENT-SUPPLIED target
      custodians: [verifiedWallet],      // BROKER-COMPUTED from verified credential
    });
  } catch (e) {
    if (e instanceof SaMismatchError) {
      return c.json({ error: 'sa-mismatch', detail: e.message }, 400);
    }
    throw e;
  }

  // Past this point the broker is guaranteed `body.smartAccountAddress`
  // is the canonical SA for `verifiedWallet`. Safe to sponsor the deploy.
  ```

  ### Why

  Relying brokers that sponsor an SA deploy (or sign an action for a
  client-supplied target) had no package-level helper to verify the
  client's claimed target is the canonical derivation from the
  verified credential. Demo-a2a's `/session/direct-deploy` (and the
  Google×KMS bootstrap in demo-sso-next, spec 235) deploy a
  `body.smartAccountAddress` chosen by the client — a financial DoS
  when the broker pays gas.

  `assertSaMatchesCustodianDerivation` is THE gate primitive.

  ### Behaviour
  - Computes the deterministic SA address via the existing
    `getAddressForAgentAccount(spec)` (factory CREATE2 view).
  - Case-insensitive comparison (checksum-agnostic).
  - Defaults to the canonical SIWE-only mode: `mode = 0`, `salt = 0n`,
    no trustees, no passkey.
  - Overrides for `mode` / `salt` / `trustees` / `passkey` are
    first-class opts for multisig / passkey-direct / custom-salt flows.
  - Returns the verified address on match.
  - Throws `SaMismatchError` on mismatch with `{ claimed, derived, spec }`
    fields for forensics.

  ### New exports
  - `SaMismatchError` class
  - `AgentAccountClient.assertSaMatchesCustodianDerivation` method

  ### Tests

  8 new R5.12c tests in `test/unit/sa-derivation-invariant.test.ts`:
  - happy path (claim matches derivation)
  - case-insensitive claimed address
  - mismatch throws `SaMismatchError`
  - error carries `claimed` / `derived` / `spec` for forensics
  - default spec is `mode = 0`, `salt = 0n`
  - non-default overrides (`mode = 2`, custom `salt`, multi-custodian)
    honoured
  - financial-DoS scenario: client supplies target derived from a
    different custodian → rejected
  - correct-claim happy path round-trip

  67/67 agent-account tests pass (+8 R5.12c).

  ### Companion

  This is the **third** of three package additions in the relayer-pattern
  pivot:
  - **R5.12a** — `createRelayerAccount` (PKG-KEY-CUSTODY-009)
  - **R5.12b** — `createSpendCappedAccount` (PKG-KEY-CUSTODY-010)
  - **R5.12c** — `assertSaMatchesCustodianDerivation` (this — PKG-AGENT-ACCOUNT-005)
  - **R5.12d** — demo-a2a migrates 4 callsites onto a, b, c (app-only follow-up)

### Patch Changes

- Updated dependencies [4c1f3dd]
- Updated dependencies [20a20de]
  - @agenticprimitives/connect-auth@1.0.0-alpha.4
  - @agenticprimitives/types@1.0.0-alpha.4

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

- Updated dependencies [4dde508]
  - @agenticprimitives/types@0.1.0-alpha.3
  - @agenticprimitives/connect-auth@0.1.0-alpha.3

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

- Updated dependencies
  - @agenticprimitives/types@0.1.0-alpha.2
  - @agenticprimitives/connect-auth@0.1.0-alpha.2
