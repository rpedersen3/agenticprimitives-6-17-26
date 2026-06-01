# `@agenticprimitives/key-custody`

`key-custody` protects service and operator signing keys. It provides signer
backends for relayers, service MACs, local development, and KMS-backed
production signing.

## Owns

- KMS-backed signer backends.
- Local development signer backends.
- Envelope encryption helpers.
- Service MAC helpers.
- viem account adapters for managed signers.
- Operational signing patterns for relayers and bridges.

## Does Not Own

- Person passkey ceremonies. Use `connect-auth`.
- Smart Agent custody policy. Use `account-custody`.
- App permission semantics. Use `delegation`.
- MCP enforcement. Use `mcp-runtime`.
- Product-specific secret management UI.

## Dependencies

Depends on:

- `types`
- `connect-auth`
- `audit`

## Consumers

Used by:

- `delegation`
- `mcp-runtime`
- relayer apps and operator flows
- deployment or top-up flows that need a managed signer

## Architecture Rules

- Apps should not hold raw private keys.
- Production signing should use a managed backend such as KMS.
- Local private keys are development-only and must stay clearly gated.
- Signing operations should emit useful audit evidence.

## Common Use

Use this package to create a KMS-backed viem account, sign service messages,
wrap/unwrap service sessions, or replace raw `*_PRIVATE_KEY` handling in app
code.

## Validation

Run:

```bash
pnpm check:key-custody
```
