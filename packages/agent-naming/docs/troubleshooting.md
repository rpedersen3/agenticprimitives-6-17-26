# Agent Naming Troubleshooting

## `InvalidNameError`

The name failed normalization.

Common causes:

- empty string
- leading or trailing dot
- consecutive dots
- label starts or ends with `-`
- non-ASCII character
- label longer than 63 characters

Use `isValidAgentName(name)` for UI validation and `normalizeAgentName(name)`
when you want the canonical value or a detailed thrown error.

## `resolveName(name)` Returns `null`

Possible causes:

- the name is not registered
- the name has no resolver
- the resolver has no `addr` record
- the configured registry/universal resolver addresses point to the wrong chain

Check `chainId`, `registry`, `universalResolver`, and the normalized name.

## `reverseResolve(address)` Returns `null`

Possible causes:

- the address has no primary name
- the primary name node cannot be reconstructed from registry events
- round-trip verification failed

Round-trip failure means the primary name points somewhere else or no longer
resolves to the given address.

## Empty Records From `getRecords(name)`

An empty object means no known records were read. Common causes:

- no resolver is set
- records have not been written
- the resolver is on a different chain
- records exist only under newer predicates this SDK does not know yet

Unknown predicates are ignored on decode by design.

## Unknown Predicate Dropped On Decode

This is expected. Decode is forward-compatible and silently ignores unknown
predicate ids.

If the record should be first-class, add it to:

1. `src/types.ts`
2. `src/records.ts`
3. `test/records.test.ts`
4. `docs/api.md`
5. `capability.manifest.json`

## Unknown Or Invalid Record Rejected On Encode

Encode is strict. Known fields validate their expected shape:

- addresses must be 20-byte hex strings
- `bytes32` values must be 32-byte hex strings
- `agentKind` must be `person`, `org`, or `service` (a treasury is a `service`
  agent; the `treasury` distinction lives on the profile, not the agent kind)
- `nativeId` must match CAIP-10 grammar and use an allowed namespace

## Native ID Validation Failed

Expected shape:

```text
eip155:84532:0x0000000000000000000000000000000000000003
```

`nativeId` must match the `addr` record for the same Smart Agent on EVM chains.
If you need a new CAIP-10 namespace, add it deliberately to
`CAIP10_NAMESPACE_ALLOWLIST` and include a test vector.

## Resolver Unset

`setAgentRecords` requires the name to have a resolver. Install a resolver
through registry owner flow before writing records.

## Subregistry Unset

If a parent has no subregistry, child registration falls back to parent-owner
authorization. If a product expects permissionless or credential-gated child
registration, confirm `setSubregistry` has been applied to the parent node.

## Transaction Write Fails

The client write methods submit raw encoded calls through the supplied
`walletClient`. The caller must be authorized by the contracts.

If writes need to pass through a Smart Agent, relayer, or scheduled approval
flow, use the pure call builders in `@agenticprimitives/agent-naming/custody`
and submit them through that external flow.

## Confused Name With Identity

Symptom: CREATE2 address changes when the user picks a different `.agent` label,
or APIs accept only a name string with no `Address`.

Fix:

- Deploy / resolve the Smart Agent first (`agent-account`).
- Register the name as a facet pointing at that address.
- Never derive CREATE2 salt from the chosen `.agent` name ([spec 220](../../../specs/220-agent-identity-bootstrap.md)).
