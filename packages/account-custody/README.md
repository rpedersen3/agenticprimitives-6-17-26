# @agenticprimitives/account-custody

**Custody is not authority.**

Most stacks blur the two: the key that lets an agent act is also the key that controls the account, so a leaked session becomes a lost identity. This package exists to keep them apart. Credential add, replace, and remove on a Smart Agent are custody-policy operations — gated by trustee quorums, guardian quorums, multi-credential self-recovery, or multi-sig — and are never modeled as delegations ([ADR-0011](../../docs/architecture/decisions/0011-credential-recovery-and-re-association.md), [spec 221](../../specs/221-credential-recovery.md)). A delegated party can act within its caveats; it can never promote itself into custody.

The payoff is recovery without identity loss. `CustodyAction.RecoverAccount` performs an atomic add-new + remove-old credential rotation under the account's custody policy. The canonical Smart Agent address never changes; every delegation it ever issued stays valid; only the credential set moves. This package is the TypeScript surface for that machinery: the `CustodyPolicy` ABI, `CustodyAction` argument builders, EIP-712 typed data, quorum signature packing, and the custody-domain types.

> Part of [agenticprimitives](../../README.md) — the trust substrate for the agent economy: one canonical Smart Agent identity with custody, delegation, naming, credentials, and audit evidence designed as one system.

## Install

```bash
pnpm add @agenticprimitives/account-custody
```

## Use

```ts
import {
  CustodyAction,
  buildRecoverAccountArgs,
  custodyDomain,
  packQuorumSigs,
} from '@agenticprimitives/account-custody';
```

What you get:

- `custodyPolicyAbi` — the ABI for the on-chain `CustodyPolicy` ERC-7579 module ([`packages/contracts/src/custody/CustodyPolicy.sol`](../contracts/src/custody/CustodyPolicy.sol)), kept in lockstep with the deployed bytecode.
- `CustodyAction` enum (a mirror of the on-chain enum) plus per-action `buildXxxArgs` encoders — including `buildRecoverAccountArgs` for credential rotation.
- EIP-712 typed-data shapes for `ScheduleCustodyChangeRequest` / `ApplyCustodyChangeRequest` / `CancelScheduledChangeRequest`, with `custodyDomain({ chainId, verifyingContract })` — guaranteed to hash to the same `structHash` the Solidity computes.
- Quorum signature packing (`packQuorumSigs`) and custody-domain types: `Custodian`, `Trustee`, `CustodyCouncil`, `ScheduledChange`, `CustodyMode`, `RiskTier`.

## How it's different

The common pattern for org control and recovery is a third-party multi-sig (Safe) plus a separate recovery product (Argent-style guardians) bolted onto an account they don't define. That works until the seams matter: the multi-sig's notion of "owner" and the recovery product's notion of "guardian" are different identity models, and neither knows about the delegations the account has issued. Here custody is a native ERC-7579 module on the same Smart Agent — quorums, trustees, scheduled changes, and recovery in one policy, designed alongside the delegation layer it explicitly firewalls ([spec 213](../../specs/213-custody-layer-carve-out.md)). No third-party multi-sig dependency; we ported the signature-packing patterns worth porting and own the rest.

## Boundary

This package speaks custody vocabulary only:

- `Custodian`
- `Trustee`
- `CustodyCouncil`
- `CustodyAction`
- `ScheduledChange`

It does not own delegation caveats, MCP transport, passkey ceremonies, account deployment, or key-custody providers (note: `key-custody` is *key* custody — KMS backends; this is *account* custody). See [`CLAUDE.md`](CLAUDE.md) for routing and [`spec.md`](spec.md) for the contract.

## Validate

```bash
pnpm --filter @agenticprimitives/account-custody typecheck
pnpm --filter @agenticprimitives/account-custody test
```

## Status

Testnet/pilot-ready. Production launch is gated on the public checklist in the root README — including third-party contract audit and governance key rotation. Track every security finding live in [`docs/audits/findings.yaml`](../../docs/audits/findings.yaml).
