# `@agenticprimitives/agent-relationships`

`agent-relationships` models graph context between Smart Agents. It describes
membership, governance, trust, affiliation, and other relationship edges without
granting executable authority.

## Owns

- Relationship edge types.
- Relationship roles and statuses.
- Graph context between person, org, service, and treasury service-agent subtype
  instances.
- Relationship validation helpers.
- Relationship lifecycle shapes.

## Does Not Own

- Naming hierarchy. Use `agent-naming`.
- Delegated executable authority. Use `delegation`.
- Custody or recovery.
- Directory query storage. Use `identity-directory` and adapters.
- Product-specific org charts.

## Dependencies

Depends on:

- `types`
- `connect-auth`
- `agent-account`

## Consumers

Used by discovery, directory, org membership, and trust-graph flows.

## Architecture Rules

- Relationships are context, not permission.
- Naming hierarchy is parent-pointer-based in `agent-naming`, not a relationship
  edge.
- Revocation/confirmation semantics should be explicit.
- Cross-agent graph data must continue to point at canonical Smart Agent
  addresses.

## Common Use

Use this package when showing that a person belongs to an org, a service is
operated by an org, a treasury service agent is associated with a community, or
an agent is trusted for a specific role.

## Validation

Run:

```bash
pnpm check:agent-relationships
```
