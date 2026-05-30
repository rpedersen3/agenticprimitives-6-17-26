# @agenticprimitives/mcp-runtime — Claude guide

## What this package owns
- `withDelegation()` tool-handler wrapper — the headline feature. (`withCrossDelegation` removed from public surface in H7-B.8 / XPKG-002; resurfaces behind `./experimental` per spec 100 §6 when cross-delegation work resumes.)
- JTI replay protection (sqlite/postgres/memory stores).
- Bridge between `delegation`'s verification result + `tool-policy`'s decision → MCP tool error responses.
- `declareResource()` that joins `tool-policy` classification with MCP resource metadata.
- Test harness (`MockDelegationSigner`, `createTestConfig`, `withMockedDelegationContext`) — subpath `/testing`.
- MCP-defaults wrapper around `tool-policy.lintClassification` — subpath `/lint`.

## What this package does NOT own
- **The MCP SDK itself.** Consumers bring `@modelcontextprotocol/sdk` as a peer dep. Tool/resource/prompt registration, transports, OAuth 2.1 + PKCE — all in the official SDK per [ADR-0004](../../docs/architecture/decisions/0004-mcp-runtime-as-middleware.md).
- The delegation primitive → [`delegation`](../delegation).
- Policy taxonomy / risk tiers / exact-call → [`tool-policy`](../tool-policy).
- A2A protocol — deferred to future `@agenticprimitives/a2a-runtime`.
- Resource ORM — consumers manage their own DB tables.
- Tool registry — consumers use the MCP SDK's `registerTool`.

## Vocabulary
**Owns:** `withDelegation`, `McpResourceVerifyConfig`, `ResourceDefinition`, `declareResource`, `JtiStore` adapters (the implementations; interface is in `delegation`), `MockDelegationSigner`.
**Disambiguation:**
- **"tool"** here = an MCP tool registered with `@modelcontextprotocol/sdk`. In [`tool-policy`](../tool-policy) "tool" is the abstract classified tool. We're the concrete one.
- **"envelope"** here = the inter-service HTTP request envelope with HMAC. In [`key-custody`](../key-custody) "envelope" = AES-GCM envelope encryption. Different concepts.
- **"principal"** comes from `delegation` verification; we pass it into the wrapped handler.
See [`docs/architecture/vocabulary-map.md`](../../docs/architecture/vocabulary-map.md).
**Does not use:** `passkey`, `SIWE`, `OAuth`, `AgentAccountClient`, `AgentAccountFactory`, "envelope encryption" (different concept from our envelope), `LocalAesProvider`, `AwsKmsProvider`, `GcpKmsProvider`, `AES-GCM`, `buildCaveat` / `encodeTimestampTerms` (caveat builders), `RiskTier` (taxonomy), `declareTool` (we use `declareResource`). See `capability.manifest.json:forbiddenTerms`.

## Read these first (in order)
1. `capability.manifest.json` — boundary
2. `src/index.ts` — public API
3. `../../specs/205-mcp-runtime.md` — the contract
4. `../../docs/architecture/decisions/0004-mcp-runtime-as-middleware.md` — why we're middleware not SDK
5. `src/with-delegation.ts` — the canonical wrapper

## Stable public exports
**Wrappers:** `withDelegation`
**Resources:** `declareResource`
**JTI stores:** `createSqliteJtiStore`, `createPostgresJtiStore`, `createMemoryJtiStore`
**Low-level:** `verifyDelegationForResource`
**Types:** `McpResourceVerifyConfig`, `ResourceDefinition`
**Testing (`/testing`):** `MockDelegationSigner`, `createTestConfig`, `withMockedDelegationContext`
**Lint (`/lint`):** `lintMcpClassification`

## Allowed imports
`@agenticprimitives/types`, `@agenticprimitives/delegation`, `@agenticprimitives/key-custody` (`/mac` subpath for HMAC), `@agenticprimitives/tool-policy`, `@modelcontextprotocol/sdk`, `better-sqlite3`, `pg`, `viem`.

## Forbidden imports
- `apps/*`

## Drift triggers — STOP and route
- "Reimplement caveat evaluation, EIP-712 hashing, or token verification" — **STOP.** Belongs in [`delegation`](../delegation). We call `verifyDelegationToken` and route the result.
- "Add a new risk tier or classification tag" — **STOP.** Belongs in [`tool-policy`](../tool-policy). [ADR-0003](../../docs/architecture/decisions/0003-tool-policy-protocol-agnostic.md).
- "Mint a delegation token here" — **STOP.** Belongs in [`delegation`](../delegation).
- "Add MCP SDK transport or registration logic" — **STOP.** Use the official `@modelcontextprotocol/sdk`. [ADR-0004](../../docs/architecture/decisions/0004-mcp-runtime-as-middleware.md).
- "Encrypt a session payload or generate a data key" — **STOP.** Belongs in [`key-custody`](../key-custody).
- "Implement an auth flow (passkey, SIWE, OAuth)" — **STOP.** Belongs in [`connect-auth`](../connect-auth).

## Before you write code
- [ ] Is the change in the wrapper layer (`withDelegation` / JTI / classification bridge / MCP error mapping)?
- [ ] Am I about to **reimplement** verification rather than calling `delegation.verifyDelegationToken`? (If yes, wrong place.)
- [ ] If I'm changing the decision-to-error mapping, did I preserve "no info-leak in error responses" (no distinguishing malformed vs expired vs revoked vs caveat-failed externally)?
- [ ] Am I keeping the MCP SDK as a peer dep (not bundled, not vendored)?
- [ ] Did I update `specs/205-mcp-runtime.md` if the public API changed?

## Security invariants (DO NOT BREAK)
- **`withDelegation` MUST run the full verification pipeline.** Bypassing any step (signature recovery, on-chain revoke, ERC-1271, caveat eval, JTI, policy decision) is a critical bug.
- **`JtiStore.trackUsage` MUST be atomic.** Test under concurrent writers.
- **Cross-delegation MUST validate `DELEGATE_BINDING_ENFORCER` caveat** (both `delegateSmartAccount` AND `delegatePersonAgent`). The legacy compat shim (`acceptLegacyCrossDelegations`) is dev-only.
- **Error responses MUST NOT leak** whether a token was malformed vs. expired vs. revoked vs. caveat-failed. Single auth-failed error; details internal-only for logs.

## Validate the package
```bash
pnpm --filter @agenticprimitives/mcp-runtime typecheck
pnpm --filter @agenticprimitives/mcp-runtime test
pnpm check:forbidden-terms
```

## Common task routing
- Adding a new wrapper variant (e.g., `withDelegationAndConsent`) → `src/wrappers/<name>.ts`; export.
- Adding a new JTI store backend → `src/stores/<backend>.ts`; conform to `JtiStore` interface from `delegation`.
- Bridging to a new MCP SDK version → `src/sdk-adapter.ts`; update peer-dep range.

## Capabilities this package participates in
- **Multi-sig + threshold policy** — see [spec 207](../../specs/207-smart-account-threshold-policy.md) + [demo guide](../../apps/demo-web-pro/docs/multi-sig/guide.md). This package's role: `withDelegation` already calls `tool-policy.evaluatePolicy(classification)` (closed H2 in pass 2). Once 6c.3 lands, the wrapper threads the decision's `requiresQuorum` / `requiresAcceptedOnChain` into `verifyDelegationToken` opts. No new public exports — n-of-m is transparent at the wrapper level.
- **Audit / forensics trail** — see [spec 206](../../specs/206-audit.md) + [demo guide](../../apps/demo-mcp/docs/audit/guide.md). This package emits: `mcp-runtime.with-delegation.{accept,reject}` (in `withDelegation`) and `mcp-runtime.service-mac.{accept,reject}` (in `verifyServiceMac`). Both correlation-stitched via the caller-supplied `correlationId` opt.
- Index of cross-cutting capabilities: [`docs/architecture/cross-cutting-capabilities.md`](../../docs/architecture/cross-cutting-capabilities.md).

## Generated files (ignore)
`dist/`, `node_modules/`, `coverage/`, `*.tsbuildinfo`, `test/fixtures/golden/`.
