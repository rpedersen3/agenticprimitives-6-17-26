# `@agenticprimitives/contracts` — spec

The on-chain enforcement layer for the agenticprimitives stack. This package
is the canonical home for Solidity sources, Foundry tests, deployment scripts,
per-network deployment JSON, ABIs, and flattened sources.

## Why this is its own package

Per **EXT3-001** + the H7 audit, the contracts must be installable from npm so
a consumer of the TypeScript packages can also pull ABIs, deployment
addresses, and verification scripts without cloning the monorepo.

## Surface

| Subpath | Content |
|---|---|
| `@agenticprimitives/contracts/abi` | One JSON ABI per source contract under `src/`. Index.js re-exports each as a named export typed as viem `Abi`. |
| `@agenticprimitives/contracts/abi/<Contract>.json` | A single ABI for direct import. |
| `@agenticprimitives/contracts/deployments/<network>` | The `deployments-<network>.json` for chain `network`. |

The Solidity source under `src/` is also shipped (`files: [src, ...]`) so
downstream auditors and integrators can read + flatten the canonical source
without cloning the repo.

## Build flow

```
forge build                 → out/<File>.sol/<Contract>.json (forge artifacts)
pnpm build:abi              → dist/abi/<Contract>.json (just the ABI array)
pnpm build:flat             → dist/flat/<Contract>.flat.sol (forge flatten output)
```

Both `build:abi` and `build:flat` are wired so `pnpm build` produces the
complete publishable shape.

## Per-network artifacts

| File | Network | Status |
|---|---|---|
| `deployments-base-sepolia.json` | Base Sepolia (84532) | testnet |
| `deployments-anvil.json` | local Anvil | dev |

## Verification

`pnpm verify:base-sepolia` runs `forge verify-contract` against BaseScan for
every entry in `deployments-base-sepolia.json`. Requires `BASESCAN_API_KEY`
+ `BASE_SEPOLIA_RPC` in env. See `scripts/verify-base-sepolia.sh`.

## Audit cross-reference

See [AUDIT.md](./AUDIT.md). The system audit lives at
[`docs/audits/2026-05-packages-contracts-production-readiness.md`](../../docs/audits/2026-05-packages-contracts-production-readiness.md).
