# `@agenticprimitives/agent-naming`

`agent-naming` is the name facet package. It resolves deployment-configured
names such as `rich-pedersen.impact` to Smart Agent addresses and provides pure
call builders for name-management operations.

## Owns

- Name normalization.
- Recursive `labelhash` and `namehash` (the `keccak256(parentNode || labelhash)` convention).
- Registry and resolver client helpers.
- Name record types and record encoders.
- Primary-name reverse record helpers.
- Pure call builders for registration, owner/resolver rotation, records, and
  subregistry claims.

## Does Not Own

- Canonical identity. The Smart Agent address is canonical.
- Passkey ceremonies. Use `connect-auth`.
- Account deployment. Use `agent-account`.
- Custody approval flows. Use `account-custody`.
- Discovery read-model composition. Use `identity-directory`.

## Dependencies

Depends on:

- `types`
- `connect-auth`
- `agent-account`

## Consumers

Used by:

- `identity-directory-adapters`
- apps that resolve names or claim names
- secure-home signup flows
- profile and discovery flows

## Architecture Rules

- Names point at the Smart Agent address; names are not identity.
- Apps configure their root suffix, such as `.impact`.
- Root/TLD creation is permissioned.
- Child issuance is decided by the parent owner or delegated subregistry.
- Resolver records are discovery data, not authorization.

## Common Use

Use this package to resolve `rich-pedersen.impact`, claim a name, set a primary
name, set name records, or wire a permissionless subregistry for open community
claims.

## Related Architecture

See [`../naming-service-architecture.md`](../naming-service-architecture.md).

## Validation

Run:

```bash
pnpm check:agent-naming
```
