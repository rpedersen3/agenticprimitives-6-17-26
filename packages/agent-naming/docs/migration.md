# Agent Naming Migration Notes

## Current Status

`@agenticprimitives/agent-naming` is experimental. Public helpers, record
schemas, ABIs, and call builders are present, but contract deployments and demo
wiring may still change before a stable release.

## Versioning Policy

Before `1.0`, breaking changes may happen when:

- the contract ABI changes
- record predicates change
- normalization rules change
- the client write path changes
- package-boundary rules move logic to another package

Every breaking change should update:

1. `README.md`
2. `docs/api.md`
3. `docs/security.md` when invariants change
4. `capability.manifest.json`
5. tests or examples that show the changed path

## Canonical-Identifier-First Wiring

New integrations should follow [spec 220](../../../specs/220-agent-identity-bootstrap.md):

1. Deploy or resolve the Smart Agent (`agent-account`) — canonical `Address`.
2. Register a forced-unique `.agent` name pointing at that address (this package).
3. Enroll custodians (`custody` + `identity-auth` ceremonies).
4. Optionally publish a profile (`agent-identity`).

Display both in UI:

```text
Canonical Agent ID: eip155:84532:0x…
Name:               alice.agent   (facet — may be alice2.agent if taken)
```

## From Ad Hoc Address Config To Names

Old app wiring often carries raw addresses and endpoint URLs in local config:

```ts
const treasury = '0x...';
const mcpEndpoint = 'https://...';
```

New wiring should resolve through names and records:

```ts
const treasury = await naming.resolveName('treasury.acme.agent');
const records = await naming.getRecords('treasury.acme.agent');
```

Keep raw addresses as fallback diagnostics, not primary UI.

## From Metadata-Only Profiles To Typed Records

Use resolver records for small, frequently-read discovery fields:

- `addr`
- `displayName`
- `agentKind`
- `a2aEndpoint`
- `mcpEndpoint`
- `nativeId`

Use `metadataUri` plus `metadataHash` for larger profile documents.

## From Direct Writes To Encoded Calls

When writes need custom submission, prefer call builders:

```ts
const call = buildRotateNameResolverCall({ registry, node, newResolver });
```

Then submit the call through the appropriate Smart Agent, relayer, or account
policy path.

## Future Migration Hooks

Expected future migration areas:

- IDN/punycode support beyond ASCII labels.
- Generated API docs or manifest-doc synchronization.
- Example typecheck enforcement.
- Stable deployment address package.
- Optional compatibility layer for external on-chain name resolvers.
