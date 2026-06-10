# @agenticprimitives/mcp-runtime

**The same delegation that authorizes a web app session authorizes an MCP tool call.** Most MCP servers gate tools with API keys or OAuth scopes — bearer credentials that say nothing about *who delegated the authority, under which limits, or whether it was revoked five minutes ago*. This package replaces that with the agenticprimitives delegation primitive: an EIP-712-signed, caveat-constrained, on-chain-revocable grant from a canonical Smart Agent. When the principal revokes, the tool stops working. When the time window closes, the tool stops working. No key rotation, no scope audit, no guessing.

Part of [agenticprimitives](../../README.md) — the trust substrate for the agent economy: one canonical Smart Agent identity with custody, delegation, naming, credentials, and audit evidence designed as one system.

This package is the **decision layer**, not the SDK. The official `@modelcontextprotocol/sdk` already provides tool/resource/prompt registration, transports, and OAuth 2.1 + PKCE + RFC-9728 + RFC-8707 plumbing (mandated by the 2026-03-15 MCP spec) — you bring it as a peer dependency. We add the bridge to `@agenticprimitives/delegation` + `@agenticprimitives/tool-policy`: one wrapper that turns "anyone with the URL" into "exactly the principals with a live, scoped grant." It also eliminated the ~65% authorization-code duplication observed across smart-agent's three mature MCP servers.

See [`spec.md`](./spec.md) → [`specs/205-mcp-runtime.md`](../../specs/205-mcp-runtime.md), and [ADR-0004](../../docs/architecture/decisions/0004-mcp-runtime-as-middleware.md) for why middleware, not SDK.

## Quick start

```ts
import { McpServer } from '@modelcontextprotocol/sdk/server';
import { withDelegation, createSqliteJtiStore } from '@agenticprimitives/mcp-runtime';

const config = {
  audience: 'urn:mcp:server:person',
  chainId: 31337,
  rpcUrl: process.env.RPC_URL!,
  delegationManager: process.env.DELEGATION_MANAGER_ADDRESS as `0x${string}`,
  enforcerMap,
  jtiStore: createSqliteJtiStore(db, 'token_usage'),
};

const server = new McpServer({ name: 'person-mcp', version: '0.1.0' });

server.registerTool({
  name: 'get_profile',
  inputSchema: { type: 'object', properties: { token: { type: 'string' } } },
  handler: withDelegation(config, async ({ principal }) => {
    return db.profiles.findUnique({ where: { ownerAddress: principal } });
  }),
});
```

The handler no longer touches auth. The wrapper runs the full pipeline on every call: HMAC envelope check → session-key signature → EIP-712 hash → on-chain `isRevoked` → ERC-1271 verify → caveat eval (fail-closed) → JTI usage tracking → `tool-policy.evaluatePolicy` → hand `{ principal, grants? }` to the inner handler. Rejections return a single uniform auth-failed error — externally, a malformed token is indistinguishable from an expired, revoked, or caveat-failed one, so probing leaks nothing.

## What ships

- **`withDelegation`** — the tool-handler wrapper above; the headline feature.
- **JTI replay protection** — `createSqliteJtiStore`, `createPostgresJtiStore`, `createMemoryJtiStore`; atomic single-use tracking under concurrent writers.
- **`declareResource`** — joins `tool-policy` classification with MCP resource metadata.
- **`verifyDelegationForResource`** — the low-level verification entry point.
- **Service-to-service MAC** — `generateServiceMac` / `verifyServiceMac` for the inter-service HTTP envelope.
- **Test harness** (`/testing` subpath) — `MockDelegationSigner`, `createTestConfig`, `withMockedDelegationContext`.
- **Classification lint** (`/lint` subpath) — `lintMcpClassification`, MCP defaults over `tool-policy.lintClassification`.
- **Audit events** — `mcp-runtime.with-delegation.{accept,reject}` and `mcp-runtime.service-mac.{accept,reject}`, correlation-stitched via a caller-supplied `correlationId` ([spec 206](../../specs/206-audit.md)).

## How it's different

The competing pattern is **OAuth scopes, API keys, and MCP auth middleware** — server-side allow-lists checked against a bearer credential. Three structural gaps this package closes:

- **Provenance.** A scope string says what; a delegation proves *who granted it* — the principal's Smart Agent signature, verified ERC-1271 against the account on chain. Every accepted call is attributable to a canonical address, not an API-key row.
- **Live revocation.** API keys are revoked by rotating them everywhere they leaked. A delegation is revoked once, on chain; the wrapper checks `isRevoked` on every call.
- **One model across surfaces.** The grant your user issued in a web app is the same grant your MCP server verifies — same caveats (time window, value cap, allowed methods), same revocation, same audit trail. ERC-8004 registries and agent discovery are being settled this year; the substrate that wins is the one where tool access, agent calls, and on-chain spend share a single authority model. That is the design center here.

We do not replace the MCP spec's transport-level OAuth — that stays in the official SDK. We answer the question OAuth cannot: *on whose delegated authority is this tool executing right now?*

## Cross-delegation

Removed from the public surface in H7-B.8 (XPKG-002 / EXT-024 closure). The previous `withCrossDelegation` was a stub that unconditionally rejected. Per spec 100 §6, experimental capability lives behind a `./experimental` subpath; when cross-delegation work resumes it lands there. See [the production-readiness audit](../../docs/audits/2026-05-packages-contracts-production-readiness.md) (PKG-mcp-runtime-001).

## Validation

```bash
pnpm --filter @agenticprimitives/mcp-runtime typecheck
pnpm --filter @agenticprimitives/mcp-runtime test
pnpm check:forbidden-terms
```

## Status

Testnet/pilot-ready. Production launch is gated on the public checklist in the root [`README.md`](../../README.md#status--honest-version) — including third-party contract audit and governance key rotation. Track every security finding live in [`docs/audits/findings.yaml`](../../docs/audits/findings.yaml). Spec + API are stable; `capability.manifest.json` marks this package `experimental` until those gates clear.

## License

UNLICENSED (internal monorepo, not published).
