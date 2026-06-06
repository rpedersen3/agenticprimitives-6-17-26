# @agenticprimitives/fedcm-rp — Claude guide

The **relying-party** side of FedCM (spec 264 Phase 1; [ADR-0031](../../docs/architecture/decisions/0031-fedcm-and-browser-credential-apis-are-adapters.md)).

## What this package owns
- `fedcmSupported()` — `'IdentityCredential' in window` feature-detect (SSR-safe).
- `fedcmGet({ providers, context?, mode?, mediation?, signal? })` — wraps `navigator.credentials.get({ identity })` and returns `{ token, configURL?, isAutoSelected? }`. Post-145 shape: `configURL` + `clientId`, and `nonce` + custom params ride INSIDE `params`.

## What this package does NOT own
- **The substrate / authority.** The returned `token` is a THIN identity bootstrap; the capability/delegation object is obtained from the substrate AFTER (ADR-0031).
- **The strategy choice.** This is the FedCM strategy a consumer INJECTS into `browser-identity.chooseSignIn({ fedcm, fallback })`; that package decides FedCM-vs-fallback.
- **App/transport/hostname imports** (generic, ADR-0021). The app supplies `configURL` + `clientId` + `params`.

## Draft caveat
FedCM is Chromium-only + the field names changed Chrome 143→145 (`params.nonce`, `.error`). Verify against a live Chrome before this graduates from `private:true` (spec 264 Phase 1b).

## Validate
`pnpm --filter @agenticprimitives/fedcm-rp build && pnpm --filter @agenticprimitives/fedcm-rp test`
