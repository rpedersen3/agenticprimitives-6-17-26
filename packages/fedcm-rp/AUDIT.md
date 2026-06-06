# `@agenticprimitives/fedcm-rp` — Security & Architecture Audit

**Status:** experimental (spec 264 Phase 1)
**Last refreshed:** 2026-06-05 (initial — RP FedCM wrapper)
**Owners:** fedcm-rp package CODEOWNERS
**System audit cross-reference:** [docs/architecture/product-readiness-audit.md](../../docs/architecture/product-readiness-audit.md)

## Scope

A **pure, dependency-free** wrapper over `navigator.credentials.get({ identity })`. No storage, no crypto,
no secrets; it builds the request, calls the browser API, and returns the token string.

## Invariants (ADR-0031)

- **Thin token, not authority.** The returned `token` is a thin identity bootstrap (our assertion JWT,
  `sub` = SA address). It is NOT inspected here and carries no authority; the capability/delegation object
  is obtained from the substrate AFTER, in the app.
- **FedCM-first, not FedCM-only.** `fedcmGet` throws when `fedcmSupported()` is false; the consumer gates
  on it / catches and uses the spec-259 fallback via `browser-identity.chooseSignIn`. There is no path
  that strands a non-FedCM browser.
- **No silent escalation (ADR-0013).** One ceremony per call; a throw propagates to the caller (→ the
  injected fallback), never a hidden retry to a different mechanism.

## Threats considered

- **Nonce/replay:** the RP supplies a fresh `nonce` in `params` (post-145); the IdP binds it into the
  assertion and the app verifies it on exchange (out of scope here — app/substrate responsibility).
- **Token trust:** out of scope — this package never reads the token; verification (JWKS, `(iss, sub)`,
  nonce, origin) is the app's + substrate's job (spec 264 reuses the existing OIDC verification).

## Boundary + open items

- Zero runtime deps; no app/transport/hostname imports (ADR-0021; `capability.manifest.json`).
- **Browser/contract risk:** FedCM is Chromium-only and the RP shape changed Chrome 143→145
  (`params.nonce`, the `.error` DOM property). Re-verify against a live Chrome before this package
  graduates from `private:true` (spec 264 Phase 1b).
