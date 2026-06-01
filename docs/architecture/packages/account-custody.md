# `@agenticprimitives/account-custody`

`account-custody` owns the rules and call shapes for changing control of a Smart
Agent. It is the custody layer: credential add, remove, replace, recovery, and
quorum-governed control operations.

## Owns

- Custody action types.
- Credential add/remove/replace arguments.
- Recovery and quorum policy shapes.
- Typed-data helpers for custody-class operations.
- Pure call builders that can be submitted through a custody ceremony.

## Does Not Own

- Passkey ceremony details. Use `connect-auth`.
- Account deployment and UserOps. Use `agent-account`.
- App permission grants. Use `delegation`.
- Service key storage. Use `key-custody`.
- Product-specific recovery UI.

## Dependencies

Depends on:

- `types`

The package must avoid back-edges into `agent-account`, `delegation`, or runtime
packages.

## Consumers

Used by apps and account flows that need to change Smart Agent control. It is
often composed with `connect-auth` and `agent-account` at the app layer.

## Architecture Rules

- Custody is not delegation.
- Credential rotation must preserve the Smart Agent address.
- Delegations issued by the Smart Agent should survive credential recovery.
- Do not hide custody changes behind app-permission language.
- Keep builders pure and composable.

## Common Use

Use this package when the user is adding another passkey, replacing a lost
credential, appointing guardians/trustees, or changing threshold control for the
Smart Agent.

## Validation

Run:

```bash
pnpm check:custody
```
