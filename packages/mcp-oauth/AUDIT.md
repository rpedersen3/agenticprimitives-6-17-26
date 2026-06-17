# @agenticprimitives/mcp-oauth — audit notes

**Status:** OAuth compat + grant-bundle bridge (spec 277 §6–§8,§15). No authorization server, no JWT/JWKS verification, no bundle store built-in.

## Trust model
- OAuth is **compatibility ingress only**, never the authority. A token is accepted only as a *pointer*
  to a grant bundle (id + hash); the real authorization (delegation/entitlement/key-release) runs off
  the bundle. No private payload rides in the token.
- **Signature verification is INJECTED** (`validateMcpBearerToken({ verify })`) — this package enforces
  the CLAIM policy (audience/resource, issuer allowlist, expiry/nbf, scopes, grant-binding presence) but
  trusts the caller's `verify` for cryptographic token integrity. A caller MUST supply a real JWKS/JWT verifier.
- **Anti-swap:** `resolveGrantBundleFromToken` rejects unless the stored bundle's hash equals the token's
  `ap_grant_hash`, and the bundle is active + unexpired (fail-closed).
- **No downstream reuse:** inbound MCP tokens are not forwarded; the bridge returns claims/bundle, not the token.

## Security invariants (tested — `test/unit/mcp-oauth.test.ts`)
- Token claim checks fail closed: missing/expired/nbf/audience/issuer/client/scope/grant-binding each → specific reason.
- `requireScopes` reports the exact missing scopes; `buildInsufficientScopeResponse` is a 403 with WWW-Authenticate.
- Grant-bundle hash is canonical + stable; `resolveGrantBundleFromToken` rejects hash-mismatch / revoked / expired / not-found.
- Field-level authority is NOT in scopes (coarse hints only); fields live in the bundle's entitlements.

## Not yet present (additive — do not assume)
- The authorization server (`/authorize`,`/token`,`/register`), JWT/JWKS verification, the Cloudflare
  provider + encrypted grant-bundle store (`createCloudflareMcpOAuthProvider`/`createCloudflareGrantBundleStore`).
