# Spec 004 — `@agenticprimitives/mcp-resources`

**Capability:** Delegation-aware resource access management for MCP servers. A reusable pattern that any MCP can adopt to enforce token-bound, caveat-limited, replay-protected access to its resources.
**Status:** v0 draft · 2026-05-19
**Reference implementation:** `smart-agent/apps/person-mcp/src/auth/*`, `smart-agent/apps/org-mcp/src/auth/*`, `smart-agent/apps/people-group-mcp/src/auth/*`; classification scripts at `smart-agent/scripts/check-{route,person-mcp}-classification.ts`.

---

## 1. Goal

Eliminate the ~65% code duplication observed across smart-agent's three mature MCP servers (`person-mcp`, `org-mcp`, `people-group-mcp`), all of which re-implement the same verify-delegation/principal-context pattern. Ship that pattern as a package any MCP can adopt.

Concretely: a consumer building an MCP server should write **only** their tool handlers + resource model. Authorization, replay protection, classification, and cross-delegation bridging are imported.

---

## 2. The pattern (what we're packaging)

Looking at smart-agent's three MCPs, the auth pipeline is the same shape every time:

```
HTTP/stdio request
   ↓
1. Service-layer HMAC envelope check       (requireInboundServiceAuth)
   ↓
2. Bearer token presence + audience match
   ↓
3. Session-key signature verification      (recovers sessionKeyAddress)
   ↓
4. EIP-712 delegation hash computation
   ↓
5. On-chain DelegationManager.isRevoked()
   ↓
6. ERC-1271 AgentAccount.isValidSignature()
   ↓
7. Caveat evaluation (fail-closed)         (delegates to @agenticprimitives/delegation)
   ↓
8. JTI usage tracking (atomic, replay-protected)
   ↓
9. Extract principal = delegation.delegator
   ↓
Hand off to tool handler with { principal, grants? } in scope
```

Smart-agent's three implementations diverge only in:
- `audience` (`'urn:mcp:server:person'` vs `'urn:mcp:server:org'` vs people-group)
- JTI table name (`token_usage` vs `org_token_usage`)
- The cross-delegation route (full in person-mcp; partial in org-mcp; stub in people-group-mcp)

Everything else is byte-identical or near-identical across the three. That's our extraction target.

Smart-agent ref: `apps/{person,org,people-group}-mcp/src/auth/verify-delegation.ts` and `principal-context.ts`.

---

## 3. Resource model

```ts
export interface ResourceDefinition {
  /** Short name for logs/metrics: 'profile', 'wallet', 'org-members' */
  name: string;
  /** Audience URN this resource lives under: 'urn:mcp:server:person' */
  audience: string;
  /** Optional declared fields — informational; field-level enforcement
   *  happens via DataScopeGrant caveats. */
  fields?: string[];
}

export interface ResourceScope {
  resource: string;
  readable: boolean;
  writable: boolean;
  fieldMask?: string[];
}
```

Resources are addressed by `(audience, name, principal)`. The principal is recovered from the verified delegation; the resource (name) is implicit from the tool definition; the audience is fixed per MCP server.

---

## 4. Tool wrapper API (the headline feature)

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
  }) => Promise<unknown>
): (args: A & { token: string }) => Promise<unknown>;
```

Usage in an MCP tool:
```ts
import { withDelegation } from '@agenticprimitives/mcp-resources';
import { mcpVerifyConfig } from '../config';

export const getProfileTool = {
  name: 'get_profile',
  inputSchema: { /* ... */ },
  handler: withDelegation(mcpVerifyConfig, async ({ principal }) => {
    return db.profiles.findUnique({ where: { ownerAddress: principal } });
  }),
};
```

That's it — the handler no longer touches auth.

---

## 5. Cross-delegation bridging

When a tool needs to read another principal's data via a cross-delegation:

```ts
export function withCrossDelegation<A extends Record<string, unknown>>(
  config: McpResourceVerifyConfig,
  handler: (args: A & {
    callerPrincipal: Address;
    dataPrincipal: Address;
    grants: DataScopeGrant[];   // already filtered to this audience
  }) => Promise<unknown>
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

## 6. JTI replay protection

```ts
export interface JtiStore {
  /**
   * Atomically increment usage for `jti` and return both the new count
   * and whether the operation is allowed under `limit`.
   * Implementations MUST be safe under concurrent writers.
   */
  trackUsage(jti: string, limit: number): Promise<{ usage: number; allowed: boolean }>;
}

// Adapters
export function createSqliteJtiStore(db: BetterSqlite3Database, table?: string): JtiStore;
export function createPostgresJtiStore(pool: PgPool, table?: string): JtiStore;
export function createMemoryJtiStore(): JtiStore;   // tests only
```

The default SQL implementation uses `INSERT ... ON CONFLICT(jti) DO UPDATE SET usage = usage + 1 RETURNING usage` (smart-agent's pattern at `verify-delegation.ts:202-214`).

---

## 7. Classification metadata

Smart-agent's `scripts/check-person-mcp-classification.ts` enforces that every tool and HTTP route carries JSDoc tags:

```ts
/**
 * @sa-tool delegation-verified
 * @sa-auth session-token
 * @sa-validation json-schema
 * @sa-risk-tier medium
 * @sa-owner team-identity
 */
export const getProfileTool = { /* ... */ };
```

We ship two things:

1. A **`declareResource()`** helper that attaches the same metadata at runtime, so tools that don't use JSDoc still surface it:
   ```ts
   export function declareResource(def: ResourceDefinition, classification: ResourceClassification): ResourceDefinition & { _classification: ResourceClassification };
   ```

2. A **lint helper** consumers can invoke from their own scripts:
   ```ts
   import { lintMcpClassification } from '@agenticprimitives/mcp-resources/lint';
   await lintMcpClassification({ srcDir: 'src/', requiredTags: ['@sa-tool', '@sa-auth'] });
   ```
   This re-uses smart-agent's parser logic so the JSDoc lint produces identical output.

```ts
export interface ResourceClassification {
  '@sa-tool': 'delegation-verified' | 'service-only' | 'bootstrap' | 'dev-only';
  '@sa-auth': 'session-token' | 'service-hmac' | 'none' | 'none-with-csrf';
  '@sa-validation'?: 'shape-check' | 'json-schema' | 'none-no-body' | 'none-path-params' | 'wallet-action-canonical';
  '@sa-risk-tier'?: 'low' | 'medium' | 'high' | 'critical';
  '@sa-owner'?: string;
  '@sa-rate-limit'?: string;
  '@sa-prod-gate'?: 'enabled' | 'disabled';
}
```

Smart-agent ref: `scripts/check-person-mcp-classification.ts:1-95`, `scripts/lib/person-mcp-classification-parser.ts`.

---

## 8. Test harness

```ts
export class MockDelegationSigner {
  constructor(opts: { delegator: Address; sessionKey: Address; chainId: number });
  issueDelegation(caveats: Caveat[]): Promise<Delegation>;
  mintToken(claims: Partial<DelegationTokenClaims>): Promise<string>;
  revoke(hash: Hex): void;
}

export function createTestConfig(opts?: { mockSigner?: MockDelegationSigner }): McpResourceVerifyConfig;

// Useful in MCP integration tests
export async function withMockedDelegationContext<T>(
  ctx: { caveats?: Caveat[]; grants?: DataScopeGrant[] },
  fn: (token: string) => Promise<T>
): Promise<T>;
```

This lets consumers test their tool handlers in isolation without spinning up a real chain.

---

## 9. Public API summary

```ts
// Wrappers
export function withDelegation(...);
export function withCrossDelegation(...);

// Resource declaration
export function declareResource(def, classification);

// JTI stores
export function createSqliteJtiStore(...);
export function createPostgresJtiStore(...);
export function createMemoryJtiStore();

// Verification (low-level escape hatch)
export async function verifyDelegationForResource(token, config, ctx?);
export async function verifyCrossDelegationForResource(crossDel, callerPrincipal, targetServer, config);

// Test utilities
export { MockDelegationSigner, createTestConfig, withMockedDelegationContext } from './testing';

// Lint helper (separate entry: '@agenticprimitives/mcp-resources/lint')
export async function lintMcpClassification(opts);
```

---

## 10. Non-goals

- **No MCP SDK bundling.** Consumers bring their own `@modelcontextprotocol/sdk` instance. We integrate by wrapping handlers.
- **No HTTP transport.** Hono/Express/raw stdio — the package is transport-agnostic.
- **No resource ORM.** We don't manage DB tables for the consumer's resources; only the JTI table.
- **No tool registry.** Smart-agent uses a literal map `{name, description, inputSchema, handler}`; consumers keep their preferred pattern.

---

## 11. Migration story from smart-agent's MCPs

For each of `person-mcp`, `org-mcp`, `people-group-mcp`:

1. Replace `src/auth/verify-delegation.ts` (~500 lines each) with config-driven `withDelegation` import.
2. Replace `src/auth/principal-context.ts` with the wrapper's per-handler args.
3. Migrate the JTI table to whichever `createXxxJtiStore` matches (no schema change required if table name kept).
4. Keep all audience strings, error messages, and table names — the package leaves these to the caller.
5. Run `lintMcpClassification` from CI to preserve the metadata invariants.

Expected net change: −800 to −1200 lines per MCP, with no behaviour difference at the boundary.

---

## 12. Test plan (v0)

- Unit: token verification happy/failure paths against fixtures (tampered sig, expired, exhausted JTI, unknown enforcer → reject).
- Integration: `withDelegation` wrapping a stub handler, exercised by `MockDelegationSigner`-issued tokens.
- Concurrency: `createSqliteJtiStore.trackUsage` under N=100 concurrent writers must produce exactly N usage counts with monotonically increasing values.
- Classification lint: golden tests for each `@sa-*` tag combination, and detection of missing required tags.

---

## 13. Smart-agent file index (provenance)

| Concern | File | Lines |
| --- | --- | --- |
| Person-MCP verify | `apps/person-mcp/src/auth/verify-delegation.ts` | 1–493 |
| Org-MCP verify | `apps/org-mcp/src/auth/verify-delegation.ts` | 85–223 |
| People-Group-MCP verify | `apps/people-group-mcp/src/auth/verify-delegation.ts` | full |
| Person principal context | `apps/person-mcp/src/auth/principal-context.ts` | 11–23 |
| Org principal context | `apps/org-mcp/src/auth/principal-context.ts` | 18–99 |
| People-Group principal | `apps/people-group-mcp/src/auth/principal-context.ts` | 31–110 |
| Caveat evaluator | `packages/sdk/src/policy/caveat-evaluator.ts` | 1–342 |
| Person-MCP cross-del tools | `apps/person-mcp/src/tools/received-delegations.ts` | 30–194 |
| Classification: routes | `scripts/check-route-classification.ts` | 1–71 |
| Classification: tools | `scripts/check-person-mcp-classification.ts` | 1–95 |
| Classification parser | `scripts/lib/person-mcp-classification-parser.ts` | 1–250+ |
| Canonical tool example | `apps/person-mcp/src/tools/profile.ts` | 1–100 |
