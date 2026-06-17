# @agenticprimitives/mcp-oauth — spec

Full design: [`../../specs/277-mcp-delegated-vault-authorization.md`](../../specs/277-mcp-delegated-vault-authorization.md) §6–§8 + §15.

OAuth is ONLY a compatibility adapter for public HTTP MCP clients — **not** the vault authority model.
This release: protected-resource metadata (§6.1), recommended scopes (§6.2), authorization_details RAR
shape (§6.3), bearer-token CLAIM validation (§8 — signature injected), and the Agentic Grant Bundle
(§7) `createMcpGrantBundle` / `bindOAuthTokenToGrantBundle` / `resolveGrantBundleFromToken`. A validated
token references the bundle by id+hash; the normal delegated vault path runs off the bundle's
delegation/entitlement hashes. Additive: the Cloudflare provider/store subpath, the authorization
server itself, and JWT/JWKS verification (app-supplied via the injected `verify`).

Decisions: [ADR-0021](../../docs/architecture/decisions/0021-generic-packages-vs-white-label-apps.md)
(runtime-agnostic; AS + bundle store live in apps) · [ADR-0013](../../docs/architecture/decisions/0013-no-silent-fallbacks.md)
(fail-closed token/bundle checks). An inbound MCP token is never reused downstream.

Do not edit a divergent copy here — edit the canonical spec.
