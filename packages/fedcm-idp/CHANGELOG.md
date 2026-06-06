# @agenticprimitives/fedcm-idp

## 1.0.0-alpha.6

### Initial (spec 264 Phase 1)

- FedCM IdP contract as pure builders + validators: `buildWebIdentity`, `buildProviderConfig`,
  `buildAccountsResponse`, `buildAssertionClaims` (thin), `isWebIdentityRequest`, `parseAssertionRequest`.
- `private: true` until the demo-sso endpoints + a live-Chrome verification land (Phase 1b). ADR-0031.
