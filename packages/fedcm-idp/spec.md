# fedcm-idp — package spec

This package implements the **generic IdP-contract core** of [spec 264 — FedCM IdP adapter](../../specs/264-fedcm-idp-adapter.md)
Phase 1, under [ADR-0031](../../docs/architecture/decisions/0031-fedcm-and-browser-credential-apis-are-adapters.md)
(FedCM is an adapter over the authority substrate, not the substrate).

## Scope (this package, today)

Pure builders + validators for the FedCM IdP wire contract — no I/O, no key, no signing:

- `buildWebIdentity(urls)` → `/.well-known/web-identity`.
- `buildProviderConfig(input)` → `/fedcm/config.json` (accounts / id_assertion / login / client_metadata /
  disconnect endpoints + branding).
- `buildAccountsResponse(accounts)` + `FedcmAccount` → `/fedcm/accounts` rows (`id` = SA address).
- `buildAssertionClaims(input)` → the THIN id-assertion claims (the app signs them).
- `isWebIdentityRequest(secFetchDest)` + `parseAssertionRequest(form)` → fail-closed validators.

## NOT in this package (Phase 1b — app + verification)

- The demo-sso **route handlers** that host the 7 endpoints, the OIDC **signer**, the **account list**
  (from the home session), CORS / IdP-Signin-Status headers, the RP-side `fedcm-rp` `get()` wrapper, and
  the injection of the FedCM strategy into `browser-identity`'s `chooseSignIn`.
- A **live-Chrome verification** of the full handshake against deployed origins. The FedCM IdP field names
  had breaking changes Chrome 143→145 and MUST be re-verified there before this package is published.

The deep capability/delegation object is always issued by the substrate AFTER the assertion (ADR-0031).
