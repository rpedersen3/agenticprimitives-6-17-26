# Spec 215 — Agent Naming Service

**Status:** v0 (Phase 1 — pure SDK + spec + scaffold).
**Owner:** `@agenticprimitives/agent-naming` package.
**Architecture commitment:** [ADR-0006 — agent-naming is a resolution
layer](../docs/architecture/decisions/0006-agent-naming-as-resolution-layer.md)
documents the package-boundary + integration-pattern decisions
(refused: names in CREATE2, names in EIP-712 typed-data, identity-auth
auto-registration, every-package import, OpenZeppelin
AccessControl/TimelockController on the registry).
**Adapted from:** `smart-agent` branch `003-intent-marketplace-proposal`
(`packages/contracts/src/AgentName{Registry,AttributeResolver,UniversalResolver}.sol`
+ `packages/sdk/src/naming.ts`).
**Models:** ENS v2 principles (hierarchical registry, registry/resolver
separation, subregistry delegation, universal resolver) without
ENS-as-dependency.

## 0. The architectural shape (read first — ADR-0006 summary)

Naming permeates every layer of the platform — but via **injected
optional context** (the `NameContext` shape in `@agenticprimitives/
types`), not via import dependencies. Names appear in audit rows,
policy decisions, delegation off-chain claims, the MCP wrapper, JWT
claims, and demo UIs. The packages that consume names DO NOT import
`agent-naming`; they accept `nameContext?: NameContext` and downstream
their existing behavior.

The cryptographic primitives (CREATE2 addressing, EIP-712 typed-data,
recovery quorum) remain **address-bound**. Names point AT addresses;
addresses do not depend on names. This is the DNS pattern (UI
renders hostnames; protocols sign packets to IPs).

The contract authority model uses our existing CustodyPolicy. Smart
Agents own names; the Smart Agent's CustodyPolicy quorum governs
name rotation via the standard `ApplySystemUpdate`-style admin
ceremony. No parallel RBAC or TimelockController on the registry.

## Integration matrix (per ADR-0006)

| Package | Integration point | Imports `agent-naming`? | What ships in which phase |
| --- | --- | --- | --- |
| `types` | Defines `NameContext` + `AgentType`. | n/a | **shipped this turn** |
| `audit` | `buildEvent` accepts `actor.name?: string`. | no | NS Phase 2 |
| `tool-policy` | `evaluatePolicy(classification, { callerName?, callerAgentType? })`. | no | NS Phase 2 |
| `delegation` | Off-chain claims `context?: { delegatorName?, delegateName? }`. NOT in EIP-712. | no | NS Phase 2 |
| `mcp-runtime` | `withDelegation` opts `nameContext?: NameContext`. | no | NS Phase 2 |
| `identity-auth` | JWT claim `agentName?: string`. Signs whatever app supplies; does not resolve. | no | NS Phase 2 |
| `agent-account` | Unchanged. CREATE2 stays address-deterministic. | no | n/a |
| `key-custody` | `canonicalContextBytes` already accepts arbitrary AAD; callers can include `agent-name` when desired. | no | n/a |
| `custody` | Unchanged. Recovery is trustee-governed. | no | n/a |
| `agent-naming` | The resolution layer. Apps consume it. Contracts deploy in NS Phase 3. | n/a | per-phase |

---

## 1. Purpose

Give every Smart Agent a stable, human-readable name. Names route to
on-chain Smart Agent addresses (forward resolution), Smart Agents
route back to their primary name (reverse resolution), and per-name
records expose machine-readable endpoints (`a2a-endpoint`,
`mcp-endpoint`, `display-name`, `metadata-uri`, etc.) so service
discovery doesn't hardcode addresses.

The naming graph IS the on-chain authority. Names survive passkey
recovery (custody rotates; the name owner — a Smart Agent — is
unchanged). Names survive worker redeploys (Cloudflare URLs change;
the on-chain record doesn't). The naming graph is also the integration
point that other surfaces (relationships, audit context, MCP service
discovery) will compose against in future waves.

---

## 2. Vocabulary firewall

This package speaks **naming-domain vocabulary only**.

**Owns:**
- `AgentName`, `Label`, `Node` (the namehash), `NameRecord`,
  `AgentNamingClient`, `Subregistry`, `Resolver`, `PrimaryName`.
- The `AGENT_TLD = 'agent'` constant.

**Disambiguation (critical):**
- **"resolver"** here = the on-chain ENS-v2-style resolver that holds
  records for a name. In `delegation` "resolver" doesn't exist; in
  `mcp-runtime` "resolver" is unused. Naming-domain only.
- **"registry"** here = the hierarchical `AgentNameRegistry` contract.
  In `agent-account` "registry" is the factory's deploy registry (a
  different concept). Naming-domain only.
- **"primary name"** = the reverse-record on a Smart Agent address
  pointing back to its canonical name. Distinct from
  `identity-auth.sessionId`.

**Does not use:** `Delegation`, `Caveat`, `Enforcer`, `Steward`,
`Custodian`, `Trustee`, `KMS`, `RiskTier`, MCP / A2A transport,
passkey internals. See `capability.manifest.json:forbiddenTerms`.

---

## 3. Package boundary

**Dependency direction (definitive — overrides the diagram in the
original plan):**

```
types ← identity-auth ← agent-account ← agent-naming
                              custody  ─ (no edge; subpath helpers compose without import)
                              delegation, mcp-runtime, tool-policy, key-custody, audit ─ (no edge)
```

Rationale for ruling out `agent-naming → delegation`: delegations
don't need naming to function. A delegation references its delegator
and delegate by address; adding a naming dependency to delegation
would create churn for an unclear win. Demos can compose naming +
delegation directly when they need to display names alongside
delegation cards.

`agent-naming/custody` subpath ships **pure encoded call builders**
that produce custody-policy-compatible payloads for naming-related
actions (rotate name owner, update resolver). No `@agenticprimitives/account-custody`
import. This avoids the back-edge.

**Allowed imports:**
- `@agenticprimitives/types`
- `@agenticprimitives/connect-auth` (`Signer` type only — for client
  write methods)
- `@agenticprimitives/agent-account` (`AgentAccountClient` — for
  ERC-1271 verification of name-owner signatures and address
  derivation)
- `viem`
- `@noble/hashes` (transitively via viem in v0)

**Forbidden imports:**
- `apps/*`
- `@agenticprimitives/delegation`, `mcp-runtime`, `tool-policy`,
  `key-custody`, `audit`, `custody`

---

## 4. Names + namehash

### TLD

The single TLD is `agent`. Multi-root support exists in the contract
shape (per smart-agent's port) but Phase 1 of this package only
exposes `.agent` resolution.

### Normalization

`normalizeAgentName(name: string): string` applies:
1. NFC normalization (Unicode canonical form).
2. Lowercase (Turkish-locale-safe).
3. Trim whitespace.
4. Split on `.`; for each label:
   - Reject empty.
   - Reject leading/trailing hyphen.
   - Reject characters outside `a-z 0-9 -` (Phase 1; Phase 2 may
     expand to Punycode).
   - Length ≤ 63.
5. Return joined.

Throws `InvalidNameError` on any rejection.

### Namehash

Standard ENS namehash:
- `namehash('')` = `bytes32(0)`.
- `namehash('agent')` = `keccak256(namehash('') ++ labelhash('agent'))`.
- `namehash('alice.acme.agent')` = `keccak256(namehash('acme.agent') ++ labelhash('alice'))`.

`labelhash(label)` = `keccak256(utf8Bytes(label))`.

Both helpers are pure functions, work in browser + Worker + Node.

---

## 5. Record schema

Phase 1 record predicates:

| Predicate key | Type | Meaning |
| --- | --- | --- |
| `addr` | `Address` | Forward resolution target (the Smart Agent address this name points to). |
| `agent-kind` | `'person' \| 'org' \| 'service'` | Discriminator for UI + audit context. treasury is a service subtype (profile layer), not an agent kind — specs 217/225 §6. |
| `display-name` | `string` | Human-friendly label (may differ from the normalized name). |
| `a2a-endpoint` | `string` (URL) | A2A service endpoint for this agent. |
| `mcp-endpoint` | `string` (URL) | MCP service endpoint for this agent. |
| `metadata-uri` | `string` (URL) | Pointer to off-chain JSON manifest. |
| `passkey-credential-digest` | `Hex` (bytes32) | Public-safe identifier for the controlling passkey. Hash, not raw credentialId. |
| `custody-policy` | `Address` | The CustodyPolicy instance governing the owner Smart Agent (for UI hints). |

`agent-naming/records` subpath exports the predicate constants +
typed encoders/decoders for the values.

---

## 6. Public API (Phase 1)

```ts
// Pure helpers (no I/O)
export const AGENT_TLD: 'agent';
export function normalizeAgentName(name: string): string;
export function labelhash(label: string): Hex;
export function namehash(name: string): Hex;

// Types
export interface AgentNameRecords {
  addr?: Address;
  agentKind?: 'person' | 'org' | 'service'; // treasury ⊂ service (profile layer)
  displayName?: string;
  a2aEndpoint?: string;
  mcpEndpoint?: string;
  metadataUri?: string;
  passkeyCredentialDigest?: Hex;
  custodyPolicy?: Address;
}

export interface RegisterSubnameInput { /* ... */ }
export interface SetPrimaryNameInput  { /* ... */ }
export interface SetAgentRecordsInput { /* ... */ }
export interface SetSubregistryInput  { /* ... */ }

export class InvalidNameError extends Error {}
export class NameNotFoundError extends Error {}
export class UnauthorizedNameOwnerError extends Error {}

// Client (Phase 1 — reads stubbed with `throw new Error('NS Phase 2')`;
//        Phase 2 wires against deployed contracts)
export class AgentNamingClient {
  constructor(opts: { rpcUrl: string; chainId: number; registry: Address; universalResolver: Address });

  resolveName(name: string): Promise<Address | null>;
  reverseResolve(agent: Address): Promise<string | null>;
  getRecords(name: string): Promise<AgentNameRecords>;

  registerSubname(input: RegisterSubnameInput): Promise<Hex>;
  setPrimaryName(input: SetPrimaryNameInput): Promise<Hex>;
  setAgentRecords(input: SetAgentRecordsInput): Promise<Hex[]>;
  setSubregistry(input: SetSubregistryInput): Promise<Hex>;
}
```

Phase 1 ships the pure helpers + types + client SKELETON (methods
present, methods throw `Error('NS Phase 2 — wire to contract')`).
This locks the API shape so demos can be written against it before
contracts deploy.

Subpaths (Phase 1):
- `@agenticprimitives/agent-naming/records` — predicate constants
  + encoders/decoders. Pure.
- `@agenticprimitives/agent-naming/custody` — pure encoded call
  builders for name-owner rotation that compose into a custody
  schedule/apply ceremony. No `custody` package import.

Reserved for later:
- `@agenticprimitives/agent-naming/abis` — once ABIs stabilize +
  contracts ship as artifacts.

---

## 7. Phase plan

| Phase | Scope | Status |
| --- | --- | --- |
| **Phase 1** | Spec + scaffold + pure SDK (helpers, types, API skeleton, tests). Plus ADR-0006 architecture lock-in + `NameContext` / `AgentType` added to `@agenticprimitives/types`. | shipped 2026-05-23 |
| **Phase 2** | **Cross-package integration sweep.** Add (a) contract ABIs + wire `AgentNamingClient.resolveName / reverseResolve / getRecords` against a fixture deployment; (b) `audit.buildEvent` accepts `actor.name?`; (c) `tool-policy.evaluatePolicy` accepts `{ callerName?, callerAgentType? }`; (d) `delegation` claims envelope accepts `context?: { delegatorName?, delegateName? }` (off-chain, NOT EIP-712); (e) `mcp-runtime.withDelegation` accepts `nameContext?`; (f) `identity-auth` JWT accepts `agentName?` claim. Each integration is additive (optional fields) — no breakage. | next |
| **Phase 3** | Port `AgentNameRegistry`, `AgentNameAttributeResolver`, `AgentNameUniversalResolver` to `apps/contracts/src/naming/`, AND port the shared ontology stack (`OntologyTermRegistry`, `AttributeStorage`, `ShapeRegistry`) to `apps/contracts/src/ontology/` per [ADR-0009](../docs/architecture/decisions/0009-on-chain-ontology-shacl-naming.md). Resolver inherits `AttributeStorage`; predicates are governance-registered + active-checked at write. `AgentName` shape defined in `ShapeRegistry`. Simplifications kept: no `AgentRelationship` dependency (parent-pointer encoded directly in registry node), no OpenZeppelin `AccessControl` / `TimelockController` (the owner Smart Agent's CustodyPolicy IS the timelock + RBAC; msg.sender-based auth via the CustodyPolicy execute path). Forge tests. Deploy + persist addresses. | **shipped 2026-05-23 (pivot via ADR-0009)** |
| **Phase 4** | Wire write methods (`registerSubname`, `setPrimaryName`, `setAgentRecords`, `setSubregistry`). Each goes through the owner Smart Agent's `isValidSignature` (which routes through CustodyPolicy for mode>0 accounts). `agent-naming/custody` subpath ships the call builders. | after Phase 3 |
| **Phase 5** | Demo integration in this order: demo-web-pro → demo-web-recovery → demo-a2a → demo-mcp. Auditor packet refreshed. | after Phase 4 |

---

## 8. Smart Agent + passkey integration

A Smart Agent owns its name; passkeys don't. The chain of authority:

```
passkey credential
  ↓ controls (via WebAuthn + AgentAccount._verifyWebAuthn)
Person Smart Agent (PSA)
  ↓ owns
sam.agent
```

When Sam loses his passkey:
- Recovery rotates the PSA's custodian set (Wave R recovery demo).
- The PSA address stays stable.
- `sam.agent` continues to resolve to the same PSA.
- No name transfer needed.

When Sam REPLACES the PSA itself (e.g., migrating to a new account
implementation):
- `setAgentRecords({ addr: newPsa })` updates forward resolution.
- `setPrimaryName({ agent: newPsa, name: 'sam.agent' })` updates
  reverse resolution.
- Both operations require the name owner's signature (the PSA's
  ERC-1271 isValidSignature, which routes through whatever custodian
  authority controls it).
- Audit row emitted (`agent-naming.records.update`).

Organization names work the same shape with subname delegation:
- Acme deploys an Org Smart Agent.
- `acme.agent` is registered with the Org Smart Agent as owner.
- The Org sets a subregistry contract (or self-as-subregistry) so it
  can issue `treasury.acme.agent`, `alice.acme.agent`, etc.
- Subname registration is gated by the Org's CustodyPolicy quorum
  (using the `agent-naming/custody` call builders).

---

## 9. Audit events

This package emits (via the `@agenticprimitives/audit` package consumed
by callers; the package itself accepts an optional `auditSink` in
client construction):

- `agent-naming.resolve.{accept,reject}` — for read operations that
  matter (typically the demo-mcp side when name appears in audit
  context).
- `agent-naming.register` — on subname registration.
- `agent-naming.records.update` — on resolver-record writes.
- `agent-naming.primary-name.update` — on reverse-record writes.
- `agent-naming.subregistry.update` — on subregistry-delegation
  changes.

These align with the audit-package event shape (`buildEvent` /
`AuditSink`).

---

## 10. Security invariants (Phase 1)

These are enforced by the spec + the client + (Phase 3) the contracts:

- **Name normalization is deterministic.** Two strings that normalize
  to the same name MUST produce identical namehashes. Tested against
  golden vectors.
- **Reverse resolution requires round-trip.** `reverseResolve(agent)`
  returns `name` ONLY when `resolveName(name) === agent`. Otherwise
  returns `null`. Prevents primary-name squatting (claiming a primary
  name without the forward record agreeing).
- **No raw passkey material in records.** Only `credentialIdDigest`
  (a hash) ever lands in `passkey-credential-digest`.
- **Write methods require the name owner.** Either via direct PSA
  signature (passkey-controlled) or via the Org Smart Agent's
  CustodyPolicy quorum.
- **Fail-closed on unknown predicates.** Records with unknown keys
  decode to `undefined`; encoders refuse unknown keys.

---

## 11. Out of scope (Phase 1)

- Renewal / expiry (will land in Phase 3 with contracts).
- Name transfer as ERC-1155 / tradable asset.
- ENS public-namespace bridging (`.eth` interop).
- Punycode / international label support (US-ASCII only in Phase 1).
- Reverse-record contracts (Phase 3).
- Multi-root TLD support beyond `.agent` (the contract supports it;
  the package surface restricts to `.agent` in Phase 1).

---

## 12. Read-path discipline — no `eth_getLogs` in product reads

Binding: [ADR-0012](../docs/architecture/decisions/0012-no-eth-getlogs-in-product-read-paths.md).

| Operation | Allowed mechanism |
| --- | --- |
| `resolveName` | `readContract` via universal resolver |
| `getRecords` | `readContract` (resolver + batch reads) |
| `reverseResolve` — round-trip / squat check | `readContract` (`primaryName` → node; forward `addr` check on chain) |
| `reverseResolve` — dotted string | **Must not** rely on `eth_getLogs` long term |

**Current debt:** Phase 2 client `_reconstructName` walks `NameRegistered` /
`RootInitialized` logs (chunked) because `NameRecord` stores `labelhash` only,
not plaintext `label`. This is a **transitional violation** — do not add second
log walkers; do not copy the pattern to other packages.

**Exit (pick one):**

1. **Contract:** persist `string label` (or `reverseName(address)`) in
   `AgentNameRegistry` so reverse string reconstruction is `readContract`-only.
2. **Indexer:** naming indexer ingests registration events; SDK or app queries
   indexer (or injects `NameContext` after local write).

Until exit, demos may also cache `address → name` after `setPrimaryName`.

---

## 13. Acceptance criteria

For Phase 1 to be considered complete:
- [ ] `pnpm --filter @agenticprimitives/agent-naming typecheck` passes.
- [ ] `pnpm --filter @agenticprimitives/agent-naming test` passes
      with vitest covering: normalize golden vectors, namehash/labelhash
      golden vectors (matching smart-agent's reference implementation),
      record-schema encoding round-trips, InvalidNameError cases.
- [ ] `pnpm check:all` passes (doctrine + boundaries + forbidden
      terms).
- [ ] No back-edges from `@agenticprimitives/agent-naming` to
      delegation / custody / mcp-runtime / tool-policy / key-custody.
- [ ] The package is consumable by demo apps without dragging in
      the rest of the workspace.

For Phase 5 (full demo integration):
- [ ] `alice.agent`, `acme.agent`, `treasury.acme.agent` resolve to
      the right Smart Agent addresses on Base Sepolia.
- [ ] Reverse resolution returns the primary name only when round-trip
      verification passes.
- [ ] Passkey recovery in demo-web-recovery does not break
      `sam.agent`'s forward record.
- [ ] demo-a2a resolves its target service endpoint from
      `treasury.acme.agent`'s `a2a-endpoint` record (not from
      `VITE_DEMO_A2A_URL`).
- [ ] demo-mcp audit rows include the primary name of the principal
      where one exists.

---

## 13. Reference

- Adapted from: `smart-agent` branch `003-intent-marketplace-proposal`.
- Related specs:
  - `specs/100-package-boundary-doctrine.md`
  - `specs/101-v0-package-proposal.md` (deferred naming → promoted here)
  - `specs/201-agent-account.md` (Smart Agent ownership of names)
  - `specs/207-smart-account-threshold-policy.md` (custody-gated name
    rotation in Org Smart Agents)
  - `specs/212-agent-centric-delegation.md` (vocabulary firewall the
    naming domain joins)
  - `specs/213-custody-layer-carve-out.md` (the firewall pattern this
    package follows for delegation)
  - `specs/214-production-audit-dossier.md` (audit coverage will
    extend to the agent-naming package)
- External reference: ENS v2 design notes.
