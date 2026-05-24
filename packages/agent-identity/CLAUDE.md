# @agenticprimitives/agent-identity — Claude guide

## Profile facet, not identity
Profiles are a **facet registration** anchored at the canonical Smart Agent address ([ADR-0010](../../docs/architecture/decisions/0010-smart-agent-canonical-identifier.md)). Cross-package APIs key off the SA address — names are decorative. External registry facets MUST back-link to the canonical SA ([spec 220 § 4](../../specs/220-agent-identity-bootstrap.md)).

## What this package owns
- `AgentCard` — the HCS-11-aligned typed off-chain profile schema,
  discriminated on `type: 'person' | 'org' | 'service' | 'treasury' |
  'mcpServer' | 'multisig'`.
- Type-specific sub-objects: `AiAgentProfile`, `McpServerProfile`,
  `MultisigProfile`, `ServiceProfile`.
- `Caip10Address` branded type + `buildCaip10Address` / `parseCaip10`
  pure helpers (HCS-14 / ERC-8004 alignment per ADR-0008).
- Canonical-JSON serialization + `profileContentHash` helper
  (matches the on-chain `metadata-hash` predicate in agent-naming).
- `VerificationMethod` enum (`'dns-txt' | 'signed-url' |
  'http-challenge' | 'verifiable-presentation'`).
- `AgentIdentityClient` skeleton (reads throw `I Phase 2`; writes
  throw `I Phase 4`).

## What this package does NOT own
- Naming (`.agent` TLD, namehash, registry) → [`agent-naming`](../agent-naming).
- Relationships (trust-fabric edges, roles) → [`agent-relationships`](../agent-relationships).
- Smart-account internals → [`agent-account`](../agent-account).
- Custody / quorum / recovery → [`custody`](../custody) + spec 207.
- Delegations → [`delegation`](../delegation).
- MCP / A2A transport → demo apps + future `a2a-runtime`.
- UAID generation (refused per ADR-0008 — consumers derive locally
  if needed).

## Vocabulary
**Owns:** `AgentCard`, `ProfileType`, `AiAgentProfile`,
`McpServerProfile`, `MultisigProfile`, `ServiceProfile`,
`VerificationMethod`, `Caip10Address`, `AgentIdentityClient`.
**Disambiguation:**
- **"profile"** here = HCS-11-aligned agent profile (typed JSON +
  optional on-chain mirror). In `identity-auth` "profile" is the
  user JWT-session profile — different concept, different layer.
- **"verification"** here = endpoint-control verification (does
  this MCP URL really belong to this Smart Agent?). In `delegation`
  "verification" = delegation-token verification. Disambiguate.
- **"agent card"** = the off-chain JSON manifest. Inspired by
  GoDaddy ANS's `agent-card.json` pattern; we don't import any of
  GoDaddy's PKI infrastructure (per ADR-0007).
**Does not use:** `Delegation`, `Caveat`, `Custodian`, `Trustee`,
`RiskTier`, `KMS`, `JtiStore`, `namehash` (naming-domain),
`Edge` (relationships-domain), raw passkey material.

## Read these first (in order)
1. `capability.manifest.json` — boundary.
2. `src/index.ts` — public API.
3. `../../specs/217-agent-identity.md` — the spec.
4. `../../docs/architecture/decisions/0007-agent-identity-stack-three-packages.md`
5. `../../docs/architecture/decisions/0008-caip10-nativeid-record-predicate.md`
6. `src/caip10.ts` + `src/profile.ts` — the pure substrate.

## Stable public exports
**Types:** `AgentCard`, `ProfileType`, `AiAgentProfile`,
`McpServerProfile`, `MultisigProfile`, `ServiceProfile`,
`VerificationMethod`, `Caip10Address`, `AgentIdentityClientOpts`.
**Helpers (pure):** `buildCaip10Address`, `parseCaip10`,
`isValidCaip10`, `canonicalProfileJson`, `profileContentHash`,
`CAIP10_NAMESPACE_ALLOWLIST`.
**Client:** `AgentIdentityClient`.
**Errors:** `InvalidProfileError`, `ProfileHashMismatchError`,
`EndpointVerificationError`, `InvalidCaip10Error`.
**Subpaths:**
- `/caip10` — CAIP-10 helpers only (no client baggage).
- `/profile` — canonical JSON + content-hash helper.

## Allowed imports
`@agenticprimitives/types`, `@agenticprimitives/identity-auth`
(`Signer` type only), `@agenticprimitives/agent-account`
(`AgentAccountClient`), `viem`, `@noble/hashes`.

## Forbidden imports
- `apps/*`
- `@agenticprimitives/delegation`, `mcp-runtime`, `tool-policy`,
  `key-custody`, `audit`, `custody`, `agent-naming`,
  `agent-relationships`
- `@modelcontextprotocol/sdk`

## Drift triggers — STOP and route
- "Generate a UAID string" — **STOP.** ADR-0008 refused. Expose
  `nativeId` only; consumers derive UAIDs locally.
- "Add a name registry" — **STOP.** Belongs in [`agent-naming`](../agent-naming).
- "Add an edge between two agents" — **STOP.** Belongs in
  [`agent-relationships`](../agent-relationships).
- "Add a credential issuance method" — **STOP.** Deferred to v2
  `@agenticprimitives/agent-credentials` per ADR-0007.
- "Add a skill registry" — **STOP.** Deferred to v2.
- "Bring in OpenZeppelin AccessControl or TimelockController for
  the profile resolver contract" — **STOP.** Use the owner Smart
  Agent's CustodyPolicy quorum via ERC-1271. Refused in ADR-0007.

## Before you write code
- [ ] Is the change in the profile / CAIP-10 / verification surface?
- [ ] Did I avoid importing from `agent-naming`, `agent-relationships`,
      `delegation`, `custody`, `mcp-runtime`, `tool-policy`,
      `key-custody`, `audit`?
- [ ] If I'm adding a CAIP-10 namespace, did I expand the
      `CAIP10_NAMESPACE_ALLOWLIST` AND add a golden vector test?
- [ ] If I'm adding a profile field, did I update the canonical-JSON
      serialization AND the content-hash invariant tests?
- [ ] Did I update `specs/217-agent-identity.md` if the public API
      or AgentCard schema changed?

## Security invariants (DO NOT BREAK)
- **Profile JSON content-hash is deterministic.** Canonical-JSON
  serialization MUST sort keys + use a fixed numeric format. Two
  semantically-equal profiles MUST produce identical hashes.
- **`metadata-hash` MUST match `profileContentHash(profile)`.**
  Client refuses profiles whose computed hash disagrees with the
  on-chain record (rejects mutation-without-update attacks). Phase 2.
- **Verification methods are explicit, not implicit.** Callers
  declare which method they're invoking. We don't silently pick
  one (avoids the "this verified successfully but I didn't check
  what 'successfully' means" antipattern).
- **CAIP-10 encode-side is strict, decode-side is permissive.**
  Encoder rejects unknown namespaces (Phase 1: eip155, hedera,
  solana). Decoder accepts any grammar-valid CAIP-10 string
  (forward-compat).
- **No raw passkey material in profiles.** Only `credentialIdDigest`
  (a hash) ever appears (matches agent-naming invariant).
- **No UAID generation.** Per ADR-0008.

## Validate the package
```bash
pnpm --filter @agenticprimitives/agent-identity typecheck
pnpm --filter @agenticprimitives/agent-identity test
pnpm check:forbidden-terms
```

## Common task routing
- New profile sub-type → `src/types.ts` (`ProfileType` union +
  new sub-interface) + `src/profile.ts` (canonical JSON path) +
  test for content-hash invariance.
- New CAIP-10 namespace → `src/caip10.ts`
  (`CAIP10_NAMESPACE_ALLOWLIST` + namespace-specific normalization
  if needed) + golden vector test.
- New `VerificationMethod` → `src/types.ts` (union) + Phase 2
  implementation in `src/client.ts` (or Phase 1 stub that throws
  `I Phase 2`).

## Capabilities this package participates in
- **Agent identity + service discovery** — pairs with
  `agent-naming` (which resolves name → address) to provide name
  → address → profile → endpoints. Demos compose these at the app
  layer.
- **Audit / forensics trail** — Phase 2+ emits (via consumer
  `AuditSink`): `agent-identity.profile.fetch`,
  `agent-identity.profile.update`, `agent-identity.endpoint.verify.{success,failure}`.
- Index: [`docs/architecture/cross-cutting-capabilities.md`](../../docs/architecture/cross-cutting-capabilities.md).

## Documentation map
[`README.md`](README.md) · [`docs/concepts.md`](docs/concepts.md) · [`docs/api.md`](docs/api.md) · [`docs/security.md`](docs/security.md) · [`docs/troubleshooting.md`](docs/troubleshooting.md) · [`docs/migration.md`](docs/migration.md)

## Generated files (ignore)
`dist/`, `node_modules/`, `coverage/`, `*.tsbuildinfo`.
