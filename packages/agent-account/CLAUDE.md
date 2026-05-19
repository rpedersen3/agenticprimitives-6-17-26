# @agenticprimitives/agent-account — Claude guide

## What this package owns
- `AgentAccountClient`: deterministic `.getAddress()`, factory `.createAccount()`, deployment checks, ERC-1271 `signWithErc1271` / `isValidSignature`, `.buildUserOp()`.
- The auth-bootstrap relayer-deployment pattern (signer rotation between deployer and owner).
- EntryPoint v0.8 + factory client wiring (addresses are config; no Solidity here).

## What this package does NOT own
- Auth methods, sessions, signer implementations → `@agenticprimitives/identity-auth`.
- The delegation primitive → `@agenticprimitives/delegation`.
- KMS backends → `@agenticprimitives/key-custody`.
- Solidity source — addresses by config only.
- Paymaster policy ("which paymaster when") — defer; paymaster is a `buildUserOp` parameter.

## Read these first (in order)
1. `capability.manifest.json` — boundary
2. `src/index.ts` — public API
3. `../../specs/201-agent-account.md` — the contract
4. `src/client.ts` (canonical `AgentAccountClient` implementation)

## Stable public exports
- `AgentAccountClient` — the class
- `UserOperation` — type

## Allowed imports
`@agenticprimitives/types`, `@agenticprimitives/identity-auth` (Signer types only), `viem`.

## Forbidden imports
- `apps/*`
- `delegation`, `key-custody`, `tool-policy`, `mcp-runtime` (these are downstream — adding back-edges would create cycles).

## Security invariants (DO NOT BREAK)
- Salt derivation MUST be deterministic; never accept user-supplied salt without validation.
- ERC-1271 verification MUST go through the deployed contract via RPC, never short-circuit by recovering signatures locally.
- EntryPoint version is baked into the address; refuse to operate across versions silently.
- Bootstrap signer keyId MUST be distinct from any user-authority signer (enforced by ops, validated in production-guard).

## Validate the package
```bash
pnpm --filter @agenticprimitives/agent-account typecheck
pnpm --filter @agenticprimitives/agent-account test
```

## Common task routing
- Adding a new account method (e.g., `rotateOwner`) → `src/client.ts` + ABI in `src/abis.ts`.
- Adding a paymaster integration → DON'T (defer; paymaster lives one layer above).
- Upgrading EntryPoint version → coordinate with the migration spec (open question §8.1 of spec).

## Generated files (ignore)
`dist/`, `node_modules/`, `coverage/`, `*.tsbuildinfo`.
