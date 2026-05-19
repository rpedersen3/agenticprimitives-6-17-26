# @agenticprimitives/delegation — Claude guide

## What this package owns
- The `Delegation` struct, `Caveat` types, `DataScopeGrant`. EIP-712 hashing (`hashDelegation`, `hashCaveats`).
- Caveat builders (8 on-chain enforcers + 3 off-chain sentinels) and the fail-closed evaluator.
- `DelegationClient` (browser-side issuance via a `Signer`).
- Token mint/verify (`mintDelegationToken`, `verifyDelegationToken`, `verifyCrossDelegation`).
- **Session lifecycle** (`SessionManager`, `SessionStore`) — absorbed from former kms scope. Sessions encrypt via `@agenticprimitives/key-custody` primitives but the lifecycle state machine lives here.
- On-chain revocation (`isRevoked`, `revokeDelegation`).
- `JtiStore` interface (concrete adapters live in `@agenticprimitives/mcp-runtime`).

## What this package does NOT own
- Smart-account internals → `@agenticprimitives/agent-account` (uses it for ERC-1271 verification).
- KMS provider implementations → `@agenticprimitives/key-custody` (uses it for envelope encryption).
- Authority/policy decisions → `@agenticprimitives/tool-policy`.
- MCP-specific transport or wrappers → `@agenticprimitives/mcp-runtime`.
- Contract addresses (caller-supplied via `EnforcerAddressMap`).

## Read these first (in order)
1. `capability.manifest.json` — boundary
2. `src/index.ts` — public API surface
3. `../../specs/202-delegation.md` — the contract (8 caveat types, sentinels, full lifecycle)
4. `src/caveats.ts` (caveat builders + evaluator)
5. `src/sessions.ts` (SessionManager) when working on session logic
6. `src/token.ts` (mint + verify) when working on token envelope

## Stable public exports
- **Caveats:** `ROOT_AUTHORITY`, `buildCaveat`, `buildMcpToolScopeCaveat`, `buildDataScopeCaveat`, `buildDelegateBindingCaveat`, `encodeTimestampTerms`, `encodeValueTerms`, `encodeAllowedTargetsTerms`, `encodeAllowedMethodsTerms`
- **Hashing:** `hashDelegation`, `hashCaveats`, `evaluateCaveats`
- **Browser:** `DelegationClient`
- **Sessions:** `SessionManager`, `SessionStore`
- **Token:** `mintDelegationToken`, `verifyDelegationToken`, `verifyCrossDelegation`
- **On-chain:** `isRevoked`, `revokeDelegation`
- **Types:** `Delegation`, `Caveat`, `DataScopeGrant`, `DelegationTokenClaims`, `EnforcerAddressMap`, `JtiStore`, `CaveatContext`, `VerifyOpts`, `VerifyError`, `SessionRow`, `SessionPackage`, `SessionMeta`

## Allowed imports
`@agenticprimitives/types`, `@agenticprimitives/identity-auth` (Signer types), `@agenticprimitives/agent-account` (ERC-1271 verification), `@agenticprimitives/key-custody` (envelope encryption), `viem`, `@noble/curves`, `@noble/hashes`.

## Forbidden imports
- `apps/*`
- `tool-policy`, `mcp-runtime` (these depend on us, not the other way).

## Security invariants (DO NOT BREAK)
- **Caveat evaluator MUST be fail-closed.** Unknown enforcer addresses → reject (no "permissive by default"). Verbatim from smart-agent.
- **Session private keys MUST never appear in plaintext at rest.** Always envelope-encrypted via key-custody before persistence.
- **Tokens MUST embed both the delegation AND a session-key signature over canonical claims.** Verification recovers session key from the signature; mismatch → reject.
- **JTI usage tracking MUST be atomic.** Concurrent writers should never see usage decrement or double-count.
- **DelegateBinding caveat for cross-delegations MUST validate BOTH delegateSmartAccount AND delegatePersonAgent.** Skipping either is a known regression pattern.

## Validate the package
```bash
pnpm --filter @agenticprimitives/delegation typecheck
pnpm --filter @agenticprimitives/delegation test
```

## Common task routing
- Adding a new caveat type → `src/caveats.ts` (builder + encoder), `src/evaluator.ts` (dispatch entry), `src/index.ts` (export).
- Changing token envelope → `src/token.ts`; coordinate with `mcp-runtime` (it parses).
- Adding session lifecycle method → `src/sessions.ts`; integration test in this package.

## Generated files (ignore)
`dist/`, `node_modules/`, `coverage/`, `*.tsbuildinfo`, `test/fixtures/golden/`.
