# @agenticprimitives/account-custody

Custody-layer SDK for Smart Agent account safety and recovery.

This package owns the TypeScript surface around `CustodyPolicy`: ABI exports,
`CustodyAction` argument builders, EIP-712 typed data, quorum signature packing,
and custody-domain types.

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

## Boundary

This package speaks custody vocabulary only:

- `Custodian`
- `Trustee`
- `CustodyCouncil`
- `CustodyAction`
- `ScheduledChange`

It does not own delegation caveats, MCP transport, passkey ceremonies, account
deployment, or key-custody providers. See `CLAUDE.md` for routing.

## Validate

```bash
pnpm --filter @agenticprimitives/account-custody typecheck
pnpm --filter @agenticprimitives/account-custody test
```
