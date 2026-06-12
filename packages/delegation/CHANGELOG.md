# @agenticprimitives/delegation

## 1.0.0-alpha.8

### Minor Changes

- fa345d7: x402 pay-per-use (spec 272/273/274).
  - **contracts**: `PaymentEnforcer` (fused stateful caveat — treasury-scoped, per-charge + session caps, frequency window, one-shot nonce, transfer-only), `PaymentReceiptRegistry`, `MockUSDC` (EIP-3009). Deployed on Base Sepolia.
  - **delegation**: `buildPaymentMandateCaveats` / `encodePaymentTerms` / `describePaymentMandate`; real on-chain `isRevoked` + `buildRevokeDelegationCall`; `EnforcerAddressMap.payment`. **Fix:** `ROOT_AUTHORITY` corrected to the contract sentinel `0xff…ff` (was `0x00…00`) — every `DelegationClient` root delegation now passes the on-chain authority check, so `redeemDelegation` works.
  - **payments**: the x402 rail — `x402.buildRedemptionCalldata`, `computeNullifier`, `verifyMandate`, `createX402Rail`, v2 wire (PAYMENT-REQUIRED / PAYMENT-SIGNATURE / PAYMENT-RESPONSE), resource canonicalization + nonce store.
  - **a2a**: payment-gated skills (`gateSkillPayment`, `x402AgentCardExtension`).
  - **agent-account**: `buildErc20TransferCall` + `readErc20Balance`.

### Patch Changes

- Updated dependencies [fa345d7]
  - @agenticprimitives/agent-account@1.0.0-alpha.8
  - @agenticprimitives/types@1.0.0-alpha.8
  - @agenticprimitives/audit@1.0.0-alpha.8
  - @agenticprimitives/connect-auth@1.0.0-alpha.8
  - @agenticprimitives/key-custody@1.0.0-alpha.8

## 1.0.0-alpha.7

### Patch Changes

- ba49084: 2026-06-10 audit hardening wave + Base Sepolia redeploy.

  Contract/package security fixes from the post-NO-GO hardening program (the
  `@agenticprimitives/contracts` ABIs + the `deployments-base-sepolia.json`
  addresses move because **every contract was redeployed** — the new factory is
  `0x3E68B72B45e7C9d35B210E4Ab06e5Cece85cEbE4`):
  - **CA-F1 (High)** — `AgentAccountFactory` CREATE2 salt now commits to the full
    custody config (mode/trustees/timelockOverrides) so the counterfactual address
    can't be front-run with attacker-controlled recovery (ADR-0035).
    `getAddressForAgentAccount` gains a `timelockOverrides` param; the
    `@agenticprimitives/agent-account` client threads it.
  - **ATT-1 / ATT-3 / AGR-1** — registry issuer + joint-consent + transition digests
    now bind a full typed payload + `chainId` + `address(this)`.
  - **AN-1-ONCHAIN** — on-chain canonical label charset in `AgentNameRegistry`.
  - **SIG-1** — registries use malleability-safe OZ `ECDSA.tryRecover` (low-s).
  - **DM danger** — `verifyAuthorization` marked ⚠️ chain-only in NatSpec + the SDK.
  - **DEL-001 (P0-1, Critical)** — the session-key↔delegator binding in
    `@agenticprimitives/delegation` is now **fail-closed by default** (ADR-0036):
    `verifyDelegationToken` rejects any token lacking a valid `sessionDelegation` leaf
    unless the caller passes the explicit, greppable `allowUnboundSessionToken: true`
    opt-out. `@agenticprimitives/mcp-runtime` threads the same opt-out through
    `McpResourceVerifyConfig`. **Breaking:** the prior opt-in flags
    (`requireSessionDelegateBinding`, `strictSessionBinding`) are removed — callers that
    minted unbound tokens must set `allowUnboundSessionToken: true` or they fail closed.

  `@agenticprimitives/verifiable-credentials` + the first publish of
  `@agenticprimitives/a2a` (async delegation-authorized task transport) are bumped to
  catch the registry up to `master`.

- Updated dependencies [ba49084]
  - @agenticprimitives/agent-account@1.0.0-alpha.7
  - @agenticprimitives/types@1.0.0-alpha.7
  - @agenticprimitives/audit@1.0.0-alpha.7
  - @agenticprimitives/connect-auth@1.0.0-alpha.7
  - @agenticprimitives/key-custody@1.0.0-alpha.7

## 1.0.0-alpha.6

### Patch Changes

- @agenticprimitives/types@1.0.0-alpha.6
- @agenticprimitives/audit@1.0.0-alpha.6
- @agenticprimitives/connect-auth@1.0.0-alpha.6
- @agenticprimitives/key-custody@1.0.0-alpha.6
- @agenticprimitives/agent-account@1.0.0-alpha.6

## 1.0.0-alpha.5

### Patch Changes

- @agenticprimitives/types@1.0.0-alpha.5
- @agenticprimitives/audit@1.0.0-alpha.5
- @agenticprimitives/connect-auth@1.0.0-alpha.5
- @agenticprimitives/key-custody@1.0.0-alpha.5
- @agenticprimitives/agent-account@1.0.0-alpha.5

## 1.0.0-alpha.4

### Patch Changes

- Updated dependencies [4c1f3dd]
- Updated dependencies [20a20de]
- Updated dependencies [91b5888]
- Updated dependencies [e4c99dc]
- Updated dependencies [53156b5]
  - @agenticprimitives/connect-auth@1.0.0-alpha.4
  - @agenticprimitives/key-custody@1.0.0-alpha.4
  - @agenticprimitives/agent-account@1.0.0-alpha.4
  - @agenticprimitives/types@1.0.0-alpha.4
  - @agenticprimitives/audit@1.0.0-alpha.4

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
  - @agenticprimitives/connect-auth@0.1.0-alpha.3
  - @agenticprimitives/key-custody@0.1.0-alpha.3
  - @agenticprimitives/agent-account@0.1.0-alpha.3

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
  - @agenticprimitives/connect-auth@0.1.0-alpha.2
  - @agenticprimitives/key-custody@0.1.0-alpha.2
  - @agenticprimitives/agent-account@0.1.0-alpha.2
