# fedcm-rp — package spec

The **relying-party** half of [spec 264 — FedCM IdP adapter](../../specs/264-fedcm-idp-adapter.md)
Phase 1, under [ADR-0031](../../docs/architecture/decisions/0031-fedcm-and-browser-credential-apis-are-adapters.md).

## Scope (this package)

- `fedcmSupported()` — `'IdentityCredential' in window`.
- `fedcmGet({ providers, context?, mode?, mediation?, signal? })` → `navigator.credentials.get({ identity })`
  (post-145 shape: `configURL` + `clientId`, `nonce`/custom params inside `params`) → `{ token, configURL?,
  isAutoSelected? }`.

It is the FedCM strategy injected into `browser-identity.chooseSignIn`. The token is a thin bootstrap; the
substrate issues the capability/delegation AFTER (ADR-0031).

## NOT in this package (Phase 1b)

The demo-sso IdP endpoints (`fedcm-idp` + route handlers + OIDC signer + session account list), wiring
this strategy into demo-gs/demo-jp's `chooseSignIn`, and the live-Chrome verification of the full
handshake against deployed origins.
