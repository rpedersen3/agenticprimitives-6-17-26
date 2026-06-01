# `@agenticprimitives/connect`

`connect` contains Agentic Connect broker primitives: verifiable sign-in results,
OIDC-compatible token surfaces, JWKS publishing, and redirect/code helpers.

## Owns

- Asymmetric `AgentSession` issuance and verification helpers.
- OIDC `id_token` helper shapes.
- JWKS and broker signing-key surfaces.
- Redirect, state, nonce, and code-flow helpers.
- Issuance gates that bind sessions to a canonical Smart Agent subject.

## Does Not Own

- Passkey/WebAuthn ceremonies. Use `connect-auth`.
- Smart Agent deployment. Use `agent-account`.
- App authority grants. Use `delegation`.
- Directory storage or indexing. Use `identity-directory` and adapters.
- Relying-site UI.

## Dependencies

Depends on:

- `types`
- `connect-auth`
- `identity-directory`

## Consumers

Used by secure-home / SSO brokers and relying-site demos that need a signed,
JWKS-verifiable login result.

## Architecture Rules

- `AgentSession.sub` is the canonical Smart Agent identifier.
- Do not add an `owner` field to the session subject model.
- Broker signing keys are server-side in production; browsers consume JWKS.
- OIDC is a login interop surface, not the authority model.
- Connected-app authority belongs in `delegation`.

## Common Use

Use this package when a relying site needs to redirect to a secure home, receive
a signed login result, verify it through JWKS, and bind the app session to the
Smart Agent address.

## Validation

Run:

```bash
pnpm --filter @agenticprimitives/connect typecheck
pnpm --filter @agenticprimitives/connect test
```
