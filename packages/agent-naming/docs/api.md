# Agent Naming API

This is the human-readable guide to the public exports in
`capability.manifest.json`. Keep it in sync with `src/index.ts`.

## Constants

- `AGENT_TLD`: the canonical top-level label, currently `"agent"`.
- `AgentTld`: type of the canonical top-level label.
- `ZERO_NODE`: the all-zero ENS root node.

## Name Helpers

- `normalizeAgentName(name)`: returns the canonical lowercase ASCII name or
  throws `InvalidNameError`.
- `isValidAgentName(name)`: boolean wrapper around `normalizeAgentName`.
- `labelhash(label)`: keccak256 hash of a single label.
- `namehash(name)`: ENS-compatible recursive namehash of a normalized name.

## Client

- `AgentNamingClient`: viem-backed read/write client for registry and resolver
  contracts.
- `AgentNamingClientOpts`: constructor options: `rpcUrl`, `chainId`,
  `registry`, and `universalResolver`.
- `WriteContext`: per-call wallet context used by write methods.

Read methods:

- `resolveName(name)`: returns the resolved Smart Agent address or `null`.
- `reverseResolve(agent)`: returns the primary name only when the round-trip
  check passes.
- `getRecords(name)`: returns a typed `AgentNameRecords` bundle.

Write methods:

- `registerSubname(input, ctx)`: registers `<label>.<parent>`.
- `setPrimaryName(input, ctx)`: updates a Smart Agent's primary name.
- `setAgentRecords(input, ctx)`: writes typed resolver records.
- `setSubregistry(input, ctx)`: changes child-name issuance authority.

## Core Types

- `AgentKind`: `'person' | 'org' | 'service' | 'treasury'`.
- `AgentNameRecords`: typed resolver record bundle.
- `RegisterSubnameInput`: registration input for child names.
- `SetPrimaryNameInput`: reverse-record update input.
- `SetAgentRecordsInput`: typed resolver-record update input.
- `SetSubregistryInput`: subregistry update input.

## Errors

- `InvalidNameError`: thrown when normalization rejects a name.
- `NameNotFoundError`: reserved for callers that need a hard failure instead
  of `null` on missing names.
- `UnauthorizedNameOwnerError`: reserved for name-owner auth failures.

## Records Subpath

Import from `@agenticprimitives/agent-naming/records`.

- `PREDICATE_ID`: bytes32 ids for resolver predicates.
- `AGENT_KIND_ID`: bytes32 ids for `AgentKind` values.
- `CLASS_AGENT_NAME`: ShapeRegistry class id for an agent name.
- `AGENT_KIND_ENUM`: enum-set id for `agentKind`.
- `CAIP10_NAMESPACE_ALLOWLIST`: allowed namespaces for encode-side
  `nativeId` validation.
- `encodeRecords(records)`: converts an `AgentNameRecords` bundle to typed
  predicate writes.
- `decodeRecords(input)`: converts typed getter output into `AgentNameRecords`.
- `PredicateName`: union of known record names.
- `EncodedRecord`: typed encoded record shape.
- `DecodeInput`: grouped decode input shape.

## Call Builder Subpath

Import from `@agenticprimitives/agent-naming/custody`.

These helpers return `{ to, value, data }` and do not submit transactions.

- `buildRegisterSubnameCall`: encodes registry `register`.
- `buildRotateNameOwnerCall`: encodes registry `setOwner`.
- `buildRotateNameResolverCall`: encodes registry `setResolver`.
- `buildSetSubregistryCall`: encodes registry `setSubregistry`.
- `buildSetPrimaryNameCall`: encodes registry `setPrimaryName`.
- `buildSetStringAttributeCall`: encodes resolver `setStringAttribute`.
- `buildSetAddressAttributeCall`: encodes resolver `setAddressAttribute`.
- `buildSetBytes32AttributeCall`: encodes resolver `setBytes32Attribute`.
- `buildRecordCalls`: converts `AgentNameRecords` into resolver call array.
- `buildSubregistryRegisterCall`: encodes permissionless subregistry
  registration.
- `ContractCall`: standard encoded call shape.

## ABIs

- `agentNameRegistryAbi`
- `agentNameAttributeResolverAbi`
- `agentNameUniversalResolverAbi`
- `ontologyTermRegistryAbi`
- `shapeRegistryAbi`
- `permissionlessSubregistryAbi`

ABIs are exported for consumers that need direct viem reads or custom
transaction flows.

## Examples

- [`../examples/basic.ts`](../examples/basic.ts)
- [`../examples/records.ts`](../examples/records.ts)
- [`../examples/custody-rotation.ts`](../examples/custody-rotation.ts)
