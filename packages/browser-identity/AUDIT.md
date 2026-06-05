# `@agenticprimitives/browser-identity` — Security & Architecture Audit

**Status:** experimental (spec 264 Phase 0)
**Last refreshed:** 2026-06-05 (initial — adapter seam)
**Owners:** browser-identity package CODEOWNERS
**System audit cross-reference:** [docs/architecture/product-readiness-audit.md](../../docs/architecture/product-readiness-audit.md)

## Scope

This package is a **pure, dependency-free selector** over injected sign-in strategies. It performs **no**
network I/O, **no** crypto, **no** storage, and holds **no** secrets. Its entire surface is
`fedcmAvailable()` (a feature-detect) + `chooseSignIn()` (a strategy picker) + two injection types.

## Invariants (ADR-0031)

- **Adapter, not substrate.** This package never issues, inspects, or stores authority. The result type
  `T` of a strategy is opaque to it; the capability/delegation object is issued by the substrate *after*
  sign-in, in the app — never here.
- **FedCM-first, not FedCM-only.** `chooseSignIn` runs FedCM only when `fedcmAvailable()` is true AND a
  `fedcm` strategy is provided; otherwise the **guaranteed** `fallback` (spec 259). The `fallback` is a
  required option — there is no code path that can strand a non-FedCM browser.
- **Fail-safe default.** `fedcmAvailable()` returns `false` off-browser / SSR and on any missing API
  surface, so the default is always the guaranteed fallback (never an unsupported FedCM call).
- **No silent escalation (ADR-0013).** `chooseSignIn` picks exactly ONE path per call; it does not try
  FedCM then silently fall back mid-flight. A failing strategy rejects to the caller.

## Boundary (ADR-0021 / package-boundary doctrine)

- Zero runtime dependencies; **no** app imports, transport SDKs (MCP/A2A/LangChain/Vercel), wallet libs,
  or concrete hostnames. The consumer injects origins + strategies. Enforced by
  `capability.manifest.json` (`forbiddenImports` / `forbiddenTerms`) + `check:no-domain-in-packages`.

## Threats considered

- **Downgrade / strategy confusion:** `prefer` can pin a path for tests/rollout; in production the
  default `'auto'` only *upgrades* to FedCM when genuinely supported, and `prefer:'fedcm'` with no
  `fedcm` strategy safely falls back (covered by unit tests).
- **Untrusted result:** out of scope — this package never reads `T`; assertion/token verification is the
  app's + substrate's responsibility (spec 264 reuses the existing JWKS/`(iss,sub)` verification).

## Open items

- Phase 1 (spec 264) adds the FedCM RP strategy + the demo-sso IdP endpoints; re-audit when the package
  graduates from `private: true` to publishable and gains the `fedcm-rp`/`fedcm-idp` siblings.
