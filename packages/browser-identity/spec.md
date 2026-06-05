# browser-identity — package spec

This package implements **Phase 0** of [spec 264 — FedCM IdP adapter](../../specs/264-fedcm-idp-adapter.md),
under [ADR-0031](../../docs/architecture/decisions/0031-fedcm-and-browser-credential-apis-are-adapters.md)
(FedCM and browser credential APIs are integration adapters, not the substrate).

## Phase 0 scope (this package, today)

The **adapter seam**: a generic, transport-agnostic selector that feature-detects FedCM and chooses the
browser-native path vs the guaranteed spec-259 fallback. The concrete strategies are injected by the
consumer; this package never imports an app, a transport, the substrate, or a hostname, and never
inspects the strategy result.

- `fedcmAvailable(): boolean` — feature-detect `navigator.credentials.get({identity})` + `IdentityCredential`.
- `chooseSignIn<T>({ fedcm?, fallback, prefer? }): Promise<T>` — FedCM-first, not FedCM-only.
- `SignInStrategy<T>`, `ChooseSignInOptions<T>` — injection types.

With no `fedcm` strategy, `chooseSignIn` runs the `fallback` — **zero behaviour change** vs calling the
launcher directly. Relying apps (demo-gs, demo-jp) route their connect launch through `chooseSignIn` so
the seam is in place for Phase 1.

## Later phases (NOT in this package yet)

Per spec 264: Phase 1 the FedCM RP strategy (`fedcm-rp`) + the demo-sso IdP endpoints (`fedcm-idp`);
Phase 2 multi-IdP (Person/Org Agent chooser); Phase 3 intent + `delegation_request_hash` binding; Phase 4
the Digital Credentials API companion. The substrate always issues the deep capability/delegation object
*after* this seam resolves identity (ADR-0031).
