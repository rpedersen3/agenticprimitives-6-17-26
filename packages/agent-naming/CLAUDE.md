# @agenticprimitives/agent-naming — Claude guide

## Naming facet, not identity
Names are a **facet registration** pointing AT the canonical Smart Agent ([ADR-0010](../../docs/architecture/decisions/0010-smart-agent-canonical-identifier.md)). Forced-unique labels: [spec 220 § 5](../../specs/220-agent-identity-bootstrap.md). `addr` + `nativeId` MUST reference the same SA.

## What this package owns

- The `.agent` TLD constant (`AGENT_TLD`).
- Name normalization (`normalizeAgentName`) — NFC + lowercase + label
  validation. Rejects empty / hyphen-prefixed / non-ASCII labels in v0.
- `labelhash` + `namehash` — ENS-compatible keccak256 hashes for
  identifier nodes.
- Record schemas (`AgentNameRecords`) and predicate constants
  (subpath `/records`).
- `AgentNamingClient` — read API (resolve / reverse-resolve / get
  records) + write API skeleton (Phase 1 writes throw `NS Phase 2`).
- Pure encoded call builders for name-owner rotation that compose
  into custody-policy ceremonies (subpath `/custody`).

## What this package does NOT own

- Smart-account internals → [`agent-account`](../agent-account)
  (we consume `AgentAccountClient` for ERC-1271 verification +
  counterfactual address derivation).
- Custody policy, scheduling, quorum → [`custody`](../custody).
  We expose call builders only — never import.
- Delegation / caveat / mint → [`delegation`](../delegation).
- Passkey ceremonies → [`identity-auth`](../identity-auth).
- MCP / A2A transport → demo apps + future `a2a-runtime`.
- Contract source — that lives in `apps/contracts/src/naming/`
  (Phase 3+); this package ships ABIs + client only.

## Vocabulary

**Owns:** `AgentName`, `Label`, `Node` (namehash), `NameRecord`,
`AgentNamingClient`, `Subregistry`, `Resolver`, `PrimaryName`,
`AGENT_TLD`.
**Disambiguation:**

- **"resolver"** here = on-chain ENS-v2 resolver. Distinct from
  any other package.
- **"registry"** here = `AgentNameRegistry` contract. Distinct from
  the factory deploy-registry in `agent-account`.
- **"primary name"** = reverse-record on a Smart Agent address.
  Distinct from `identity-auth.sessionId` and `delegation.SessionRow`.
  **Does not use:** `Delegation`, `Caveat`, `Steward`, `Custodian`,
  `Trustee`, `KMS`, `RiskTier`, `JtiStore`, MCP / A2A transport.
  See `capability.manifest.json:forbiddenTerms`.

## Read these first (in order)

1. `capability.manifest.json` — boundary.
2. `src/index.ts` — public API.
3. `../../specs/215-agent-naming.md` — the spec.
4. `src/namehash.ts` + `src/normalize.ts` — the pure substrate.
5. `src/client.ts` — the client skeleton.

## Stable public exports

**Constants + helpers:** `AGENT_TLD`, `normalizeAgentName`,
`labelhash`, `namehash`.
**Types:** `AgentNameRecords`, `RegisterSubnameInput`,
`SetPrimaryNameInput`, `SetAgentRecordsInput`,
`SetSubregistryInput`.
**Client:** `AgentNamingClient`.
**Errors:** `InvalidNameError`, `NameNotFoundError`,
`UnauthorizedNameOwnerError`.
**Subpaths:**

- `/records` — predicate constants + encoders/decoders.
- `/custody` — pure encoded call builders for custody-gated name
  rotation (no `@agenticprimitives/custody` import).

## Allowed imports

`@agenticprimitives/types`, `@agenticprimitives/identity-auth`
(`Signer` type only), `@agenticprimitives/agent-account`
(`AgentAccountClient`), `viem`, `@noble/hashes` (transitive via viem).

## Forbidden imports

- `apps/*`
- `@agenticprimitives/delegation`, `mcp-runtime`, `tool-policy`,
  `key-custody`, `audit`, `custody`
- `@modelcontextprotocol/sdk`

## Drift triggers — STOP and route

- "Add `getLogs` / `queryFilter` / `watchContractEvent` for a product read" —
  **STOP.** [ADR-0012](../../docs/architecture/decisions/0012-no-eth-getlogs-in-product-read-paths.md):
  use `readContract`, on-chain stored fields, or an indexer. There is NO log
  walker left here — `reverseResolve` is a single `reverseResolveString` call.
- "Add a `try fast path / catch → slower different path` fallback" — **STOP.**
  [ADR-0013](../../docs/architecture/decisions/0013-no-silent-fallbacks.md): one
  mechanism per read. Empty/null is the answer; don't escalate to a log walk or
  second contract.
- "Add a delegation-token mint or verify path" — **STOP.** Belongs
  in [`delegation`](../delegation).
- "Add a CustodyAction to gate name rotation" — **STOP.** Belongs
  in [`custody`](../custody). Compose via `agent-naming/custody`
  call builders here without importing.
- "Add a passkey ceremony" — **STOP.** Belongs in [`identity-auth`](../identity-auth).
- "Reach for an MCP transport" — **STOP.** Out of scope.
- "Auto-resolve name via a system-wide hook in the worker" — **STOP.**
  Demo-app integration only; the package itself is transport-agnostic.

## Decision Tree

- Adding a new record field? Start in `src/types.ts` and
  `src/records.ts`; update tests and `docs/api.md`.
- Adding resolver reads? Start in `src/client.ts`.
- Adding name rotation calls? Start in `src/custody.ts`; do not import
  `@agenticprimitives/custody`.
- Adding passkey behavior? Stop. Route to `identity-auth`.
- Adding delegation or caveat behavior? Stop. Route to `delegation`.
- Adding MCP/A2A transport? Stop. Route to app/runtime packages.

## Before you write code

- [ ] Is the change in the resolver-records / namehash / normalize /
      client surface?
- [ ] Did I avoid importing from `delegation`, `custody`,
      `mcp-runtime`, `tool-policy`, `key-custody`, `audit`?
- [ ] Did I keep `normalize` deterministic (NFC + lowercase + label
      validation)?
- [ ] Did I write golden-vector tests for any namehash / labelhash
      change?
- [ ] Did I update `specs/215-agent-naming.md` if the public API or
      records schema changed?

## Security invariants (DO NOT BREAK)

- **Name normalization is deterministic.** Two strings that normalize
  identically MUST produce identical namehashes.
- **No raw passkey material in records.** Only `credentialIdDigest`
  (a hash) is ever stored in `passkey-credential-digest`.
- **Reverse resolution requires round-trip.** `reverseResolve(agent)`
  returns a name only when `resolveName(name) === agent`.
- **Fail-closed on unknown predicates.** Unknown record keys decode
  to `undefined`; encoders refuse unknown keys.
- **Write methods require the name owner.** Verified via the owner
  Smart Agent's ERC-1271 `isValidSignature` (Phase 2+).

## Validate the package

```bash
pnpm --filter @agenticprimitives/agent-naming typecheck
pnpm --filter @agenticprimitives/agent-naming test
pnpm check:forbidden-terms
```

## Common task routing

- New record predicate → `src/records.ts` (encoder/decoder + constant)
  - update `AgentNameRecords` type in `src/types.ts` + add a test.
- New client method → `src/client.ts` (Phase 1 stub with
  `throw new Error('NS Phase 2')`; wire in Phase 2).
- New custody-rotation call builder → `src/custody.ts` (subpath
  `/custody`; pure encoded call — no `@agenticprimitives/custody`
  import).

## Capabilities this package participates in

- **Agent identity + service discovery** — the naming graph IS the
  on-chain authority for "which Smart Agent answers to which
  human-readable name." Demos use it to resolve service endpoints
  (`a2a-endpoint`, `mcp-endpoint`) without hardcoded URLs.
- **Audit / forensics trail** — emits (via consumer-supplied
  `AuditSink`): `agent-naming.{resolve,register,records.update,
primary-name.update,subregistry.update}`.
- Index of cross-cutting capabilities:
  [`docs/architecture/cross-cutting-capabilities.md`](../../docs/architecture/cross-cutting-capabilities.md).

## Documentation map

[`README.md`](README.md) · [`docs/concepts.md`](docs/concepts.md) · [`docs/api.md`](docs/api.md) · [`docs/security.md`](docs/security.md) · [`docs/troubleshooting.md`](docs/troubleshooting.md) · [`docs/migration.md`](docs/migration.md)

## Generated files (ignore)

`dist/`, `node_modules/`, `coverage/`, `*.tsbuildinfo`.
