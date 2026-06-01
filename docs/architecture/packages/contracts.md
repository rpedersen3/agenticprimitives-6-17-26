# `@agenticprimitives/contracts`

`contracts` contains the Solidity implementation, ABIs, tests, deployment
scripts, and storage-layout snapshots for the on-chain primitives.

## Owns

- `AgentAccount` and account modules.
- Custody policy contracts.
- Delegation manager and caveat enforcers.
- Naming registry, resolver, and subregistry contracts.
- Paymaster and deployment support contracts.
- Foundry tests, coverage, and storage-layout snapshots.

## Does Not Own

- Browser auth ceremonies.
- App-specific deployment UX.
- Indexers, read models, or product cache logic.
- TypeScript business wrappers that belong in package clients.

## Dependencies

The package has no internal TypeScript package dependencies in the package import
graph. Solidity contracts are consumed by clients through ABIs and deployment
artifacts.

## Consumers

Used by:

- `agent-account` for account/factory interactions.
- `delegation` for delegation manager semantics.
- `agent-naming` for naming ABIs.
- apps and scripts that deploy or verify chain state.

## Architecture Rules

- Keep on-chain authority small and explicit.
- Preserve storage layout for upgradeable contracts.
- Contract behavior should be easy to audit in isolation.
- Production deployment authority should sit behind governance or custody, not a
  raw deployer key.
- Naming roots and governance roles are high-value authority surfaces.

## Common Use

Use this package when changing the chain-level primitive itself: account
execution, custody, delegation redemption, naming, paymaster behavior, or
enforcer logic.

## Validation

Run:

```bash
pnpm check:contracts
pnpm check:storage-layouts
```
