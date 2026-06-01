# `@agenticprimitives/connect-auth`

`connect-auth` is the credential proof package. It proves that a person or
service controls a credential; it does not decide what that credential is allowed
to do.

## Owns

- Passkey and WebAuthn helpers.
- SIWE verification helpers.
- OIDC login helpers where the login provider is a credential facet.
- JWT cookie/session helpers used by auth surfaces.
- CSRF, salts, and credential-safe utilities.
- `Signer`-style interfaces consumed by higher layers.

## Does Not Own

- Smart Agent deployment or account execution. Use `agent-account`.
- Custody policy, recovery, or credential replacement. Use `account-custody`.
- App permission grants. Use `delegation`.
- Broker-issued `AgentSession` / JWKS semantics. Use `connect`.
- White-label signup copy or relying-site UX.

## Dependencies

Depends on:

- `types`

It should stay low-level and mostly stateless.

## Consumers

Used by:

- `agent-account`
- `agent-naming`
- `agent-profile`
- `agent-relationships`
- `connect`
- `delegation`
- `key-custody`
- secure-home and relying-site apps

## Architecture Rules

- A passkey is a credential facet, not the canonical identity.
- Raw credential IDs must not be stored in public records.
- Credential proof must be separated from authority decisions.
- Do not add product-specific app names, domains, or onboarding state.

## Common Use

Use this package to prove a passkey, wallet, or login credential before another
package decides whether that proof can deploy an account, rotate custody, issue a
session, or grant an app permission.

## Validation

Run:

```bash
pnpm --filter @agenticprimitives/connect-auth typecheck
pnpm --filter @agenticprimitives/connect-auth test
```
