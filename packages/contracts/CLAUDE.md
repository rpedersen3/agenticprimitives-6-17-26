# contracts — Claude guide

## What this app is

Foundry workspace for the demo contracts. Contracts are the enforcement layer
for AgentAccount, custody policy, delegation manager/enforcers, naming,
identity, and relationship experiments.

## What this app owns

- Solidity contract source in `src/`.
- Foundry tests in `test/`.
- Deployment scripts and deployment JSON.
- Contract ABIs consumed by packages and demos.

## What this app does not own

- TypeScript SDK behavior → `packages/*`.
- Browser/Worker wiring → `apps/demo-*`.
- Product-level decisions → `specs/2XX-*.md`.
- Generated artifacts as review context → `out/`, `cache/`, `broadcast/`.

## Read These First

1. Relevant `../../specs/2XX-*.md` for the capability.
2. `src/AgentAccount.sol` for account-core changes.
3. `src/custody/CustodyPolicy.sol` for custody/recovery changes.
4. `src/agency/DelegationManager.sol` and `src/enforcers/` for delegation changes.
5. `script/Deploy.s.sol` for deployment wiring.

## Validate

```bash
pnpm --filter @agenticprimitives-demo/contracts build
pnpm --filter @agenticprimitives-demo/contracts test
```

## Generated Files

`out/`, `cache/`, `broadcast/`, `node_modules/`.
