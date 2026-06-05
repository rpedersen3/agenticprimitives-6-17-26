# @agenticprimitives/mcp-runtime

## 1.0.0-alpha.5

### Minor Changes

- 5475cf9: R8.1 — closed ATL-SEC-02 (policy-by-convention → hard invariant) on
  `withDelegation`'s production-strict gate.

  Wave H1 made the wrapper production-by-default at RUNTIME (throws at
  construction time if `classification` or `auditSink` is missing). R8.1
  converts that runtime gate into a TYPE-LEVEL invariant via two public
  overloads:
  - `ProductionWithDelegationOpts` — `classification` + `auditSink` REQUIRED
    (the canonical shape for production code).
  - `DevelopmentWithDelegationOpts` — `developmentMode: true` REQUIRED to
    explicitly opt out of the strict gate.

  Existing call sites are unaffected: demo-mcp's three handlers already
  pass `classification + auditSink + environment`, and the type system
  routes them to the production overload. Tests that previously omitted
  opts now require an explicit `{ developmentMode: true }`.

  Runtime checks remain as defense-in-depth (consumers can still `as any`
  past the type system). The audit's gap was the TYPE — not the runtime.

  New public exports:
  - `WithDelegationOpts` (union)
  - `ProductionWithDelegationOpts`
  - `DevelopmentWithDelegationOpts`

### Patch Changes

- @agenticprimitives/types@1.0.0-alpha.5
- @agenticprimitives/audit@1.0.0-alpha.5
- @agenticprimitives/key-custody@1.0.0-alpha.5
- @agenticprimitives/delegation@1.0.0-alpha.5
- @agenticprimitives/tool-policy@1.0.0-alpha.5

## 1.0.0-alpha.4

### Minor Changes

- 6337c17: R5.8 — `verifyDelegationForResource` production gate (P0-3 closure).

  ### Breaking
  - **`verifyDelegationForResource` signature changed.** Pre-R5.8:
    `(token, config, ctx?: { toolName?, timestamp? })`. Post-R5.8:
    `(token, config, opts?: VerifyDelegationForResourceOpts)`, where
    `VerifyDelegationForResourceOpts` mirrors `withDelegation` opts:
    `{ toolName, timestamp, classification, auditSink, correlationId,
metricsSink, traceparent, environment, developmentMode, quorumProof }`.

  ### Why

  External senior-architect audit P0-3: the pre-R5.8 helper called
  `verifyDelegationToken` with only signature/audience/JTI inputs,
  skipping the entire production policy layer that `withDelegation`
  enforces — no threshold-policy decision, no policy engine, no
  audit trail, no quorum gate. A consumer that used this helper
  instead of the wrapper got a silent policy-bypass discount.

  ### New behaviour
  - **Construction-time gate (audit H1):** in production mode,
    missing `classification` or `auditSink` THROWS with the same
    remediation message as `withDelegation`.
  - **Threshold-policy gate (audit H3):** when `classification` is
    set, `evaluateThresholdPolicy` derives `requireQuorumCaveat` and
    `requireAcceptedOnChain` and threads them into the verifier.
  - **Classification policy gate (audit H2):** post-verify,
    `evaluatePolicy` runs the classification decision; `deny` and
    `requires-consent` (unless satisfied by on-chain blessing) cause
    `{ error: 'auth-failed' }`.
  - **Audit emission:** `mcp-runtime.verify-resource.{accept,reject}`
    events written to the supplied sink. Private reason goes to
    audit; public surface stays opaque (H7-F.1).
  - **Error contract:** returns `{ principal, grants }` on success or
    `{ error: 'auth-failed' | 'auth-misconfigured' }` on failure.
    Pre-R5.8 returned the raw `verifyDelegationToken` error string.

  ### Tests
  - 9 new R5.8 tests in `test/unit/with-delegation.test.ts`.
  - 62/62 mcp-runtime tests pass.

  ### Migration

  Consumers using `verifyDelegationForResource` in production must
  add `classification` (from `declareResource(...)`) and `auditSink`
  to the opts. Tests can opt out with `developmentMode: true` or
  `environment: 'development'`.

### Patch Changes

- Updated dependencies [91b5888]
- Updated dependencies [e4c99dc]
  - @agenticprimitives/key-custody@1.0.0-alpha.4
  - @agenticprimitives/delegation@1.0.0-alpha.4
  - @agenticprimitives/types@1.0.0-alpha.4
  - @agenticprimitives/audit@1.0.0-alpha.4
  - @agenticprimitives/tool-policy@1.0.0-alpha.4

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
  - @agenticprimitives/audit@0.1.0-alpha.3
  - @agenticprimitives/key-custody@0.1.0-alpha.3
  - @agenticprimitives/delegation@0.1.0-alpha.3
  - @agenticprimitives/tool-policy@0.1.0-alpha.3

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
  - @agenticprimitives/audit@0.1.0-alpha.2
  - @agenticprimitives/key-custody@0.1.0-alpha.2
  - @agenticprimitives/delegation@0.1.0-alpha.2
  - @agenticprimitives/tool-policy@0.1.0-alpha.2
