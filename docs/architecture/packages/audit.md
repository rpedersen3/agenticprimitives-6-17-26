# `@agenticprimitives/audit`

`audit` provides evidence primitives for security, support, operations, and
external review. It makes important decisions observable without binding packages
to one persistence backend.

## Owns

- Audit event schemas.
- Audit sinks and sink interfaces.
- Guardrail and metric primitives.
- Correlation and trace context shapes.
- Shared evidence vocabulary used by packages and apps.

## Does Not Own

- Concrete long-term storage for every app.
- Product analytics dashboards.
- Authorization decisions.
- Policy classification. Use `tool-policy`.
- Runtime enforcement. Use protocol runtime packages.

## Dependencies

Depends on:

- `types`

## Consumers

Used by:

- `delegation`
- `identity-directory`
- `key-custody`
- `mcp-runtime`
- apps that need support or audit evidence

## Architecture Rules

- Emit evidence close to the decision being made.
- Keep sink interfaces generic so apps can choose storage.
- Avoid logging secrets, raw credential IDs, or private key material.
- Audit evidence should help answer who, what, when, why, and under which
  authority.

## Common Use

Use this package when a flow needs evidence for credential changes, delegation
grants, tool execution, service signing, directory lookup, or production
readiness checks.

## Validation

Run:

```bash
pnpm check:audit
```
