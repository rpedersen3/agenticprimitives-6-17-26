# @agenticprimitives/key-custody

## 1.0.0-alpha.10

### Minor Changes

- 75a24d9: KMS consumer surface (spec 276).
  - **key-custody**: new peer-dependency-free signing surface at the `./kms-core` subpath
    (`signDigestWithKms`, `gcpSignDigest`, `createGcpKmsTransport`, `addressFromSpkiPem`,
    `parseServiceAccountJson`, `parseSignerKeyMap`, plus the secp256k1 DER/low-s/recovery
    primitives) so consumers never inline a KMS signer. New `./provision-gcp` subpath +
    `ap-provision-gcp` CLI (plan/execute GCP HSM secp256k1 key provisioning + per-key IAM).
    `GcpKmsSigner` is now a thin wrapper over the core. `viem`, `@agenticprimitives/audit`,
    and `@agenticprimitives/connect-auth` are now **optional** peers — a `./kms-core`-only
    consumer no longer needs them.
  - **verifiable-credentials**: `kmsCredentialSigner(backend, …)` — a `CredentialSigner`
    backed by a KMS-custodied secp256k1 key (against a local structural `KmsSigningBackend`,
    so VC stays dependency-light). Also fixes `signCredential` to hash the body after
    `@context` expansion so the emitted `credentialHash` reconciles with its own body.

### Patch Changes

- 8f69514: Security hardening wave (harden/audit-2026-06-13).
  - **a2a (NEW-A2A-2, high)**: `tasks/get` / `tasks/cancel` / `pushNotificationConfig/set` no longer trust a
    client-supplied `caller`. The caller MUST sign `hashA2aTaskRequest({ method, taskId, agentSA, chainId })`
    and pass `signature`; the agent verifies it via the new `OnChainChecks.verifyCallerSignature` (ERC-1271)
    before the party check — fail-closed on missing/invalid signature or a throwing verifier. **Breaking**:
    the three method params + `A2aWireAdapter.getTask/cancelTask` now take `signature`, and `OnChainChecks`
    gains `verifyCallerSignature`. New export: `hashA2aTaskRequest`.
  - **key-custody (N-2, high)**: `aws-kms` backend now FAILS FAST at construction instead of throwing on first
    use (deferred-failure footgun). Only `gcp-kms` is production-ready.
  - **connect-auth (N-1, high)**: removed four dead `passkey` exports (`beginSignup`/`completeSignup`/
    `beginLogin`/`completeLogin`) that threw "not implemented" from a published subpath.

- Updated dependencies [8f69514]
  - @agenticprimitives/connect-auth@1.0.0-alpha.10
  - @agenticprimitives/types@1.0.0-alpha.10
  - @agenticprimitives/audit@1.0.0-alpha.10

## 1.0.0-alpha.9

### Patch Changes

- @agenticprimitives/types@1.0.0-alpha.9
- @agenticprimitives/audit@1.0.0-alpha.9
- @agenticprimitives/connect-auth@1.0.0-alpha.9

## 1.0.0-alpha.8

### Patch Changes

- @agenticprimitives/types@1.0.0-alpha.8
- @agenticprimitives/audit@1.0.0-alpha.8
- @agenticprimitives/connect-auth@1.0.0-alpha.8

## 1.0.0-alpha.7

### Patch Changes

- @agenticprimitives/types@1.0.0-alpha.7
- @agenticprimitives/audit@1.0.0-alpha.7
- @agenticprimitives/connect-auth@1.0.0-alpha.7

## 1.0.0-alpha.6

### Patch Changes

- @agenticprimitives/types@1.0.0-alpha.6
- @agenticprimitives/audit@1.0.0-alpha.6
- @agenticprimitives/connect-auth@1.0.0-alpha.6

## 1.0.0-alpha.5

### Patch Changes

- @agenticprimitives/types@1.0.0-alpha.5
- @agenticprimitives/audit@1.0.0-alpha.5
- @agenticprimitives/connect-auth@1.0.0-alpha.5

## 1.0.0-alpha.4

### Minor Changes

- 91b5888: R5.12a — Add `createRelayerAccount` for funded relayer chain calls
  (PKG-KEY-CUSTODY-009 closure).

  ### New API

  ```ts
  import {
    buildSignerBackend,
    createRelayerAccount,
  } from '@agenticprimitives/key-custody';

  const backend = buildSignerBackend({ backend: 'gcp-kms' });
  const relayer = await createRelayerAccount(backend, {
    role: 'direct-deploy',
    auditSink,
  });

  await walletClient.writeContract({ account: relayer, ... });
  // emits: key-custody.relay.sign { role: 'direct-deploy', opType: 'transaction', to, value, ... }
  ```

  `createRelayerAccount(backend, opts: CreateRelayerAccountOpts)` returns
  a viem `LocalAccount` (drop-in for `privateKeyToAccount(...)`). The
  inner KMS account (via `createKmsViemAccount`) handles digest signing
  — no key material leaves the HSM. The wrapper additionally emits a
  `key-custody.relay.sign` audit row on every sign op tagged with the
  caller-supplied `role`.

  ### Audit event shape

  ```ts
  {
    action:  'key-custody.relay.sign',
    outcome: 'success',
    actor:   { type: 'system', id: '<role>' },
    subject: { type: 'message' | 'transaction' | 'typed-data', id: '<digestFingerprint>' },
    context: {
      role:              '<role>',
      signerAddress:     '<0x... KMS-backed addr>',
      opType:            'message' | 'transaction' | 'typed-data',
      to:                '<tx target>' | null,
      value:             '<wei as decimal string>' | null,
      digestFingerprint: '0x + 16 hex chars (9 bytes of keccak)',
    },
  }
  ```

  Fail-soft: audit sink throws don't break the relay flow. Wrap with
  `composeFailHardSinks` from `@agenticprimitives/audit` for
  fail-hard semantics.

  ### Why

  External P0-style finding from the demo-a2a doctrine review: there
  was no documented "use me for funded relayer ops" entry point in
  `key-custody`. Apps reached for `privateKeyToAccount(env.X_PRIVATE_KEY)`,
  tripping `check:no-app-private-keys` and emitting zero audit
  context tagged by operator role. `createRelayerAccount` IS the
  convention.

  ### New exports
  - `createRelayerAccount` (main + `/relayer` subpath)
  - `CreateRelayerAccountOpts` type
  - Also re-exposes `createKmsViemAccount` from the main index for
    discoverability (previously available only via `/kms-viem`
    subpath)

  ### Docs
  - New `docs/relayer.md` explains when to reach for
    `createRelayerAccount` vs `createKmsViemAccount`, the role
    taxonomy convention, and the migration path.

  ### Tests

  13 new R5.12a tests in `test/unit/relayer-account.test.ts`:
  - address + source tag (`'kms-relayer'`)
  - delegates signMessage / signTransaction / signTypedData to inner
  - audit emit shape per op-type (`message` / `transaction` / `typed-data`)
  - audit context: role, signerAddress, to, value, digestFingerprint
  - value `bigint` → decimal string (JSON-safe)
  - digestFingerprint is 18-char hashed prefix (never raw digest)
  - fail-soft (throwing audit sink doesn't propagate)
  - no-sink path works
  - role in BOTH actor.id and context.role
  - deterministic signing (audit emission is additive)
  - transaction value omitted → recorded as `'0'`

  94/94 key-custody tests pass (was 81; +13 R5.12a).

  ### Companion work (separate PRs)
  - **R5.12b** — `createSpendCappedAccount` for funding-only signers
    (rejects `value > capWei` BEFORE the KMS round-trip)
  - **R5.12c** — `assertSaMatchesCustodianDerivation` in `agent-account`
    for sponsored-deploy gates
  - **R5.12d** — demo-a2a migrates 4 `privateKeyToAccount(DEPLOYER_PRIVATE_KEY)`
    callsites onto the new pattern

- e4c99dc: R5.12b — Add `createSpendCappedAccount` for per-tx ETH-capped relayers
  (PKG-KEY-CUSTODY-010 closure).

  ### New API

  ```ts
  import {
    createRelayerAccount,
    createSpendCappedAccount,
    SpendCapExceededError,
  } from '@agenticprimitives/key-custody';

  const inner = await createRelayerAccount(backend, {
    role: 'paymaster-topup',
    auditSink,
  });
  const capped = createSpendCappedAccount(inner, {
    capWei: 10n ** 17n, // 0.1 ETH per tx
    auditSink,
  });

  // Under cap → signs normally; emits key-custody.relay.sign from inner
  await walletClient.sendTransaction({ account: capped, to, value: 5n * 10n ** 16n });

  // Over cap → throws SpendCapExceededError BEFORE any HSM call;
  // emits key-custody.relay.spend-cap.reject from the cap wrapper
  await walletClient.sendTransaction({ account: capped, to, value: 10n ** 18n });
  ```

  ### Why

  External P0-style finding from the demo-a2a doctrine review: a funded
  relayer / operator key (paymaster top-up) had no signing-time gate
  against draining the worker balance in one tx. The cap was only
  enforceable operationally: monitor balance, hope to catch a drain
  in time, rotate keys after the fact. A compromised app process
  holding the signer could drain the entire balance in one shot.

  `createSpendCappedAccount` is a stateless pre-signing gate:
  `value > capWei` → throws `SpendCapExceededError` BEFORE any HSM
  round-trip. The HSM never even sees the digest.

  ### Behaviour
  - `value < capWei` → pass
  - `value === capWei` → pass (boundary, not violation)
  - `value > capWei` → reject + audit `denied`
  - `value === undefined / null` → treated as `0n` → pass
  - `value` as `number` / `string` → normalised to `bigint`
  - Unknown value shape → treated as `MAX_UINT256` → reject (fail-closed)
  - `capWei === 0n` → blocks ALL positive-value txs while allowing
    zero-value contract writes
  - `capWei < 0n` → throws at construction
  - `signMessage` / `signTypedData` → forwarded verbatim (no on-chain
    value to cap)
  - Audit emission ONLY on reject; success path stays silent (inner
    relayer's `key-custody.relay.sign` carries the success)
  - Fail-soft audit: sink throws do NOT swallow the
    `SpendCapExceededError`

  ### Composition

  `createSpendCappedAccount(createRelayerAccount(backend, ...), { capWei })`
  is the canonical funding-signer pattern. The cap is the _outer_ gate;
  the relayer's KMS+audit is the _inner_ signer.

  ### Audit event shape (reject only)

  ```ts
  {
    action:  'key-custody.relay.spend-cap.reject',
    outcome: 'denied',
    actor:   { type: 'system', id: '<signerAddress>' },
    subject: { type: 'transaction', id: '<tx target>' },
    context: { signerAddress, to, capWei, requestedValue },
  }
  ```

  ### New exports
  - `createSpendCappedAccount` (main index + new `/spend-cap` subpath)
  - `SpendCapExceededError` class
  - `CreateSpendCappedAccountOpts` type

  ### What this is NOT
  - Not a rolling spend budget (per-tx only; cumulative tracking
    belongs at substrate / operational layer)
  - Not calldata-aware (a `transfer(...)` ERC-20 call has
    `transaction.value == 0`; ERC-20 balance limits belong on the
    contract)
  - Not a rate limiter (HTTP layer / substrate concern)

  ### Docs

  New `packages/key-custody/docs/spend-capped.md` covers composition,
  boundary semantics, value normalisation, and the non-goals.

  ### Tests

  22 new R5.12b tests in `test/unit/spend-capped-account.test.ts`:
  - construction: negative cap rejected, cap=0 accepted, source tag
  - value gate: under/at/over cap, off-by-one above cap
  - error message identifies cap / requested / target / signer
  - value normalisation: undefined / number / string / bigint
  - cap=0 blocks positive value, passes zero value
  - signMessage / signTypedData pass-through (no cap applies)
  - audit emit only on reject; success path silent
  - fail-soft (throwing sink doesn't swallow error)
  - no-sink path works
  - HSM never called on cap reject (vi.spyOn verification)
  - HSM called once when under cap

  103/103 key-custody tests pass (was 81; +22 R5.12b).

  ### Companion

  This is the funding-signer companion to **R5.12a** (`createRelayerAccount`).
  Together they're the package-level fix for the demo-a2a
  `DEPLOYER_PRIVATE_KEY` doctrine red. **R5.12c** (`assertSaMatchesCustodianDerivation`)
  and **R5.12d** (demo-a2a migration) complete the wave.

### Patch Changes

- Updated dependencies [4c1f3dd]
- Updated dependencies [20a20de]
  - @agenticprimitives/connect-auth@1.0.0-alpha.4
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
