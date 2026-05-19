# @agenticprimitives/mcp-runtime — Claude guide

## What this package owns
- `withDelegation()` and `withCrossDelegation()` tool-handler wrappers — the headline feature.
- JTI replay protection (sqlite/postgres/memory stores).
- Bridge between `delegation`'s verification result + `tool-policy`'s decision → MCP tool error responses.
- `declareResource()` that joins tool-policy classification with MCP resource metadata.
- Test harness (`MockDelegationSigner`, `createTestConfig`, `withMockedDelegationContext`) — subpath `/testing`.
- MCP-defaults wrapper around `tool-policy.lintClassification` — subpath `/lint`.

## What this package does NOT own
- **MCP SDK itself.** Consumers bring `@modelcontextprotocol/sdk` as a peer dep. Tool/resource/prompt registration, transports, OAuth 2.1/PKCE — all in the SDK, post-2026-03-15 spec.
- The delegation primitive (`delegation`).
- Policy taxonomy / risk tiers / exact-call (`tool-policy`).
- A2A protocol — defer to future `@agenticprimitives/a2a-runtime`.
- Resource ORM — consumers manage their own DB tables.
- Tool registry — consumers use the MCP SDK's `registerTool`.

## Read these first (in order)
1. `capability.manifest.json` — boundary
2. `src/index.ts` — public API
3. `../../specs/205-mcp-runtime.md` — the contract
4. `src/with-delegation.ts` — the canonical wrapper

## Stable public exports
- **Wrappers:** `withDelegation`, `withCrossDelegation`
- **Resources:** `declareResource`
- **JTI stores:** `createSqliteJtiStore`, `createPostgresJtiStore`, `createMemoryJtiStore`
- **Low-level:** `verifyDelegationForResource`, `verifyCrossDelegationForResource`
- **Types:** `McpResourceVerifyConfig`, `ResourceDefinition`
- **Testing (subpath `/testing`):** `MockDelegationSigner`, `createTestConfig`, `withMockedDelegationContext`
- **Lint (subpath `/lint`):** `lintMcpClassification`

## Allowed imports
`@agenticprimitives/types`, `@agenticprimitives/delegation`, `@agenticprimitives/key-custody` (HMAC subpath), `@agenticprimitives/tool-policy`, `@modelcontextprotocol/sdk`, `better-sqlite3`, `pg`, `viem`.

## Forbidden imports
- `apps/*`

## Security invariants (DO NOT BREAK)
- `withDelegation` MUST run the full verification pipeline. Bypassing any step (signature recovery, on-chain revoke, ERC-1271, caveat eval, JTI) is a critical bug.
- `JtiStore.trackUsage` MUST be atomic. Test under concurrent writers.
- Cross-delegation MUST validate the `DELEGATE_BINDING_ENFORCER` caveat (both delegateSmartAccount AND delegatePersonAgent). The legacy compat shim (`acceptLegacyCrossDelegations`) is dev-only.
- Error responses MUST NOT leak whether a token was malformed vs. expired vs. revoked vs. caveat-failed. Use a single "auth failed" error class with internal-only details for logs.

## Validate the package
```bash
pnpm --filter @agenticprimitives/mcp-runtime typecheck
pnpm --filter @agenticprimitives/mcp-runtime test
```

## Common task routing
- Adding a new tool wrapper variant (e.g., `withDelegationAndConsent`) → `src/wrappers/<name>.ts`; export.
- Adding a new JTI store backend → `src/stores/<backend>.ts`; conform to `JtiStore` interface from delegation.
- Bridging to a new MCP SDK version → `src/sdk-adapter.ts`; update peer-dep range.

## Generated files (ignore)
`dist/`, `node_modules/`, `coverage/`, `*.tsbuildinfo`, `test/fixtures/golden/`.
