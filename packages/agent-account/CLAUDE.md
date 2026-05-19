# @agenticprimitives/agent-account — Claude guide

## What this package owns
- `AgentAccountClient`: deterministic `.getAddress()`, factory `.createAccount()`, `.isDeployed()`, ERC-1271 `signWithErc1271` / `isValidSignature`, `.buildUserOp()`.
- The auth-bootstrap relayer-deployment pattern (separate signer for deploy vs. user).
- EntryPoint v0.8 + factory client wiring (addresses by config; no Solidity here).

## What this package does NOT own
- Auth methods, sessions, signer implementations → [`identity-auth`](../identity-auth).
- The delegation primitive → [`delegation`](../delegation).
- KMS backends → [`key-custody`](../key-custody).
- Solidity source — addresses by config only.
- Paymaster policy ("which paymaster when") — defer; paymaster is a `buildUserOp` parameter.

## Vocabulary
**Owns:** `AgentAccountClient`, `UserOperation`, `EntryPoint`, "factory", "salt" (CREATE2), "bootstrap signer" (the relayer key for deployment).
**Disambiguation:** "**account**" here = ERC-4337 smart contract account. In `identity-auth` it's the subject of an `AuthenticatedUser` claim. Don't conflate them. See [`docs/architecture/vocabulary-map.md`](../../docs/architecture/vocabulary-map.md).
**Does not use:** `Delegation`, `Caveat`, `Enforcer`, `SessionManager`, `DelegationToken`, `A2AKeyProvider`, "envelope encryption", `RiskTier`, `withDelegation`, MCP. See `capability.manifest.json:forbiddenTerms`.

## Read these first (in order)
1. `capability.manifest.json` — boundary
2. `src/index.ts` — public API
3. `../../specs/201-agent-account.md` — the contract
4. `../../docs/architecture/decisions/0001-split-identity-auth-and-agent-account.md` — why this is its own package
5. `src/client.ts` (the `AgentAccountClient` implementation)

## Stable public exports
- `AgentAccountClient` — the class
- `UserOperation` — type

## Allowed imports
`@agenticprimitives/types`, `@agenticprimitives/identity-auth` (`Signer` types only), `viem`.

## Forbidden imports
- `apps/*`
- `delegation`, `key-custody`, `tool-policy`, `mcp-runtime` (these are downstream; adding back-edges creates cycles).

## Drift triggers — STOP and route
- "Add a caveat, delegation builder, or session manager" — **STOP.** Belongs in [`delegation`](../delegation). [ADR-0001](../../docs/architecture/decisions/0001-split-identity-auth-and-agent-account.md), [ADR-0002](../../docs/architecture/decisions/0002-session-lifecycle-in-delegation.md).
- "Implement a KMS backend or envelope encryption" — **STOP.** Belongs in [`key-custody`](../key-custody). We consume `Signer` from `identity-auth`; we don't produce signers.
- "Wire OAuth, passkey assertion, or any auth UX" — **STOP.** Belongs in [`identity-auth`](../identity-auth).
- "Add paymaster policy (when/which to use)" — **STOP.** v0 takes paymaster as a `buildUserOp` parameter; policy is deferred.
- "Add risk-tier or tool classification" — **STOP.** Belongs in [`tool-policy`](../tool-policy).

## Before you write code
- [ ] Is the change about smart account address, deployment, UserOp construction, or ERC-1271?
- [ ] Am I about to read state via `RPC_URL` and `chainId`? (Correct — that's our job.)
- [ ] Am I about to **persist** something to disk/DB? (Wrong — we're stateless. Persistence is a consumer concern.)
- [ ] If I'm signing, am I taking a `Signer` from the caller (right) or generating/storing keys myself (wrong → `key-custody`)?
- [ ] Did I update `specs/201-agent-account.md` if the public API changed?

## Security invariants (DO NOT BREAK)
- No salt collision via hash. Salt derives from stable user identifiers under keccak; never accept raw user-supplied salt without validation.
- Owner-only sensitive ops gated on `msg.sender == owner` or ERC-1271 — verified on-chain.
- EntryPoint version is baked into the address; refuse to operate across versions silently.
- Bootstrap signer keyId MUST be distinct from any user-authority signer (operational; we just don't muddle them in code).

## Validate the package
```bash
pnpm --filter @agenticprimitives/agent-account typecheck
pnpm --filter @agenticprimitives/agent-account test
pnpm check:forbidden-terms
```

## Common task routing
- Adding a new account method (e.g., `rotateOwner`) → `src/client.ts` + ABI in `src/abis.ts`.
- Adding a paymaster integration → DON'T (defer; paymaster is one layer above).
- Upgrading EntryPoint version → coordinate with the migration spec (open question §8.1 in spec).

## Generated files (ignore)
`dist/`, `node_modules/`, `coverage/`, `*.tsbuildinfo`.
