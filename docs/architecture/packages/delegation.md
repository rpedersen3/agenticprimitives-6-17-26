# `@agenticprimitives/delegation`

`delegation` owns connected-app and on-behalf-of authority. It answers what an
agent, app, or service may do for another Smart Agent.

## Owns

- EIP-712 delegation structs, hashing, and signature helpers.
- Delegation token issuance and verification.
- Caveat and enforcer wiring.
- Session rows and revocation-oriented authority state.
- Attenuation semantics for delegated authority.

## Does Not Own

- Credential recovery or passkey replacement. Use `account-custody`.
- Credential proof ceremonies. Use `connect-auth`.
- Tool risk classification. Use `tool-policy`.
- MCP middleware. Use `mcp-runtime`.
- Service key storage. Use `key-custody`.

## Dependencies

Depends on:

- `types`
- `connect-auth`
- `agent-account`
- `key-custody`
- `audit`

## Consumers

Used by:

- `mcp-runtime`
- connected-app flows
- service-agent and on-behalf-of workflows
- apps that mint or revoke app permissions

## Architecture Rules

- Delegation is authority, not custody.
- Delegations are issued by the Smart Agent address and remain valid through
  credential rotation unless explicitly revoked or expired.
- Caveats must narrow authority, not widen it.
- EIP-712 typehashes must match contracts and off-chain clients.
- Verification should emit or support audit evidence for sensitive decisions.

## Common Use

Use this package when a person or org grants a relying app permission to sign in,
read approved profile data, call a tool, or act within a scoped policy.

## Validation

Run:

```bash
pnpm check:delegation
```
