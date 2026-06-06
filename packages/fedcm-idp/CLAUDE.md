# @agenticprimitives/fedcm-idp — Claude guide

The **FedCM IdP contract** as pure builders + validators (spec 264 Phase 1; [ADR-0031](../../docs/architecture/decisions/0031-fedcm-and-browser-credential-apis-are-adapters.md)).

## What this package owns
- `buildWebIdentity(urls)` — the `/.well-known/web-identity` body.
- `buildProviderConfig(input)` — the `/fedcm/config.json` body (endpoints + branding).
- `buildAccountsResponse(accounts)` + `FedcmAccount` — the chooser rows; `id` is the SA address (stable key, ADR-0010), never a name.
- `buildAssertionClaims(input)` — the **thin** identity+intent assertion claims (iss/aud/sub/origin/nonce/intent + optional agent_did/delegation_request_hash).
- `isWebIdentityRequest(secFetchDest)` + `parseAssertionRequest(form)` — request validators (fail-closed).

## What this package does NOT own
- **No I/O, no key, no signing.** The demo-sso app hosts the endpoints, owns the session + account list, and signs the assertion claims with its OIDC key (existing JWKS).
- **No authority.** The assertion is a thin BOOTSTRAP; the capability/delegation object is issued by the substrate AFTER, never as a FedCM scope (ADR-0031).
- **No app/transport/hostname imports** (generic, ADR-0021). The app supplies origins + endpoint paths.

## Draft caveat
FedCM IdP field names follow the W3C/Chrome contract, which had breaking changes Chrome 143→145. **Verify against the current spec + a live Chrome before this package graduates from `private:true`** (spec 264 Phase 1b).

## Validate
`pnpm --filter @agenticprimitives/fedcm-idp build && pnpm --filter @agenticprimitives/fedcm-idp test`
