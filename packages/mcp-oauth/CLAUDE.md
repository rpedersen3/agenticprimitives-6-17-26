# @agenticprimitives/mcp-oauth — Claude guide

MCP **OAuth compatibility** adapter + **Agentic Grant Bundle** bridge (spec 277 §6–§8, §15).
OAuth here is ONLY an ingress adapter for public HTTP MCP clients — **NOT the vault authority model**.
A validated bearer token carries a *reference + hash* to a grant bundle; the normal delegated vault
path (delegation → entitlement → DecryptGrant/KAS) runs off the bundle.

## What this package owns
- Protected-resource metadata (`createProtectedResourceMetadata` / `serveProtectedResourceMetadata`).
- Scopes (`MCP_OAUTH_SCOPES`) + WWW-Authenticate challenges (`createWwwAuthenticateChallenge`,
  `buildUnauthorizedResponse`, `buildInsufficientScopeResponse`).
- Bearer-token CLAIM validation (`validateMcpBearerToken`, `requireMcpAudience`, `requireScopes`,
  `parseBearer`) — **signature is injected**.
- `authorization_details` (RAR) shape (`parse`/`buildAuthorizationDetailsRequest`).
- `McpGrantBundleV1` + `createMcpGrantBundle` (canonical hash) + `bindOAuthTokenToGrantBundle` +
  `resolveGrantBundleFromToken` (store injected).

## What this package does NOT own
- **The authorization server** (`/authorize`, `/token`, `/register`) + **JWT/JWKS verification** —
  app/runtime supplied; `validateMcpBearerToken` takes an injected `verify`.
- **The encrypted grant-bundle store** + Cloudflare provider — platform types, live in the app
  (`createCloudflareMcpOAuthProvider` / `createCloudflareGrantBundleStore` are the additive subpath).
- **Authority** — delegation/entitlement/key-release. OAuth only *bridges* to them via the bundle.

## Hard rules
- An inbound MCP token is **never** reused downstream (use a separate token / RFC 8693 exchange).
- No private delegation/entitlement payload in tokens — only id + hash references.
- Field-level authority is **not** encoded in scopes (scopes are coarse hints); fields live in the
  entitlement/grant bundle.

## Boundary
Generic, transport-agnostic (ADR-0021), fail-closed (ADR-0013). Dependency-free (Web `Response` +
WebCrypto only). No MCP-SDK / storage / KMS imports, no vertical vocabulary.

## Validate
```bash
pnpm --filter @agenticprimitives/mcp-oauth typecheck
pnpm --filter @agenticprimitives/mcp-oauth test
```
