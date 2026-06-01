# `@agenticprimitives/agent-profile`

`agent-profile` owns the public profile facet for Smart Agents. It describes who
or what an agent is for discovery and UX without becoming the canonical identity
or login session.

## Owns

- AgentCard/profile shapes.
- CAIP-10 profile helpers.
- Profile content hashing.
- Endpoint verification shapes.
- Public metadata and `authOrigin` style profile properties.
- Profile subtype fields, including treasury metadata for service agents.

## Does Not Own

- Names and resolver records. Use `agent-naming`.
- Credential proof. Use `connect-auth`.
- Account deployment or execution. Use `agent-account`.
- Delegated authority. Use `delegation`.
- Directory querying. Use `identity-directory`.

## Dependencies

Depends on:

- `types`
- `connect-auth`
- `agent-account`

## Consumers

Used by apps and directory flows that need to show, filter, or verify agent
metadata.

## Architecture Rules

- Profiles are facets pointing at the Smart Agent address.
- Profile data may improve discovery, but it must not replace account authority.
- Treasury is a service/profile subtype, not a top-level Smart Agent kind.
- Endpoint records are hints unless separately verified.

## Common Use

Use this package when publishing or reading an AgentCard, anchoring metadata with
a content hash, describing service capabilities, or exposing a secure-home
`authOrigin` for agent sign-in.

## Validation

Run:

```bash
pnpm --filter @agenticprimitives/agent-profile typecheck
pnpm --filter @agenticprimitives/agent-profile test
```
