# `@agenticprimitives/fedcm-idp` — Security & Architecture Audit

**Status:** experimental (spec 264 Phase 1)
**Last refreshed:** 2026-06-05 (initial — FedCM IdP contract builders/validators)
**Owners:** fedcm-idp package CODEOWNERS
**System audit cross-reference:** [docs/architecture/product-readiness-audit.md](../../docs/architecture/product-readiness-audit.md)

## Scope

A **pure, dependency-free** library of builders + validators for the FedCM IdP wire contract. It performs
**no** network I/O, **no** crypto/signing, **no** storage, and holds **no** secrets. Output is plain JSON
shapes the app serves, and request-field parsers the app calls.

## Invariants (ADR-0031)

- **Thin assertion, not authority.** `buildAssertionClaims` produces only identity + intent
  (iss/aud/sub/origin/nonce/intent + optional agent_did/delegation_request_hash). It has no `scope`, no
  caveat, no capability. The capability/delegation object is issued by the substrate AFTER the assertion,
  in the app — never here.
- **`sub` is the stable account key** (the Smart Account address, ADR-0010), never a name — documented on
  `FedcmAccount.id` and `AssertionClaims.sub`.
- **Fail-closed validation.** `parseAssertionRequest` returns `null` (→ app returns 400) when any required
  field (client_id / account_id / nonce) is missing; malformed custom `params` are ignored, not trusted.
  `isWebIdentityRequest` is the `Sec-Fetch-Dest: webidentity` gate the app MUST apply before serving
  credentialed FedCM responses.

## What the APP must still own (not this package)

- **Signing** the assertion claims with the OIDC key + the existing JWKS (the relying app verifies via
  `(iss, sub)`); **the session / account list** behind `/fedcm/accounts`; the **`Sec-Fetch-Dest`** check
  on every credentialed endpoint; CORS / IdP-Signin-Status headers; and the **substrate delegation** that
  follows the assertion. This package gives the app the shapes + validators, not the trust decisions.

## Boundary (ADR-0021 / package-boundary doctrine)

- Zero runtime dependencies; no app imports, transport SDKs, wallet libs, or concrete hostnames (the app
  supplies origins/endpoints). Enforced by `capability.manifest.json` + `check:no-domain-in-packages`.

## Open items / risk

- **Contract drift:** FedCM IdP field names changed across Chrome 143→145 (structured JSON, endpoint
  validation). The builders MUST be re-verified against the current FedCM spec + a live Chrome before this
  package graduates from `private:true` (spec 264 Phase 1b). Until then it is unpublished.
