# @agenticprimitives/account-custody — Claude guide

## Owns credential recovery
This package is the **authorization layer for credential add / replace / remove** on a Smart Agent ([ADR-0011](../../docs/architecture/decisions/0011-credential-recovery-and-re-association.md) + [spec 221](../../specs/221-credential-recovery.md)). `CustodyAction.RecoverAccount` + `buildRecoverAccountArgs` perform an atomic add-new + remove-old credential rotation, gated by the SA's custody policy (trustee quorum / guardian quorum / multi-credential self-recovery / multi-sig). The canonical SA address NEVER changes; only the credential set does. Recovery MUST NOT be modeled as a delegation or routed through `@agenticprimitives/delegation`.

## Owns

- `custodyPolicyAbi`: ABI for `packages/contracts/src/custody/CustodyPolicy.sol`.
- `CustodyAction` enum (mirror of the on-chain enum) + per-action `buildXxxArgs` encoders.
- EIP-712 typed-data shapes for `ScheduleCustodyChangeRequest` /
  `ApplyCustodyChangeRequest` / `CancelScheduledChangeRequest` +
  `custodyDomain({chainId, verifyingContract})` helper.
- Custody-domain types: `Custodian`, `Trustee`, `CustodyCouncil`,
  `ScheduledChange`, `CustodyMode`, `RiskTier`.

## Does NOT own

- Delegation / Steward / Caveat concepts → `@agenticprimitives/delegation`
- Auth methods / signers → `@agenticprimitives/connect-auth`
- KMS → `@agenticprimitives/key-custody` (note: different "custody" —
  THAT one is key custody, THIS one is account custody)
- AgentAccount client + factory → `@agenticprimitives/agent-account`
- Solidity source → `packages/contracts/src/custody/`

## Read first

1. `src/index.ts` — public surface
2. [`specs/213-custody-layer-carve-out.md`](../../specs/213-custody-layer-carve-out.md)
   — why this package exists
3. [`specs/212-agent-centric-delegation.md`](../../specs/212-agent-centric-delegation.md)
   § 2.2 — the custody / agency vocabulary firewall this package enforces
4. [`packages/contracts/src/custody/CustodyPolicy.sol`](../../packages/contracts/src/custody/CustodyPolicy.sol)
   — source of truth for the ABI

## Allowed imports

`@agenticprimitives/types`, `viem`. Nothing else from `@agenticprimitives/*`.
This package is a **leaf today** — consumed by apps + contracts, NOT by other
packages. The future re-shape in which `agent-account` / `delegation` consume
its ABI is documented but not wired ([spec 213](../../specs/213-custody-layer-carve-out.md));
do not assert a present-tense "upstream of" edge that doesn't exist.

## Drift triggers — STOP

- Delegation / Caveat / Enforcer / Steward types → `delegation`
- Anything called `Owner` or `Guardian` (those are old agency-domain
  terms the vocabulary firewall replaces with `Custodian` / `Trustee`)
- Auth-method UX (passkey enroll, SIWE) → `connect-auth`
- Account address derivation / factory calls → `agent-account`

## Security invariants

- The ABI MUST match the deployed `CustodyPolicy.sol` bytecode. When
  the contract surface changes, this package's ABI moves in lockstep.
- EIP-712 typed-data shapes here MUST hash to the same `structHash` as
  the Solidity `keccak256(abi.encode(TYPEHASH, ...))` computations.
  Stage-3 of phase 6g.1 nailed the rename; do not change argument
  ordering without redeploying the policy contract.
- `CustodyAction` uint8 values are wire-format. Adding values is safe;
  reordering is not.

## Validate

```bash
pnpm --filter @agenticprimitives/account-custody typecheck
pnpm --filter @agenticprimitives/account-custody build
pnpm check:forbidden-terms
```

## Capabilities (cross-cutting)

- **Multi-sig + custody policy** — see [spec 207](../../specs/207-smart-account-threshold-policy.md)
  (product) + [spec 209](../../specs/209-erc7579-module-taxonomy.md)
  (impl) + [spec 213](../../specs/213-custody-layer-carve-out.md)
  (the carve-out that created this package).
- Index: [`docs/architecture/cross-cutting-capabilities.md`](../../docs/architecture/cross-cutting-capabilities.md)
