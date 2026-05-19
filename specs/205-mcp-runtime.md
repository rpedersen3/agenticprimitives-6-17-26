# Spec 205 — `@agenticprimitives/mcp-runtime`

**Capability:** Delegation-aware authorization middleware around the official MCP TypeScript SDK. The decision layer, not the SDK.
**Status:** v0 draft · 2026-05-19
**Reference implementation:** `smart-agent/apps/{person,org,people-group}-mcp/src/auth/{verify-delegation,principal-context}.ts`; classification tags throughout `apps/*-mcp/src/tools/`.

> **Net change from the original 004 spec:** classification taxonomy + risk tiers + exact-call DSP move to `@agenticprimitives/tool-policy` (protocol-agnostic). This package keeps the MCP-specific middleware: `withDelegation` wrapper, JTI replay, cross-delegation bridging, integration with the official MCP SDK.

> **Boundary clarification from research:** the official `@modelcontextprotocol/sdk` already provides tool/resource/prompt registration, transports, and OAuth 2.1 + PKCE + RFC-9728 + RFC-8707 (mandated by the 2026-03-15 spec). Our value-add is **decision middleware** that bridges to `@agenticprimitives/delegation` — not a SDK replacement.

---

## 1. Goal

Eliminate the ~65% code duplication observed across smart-agent's three mature MCP servers (`person-mcp`, `org-mcp`, `people-group-mcp`), all of which re-implement the same verify-delegation/principal-context pattern. Consumers building an MCP server write **only** their tool handlers + resource model; authorization, replay protection, classification routing, and cross-delegation bridging are imported.

---

## 2. The pattern

Looking at smart-agent's three MCPs, the auth pipeline is the same every time. We package exactly this:

```
HTTP/stdio request
   ↓
1. Service-layer HMAC envelope check       (key-custody/mac)
   ↓
2. Bearer token presence + audience match
   ↓
3. Session-key signature verification      (delegation)
   ↓
4. EIP-712 delegation hash computation     (delegation)
   ↓
5. On-chain DelegationManager.isRevoked()  (delegation)
   ↓
6. ERC-1271 AgentAccount.isValidSignature  (agent-account)
   ↓
7. Caveat evaluation (fail-closed)         (delegation)
   ↓
8. JTI usage tracking (atomic, replay-protected)   ← OWNED BY THIS PACKAGE
   ↓
9. tool-policy.evaluatePolicy(ctx)         (tool-policy)
   ↓
10. Hand off to tool handler with verified { principal, grants? }
```

Smart-agent's three implementations diverge only in `audience`, JTI table name, and which cross-delegation routes are exposed — everything else is byte-identical. That's our extraction target.

Smart-agent ref: `apps/{person,org,people-group}-mcp/src/auth/verify-delegation.ts`.

---

## 3. Tool wrapper API (the headline feature)

```ts
export interface McpResourceVerifyConfig {
  audience: string;                          // 'urn:mcp:server:person'
  chainId: number;
  rpcUrl: string;
  delegationManager: Address;
  enforcerMap: EnforcerAddressMap;           // from @agenticprimitives/delegation
  jtiStore: JtiStore;                        // sqlite/postgres-backed
  acceptLegacyCrossDelegations?: boolean;    // default false; dev compat shim
}

export function withDelegation<A extends Record<string, unknown>>(
  config: McpResourceVerifyConfig,
  handler: (args: A & {
    principal: Address;
    grants?: DataScopeGrant[];
  }) => Promise<unknown>,
): (args: A & { token: string }) => Promise<unknown>;
```

Usage in an MCP tool:
```ts
import { withDelegation, createSqliteJtiStore } from '@agenticprimitives/mcp-runtime';

const config: McpResourceVerifyConfig = {
  audience: 'urn:mcp:server:person',
  chainId: 31337,
  rpcUrl: process.env.RPC_URL!,
  delegationManager: process.env.DELEGATION_MANAGER_ADDRESS as `0x${string}`,
  enforcerMap,
  jtiStore: createSqliteJtiStore(db, 'token_usage'),
};

export const getProfileTool = {
  name: 'get_profile',
  inputSchema: { /* ... */ },
  handler: withDelegation(config, async ({ principal }) => {
    return db.profiles.findUnique({ where: { ownerAddress: principal } });
  }),
};
```

That's it — the handler no longer touches auth.

---

## 4. Cross-delegation bridging

```ts
export function withCrossDelegation<A extends Record<string, unknown>>(
  config: McpResourceVerifyConfig,
  handler: (args: A & {
    callerPrincipal: Address;
    dataPrincipal: Address;
    grants: DataScopeGrant[];   // filtered to this audience
  }) => Promise<unknown>,
): (args: A & { token: string; crossDelegationHash: Hex }) => Promise<unknown>;
```

The wrapper:
1. Runs the standard `withDelegation` flow → resolves `callerPrincipal`.
2. Looks up the cross-delegation in `received_delegations` by `(holderPrincipal=callerPrincipal, delegationHash)`.
3. Calls `verifyCrossDelegation()` from `@agenticprimitives/delegation` with `DELEGATE_BINDING_ENFORCER` check.
4. Filters `DataScopeGrant[]` to those matching `config.audience`.
5. Passes both principals + grants to the handler.

Smart-agent ref: `apps/person-mcp/src/auth/verify-delegation.ts:261-493`, `apps/person-mcp/src/tools/received-delegations.ts:30-194`.

---

## 5. JTI replay protection

```ts
export interface JtiStore {
  trackUsage(jti: string, limit: number): Promise<{ usage: number; allowed: boolean }>;
}

// Adapters
export function createSqliteJtiStore(db: BetterSqlite3Database, table?: string): JtiStore;
export function createPostgresJtiStore(pool: PgPool, table?: string): JtiStore;
export function createMemoryJtiStore(): JtiStore;   // tests only
```

Default SQL implementation: `INSERT ... ON CONFLICT(jti) DO UPDATE SET usage = usage + 1 RETURNING usage`. Must be safe under concurrent writers.

Smart-agent ref: `apps/person-mcp/src/auth/verify-delegation.ts:202-214`.

---

## 6. Resource declaration (composes with `tool-policy`)

```ts
export interface ResourceDefinition {
  name: string;                    // 'profile', 'wallet'
  audience: string;                // 'urn:mcp:server:person'
  fields?: string[];
}

export function declareResource(
  def: ResourceDefinition,
  classification: ToolClassification    // from @agenticprimitives/tool-policy
): ResourceDefinition & { _classification: ToolClassification };
```

The `_classification` annotation flows into the `evaluatePolicy` call inside `withDelegation`. This is the bridge between MCP runtime and protocol-agnostic policy.

---

## 7. Test harness (subpath: `/testing`)

```ts
export class MockDelegationSigner {
  constructor(opts: { delegator: Address; sessionKey: Address; chainId: number });
  issueDelegation(caveats: Caveat[]): Promise<Delegation>;
  mintToken(claims: Partial<DelegationTokenClaims>): Promise<string>;
  revoke(hash: Hex): void;
}

export function createTestConfig(opts?: { mockSigner?: MockDelegationSigner }): McpResourceVerifyConfig;

export async function withMockedDelegationContext<T>(
  ctx: { caveats?: Caveat[]; grants?: DataScopeGrant[] },
  fn: (token: string) => Promise<T>,
): Promise<T>;
```

Lets consumers test tool handlers without spinning up a chain.

---

## 8. Lint helper (subpath: `/lint`)

```ts
import { lintClassification } from '@agenticprimitives/tool-policy';

export async function lintMcpClassification(opts: { srcDir: string }): Promise<LintResult>;
// Pre-configures lintClassification with MCP-specific required tags.
```

Thin wrapper around `tool-policy.lintClassification` with MCP defaults (`['@sa-tool', '@sa-auth']` required; `['@sa-validation']` required on write tools).

Smart-agent ref: `scripts/check-person-mcp-classification.ts:1-95`.

---

## 9. Public API

```ts
// Wrappers
export function withDelegation(...);
export function withCrossDelegation(...);

// Resource declaration (composes with tool-policy)
export function declareResource(def, classification);

// JTI stores
export function createSqliteJtiStore(db, table?);
export function createPostgresJtiStore(pool, table?);
export function createMemoryJtiStore();

// Low-level escape hatches
export async function verifyDelegationForResource(token, config, ctx?);
export async function verifyCrossDelegationForResource(crossDel, callerPrincipal, targetServer, config);

// Test utilities (subpath: '/testing')
export { MockDelegationSigner, createTestConfig, withMockedDelegationContext };

// Lint helper (subpath: '/lint')
export async function lintMcpClassification(opts);

// Types (re-exported from delegation)
export type { McpResourceVerifyConfig, ResourceDefinition, DataScopeGrant, JtiStore };
```

---

## 10. Non-goals

- **No MCP SDK bundling.** Consumers bring their own `@modelcontextprotocol/sdk` (declared as peer dep).
- **No HTTP transport.** Hono/Express/raw stdio — package is transport-agnostic. Use whatever the MCP SDK provides.
- **No resource ORM.** We don't manage DB tables for resources; only the JTI table.
- **No tool registry.** Smart-agent uses a literal map `{name, description, inputSchema, handler}`; consumers keep their preferred pattern. The MCP SDK provides `registerTool()`.
- **No OAuth 2.1 plumbing.** Official SDK handles this (post-2026-03-15 spec).
- **No A2A support.** Defer to `@agenticprimitives/a2a-runtime` (v0.1+).
- **No classification taxonomy** (lives in `tool-policy`).

---

## 11. Migration story for smart-agent's MCPs

For each of `person-mcp`, `org-mcp`, `people-group-mcp`:

1. Replace `src/auth/verify-delegation.ts` (~500 lines each) with `withDelegation` import.
2. Replace `src/auth/principal-context.ts` with the wrapper's per-handler args.
3. Migrate JTI table to `createSqliteJtiStore` or `createPostgresJtiStore` (no schema change if table name kept).
4. Keep audience strings, error messages, and table names local.
5. Run `lintMcpClassification` from CI to preserve metadata invariants.

Expected net change: **−800 to −1200 lines per MCP**, with no behaviour difference at the boundary.

---

## 12. Test plan (v0)

- Unit: token verification happy/failure paths against fixtures.
- Integration: `withDelegation` wrapping a stub handler, exercised by `MockDelegationSigner`-issued tokens.
- Concurrency: `createSqliteJtiStore.trackUsage` under N=100 concurrent writers must produce exactly N usage counts with monotonically increasing values.
- End-to-end smoke: a minimal MCP server using `@modelcontextprotocol/sdk` + this package's `withDelegation`, exercised via the official MCP client.

---

## 13. Smart-agent file index

| Concern | File | Lines |
| --- | --- | --- |
| Person-MCP verify | `apps/person-mcp/src/auth/verify-delegation.ts` | 1–493 |
| Org-MCP verify | `apps/org-mcp/src/auth/verify-delegation.ts` | 85–223 |
| People-Group-MCP verify | `apps/people-group-mcp/src/auth/verify-delegation.ts` | full |
| Person principal context | `apps/person-mcp/src/auth/principal-context.ts` | 11–23 |
| Org principal context | `apps/org-mcp/src/auth/principal-context.ts` | 18–99 |
| Cross-del tools | `apps/person-mcp/src/tools/received-delegations.ts` | 30–194 |
| Canonical tool example | `apps/person-mcp/src/tools/profile.ts` | 1–100 |
