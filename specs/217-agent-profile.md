# Spec 217 — Agent Profile (profile + verification + CAIP-10 alignment)

**Status:** v0 (architecture locked; Phase 1 implementation pending).
**Owner:** `@agenticprimitives/agent-profile` package (renamed from
`agent-profile`, 2026-05-25 — "profile facet", distinct from login which
lives in `connect-auth`).
**Architecture commitment:** [ADR-0006](../docs/architecture/decisions/0006-agent-naming-as-resolution-layer.md)
+ [ADR-0007](../docs/architecture/decisions/0007-agent-identity-stack-three-packages.md)
+ [ADR-0008](../docs/architecture/decisions/0008-caip10-nativeid-record-predicate.md).
**Adapted from:**
- [HCS-11](https://hol.org/docs/standards/hcs-11/) typed profile schema (Hashgraph Online).
- [HCS-14](https://hol.org/docs/standards/hcs-14/) CAIP-10 `nativeId` field.
- [ERC-8004](https://eips.ethereum.org/EIPS/eip-8004) Trustless Agents (EVM analog of HCS-14).
- smart-agent `packages/contracts/src/AgentAccountResolver.sol` (274 LOC) — profile resolver pattern.
- [GoDaddy ANS](https://github.com/godaddy/ans-registry) agent-card JSON pattern (good idea; we adopt the shape, not the trust root).

---

## 1. Purpose

Every Smart Agent advertises a **profile**: a typed off-chain JSON
blob (the "agent card") describing what kind of agent it is, what
capabilities it offers, where its services live, and how callers can
verify those services.

The agent-profile package owns:

1. **The typed profile schema** (HCS-11-aligned, EVM-native).
2. **The `metadata-uri` + `metadata-hash` record predicates** (the
   `agent-naming` pointer to the off-chain blob).
3. **CAIP-10 `nativeId` helpers** for cross-resolver interop with
   HCS-14 / ERC-8004 (ADR-0008).
4. **Verification methods** for the endpoints declared in the
   profile (DNS TXT challenge, signed-URL attestation, HTTP
   challenge endpoint, Verifiable Presentation acceptance).
5. **An optional on-chain `AgentProfileResolver` contract** that
   mirrors a small subset of profile fields on-chain for cheap
   discovery (`displayName`, `agentType`, `metadataUri`,
   `metadataHash`).

The profile is the bridge between **naming** (which name resolves
to which address?) and **trust fabric** (what is this agent claiming
to be? what can it do? how do I verify it?).

## 2. Vocabulary firewall

**Owns:**
- `AgentProfile` (the typed JSON schema).
- `ProfileType` (`'person' | 'org' | 'service' | 'treasury' |
  'mcpServer' | 'multisig'` — profile discriminator). NOTE: this is the
  PROFILE-layer type, NOT the agent kind. `treasury`/`mcpServer`/`multisig` are
  profile subtypes of a 3-value agent kind (`treasury`/`mcpServer` ⊂ `service`,
  `multisig` ⊂ `org`/`service`); the agent kind (`AgentType`, on-chain
  `agentKind`) is only `person | org | service` (spec 225 §6).
- Sub-objects: `AiAgentProfile`, `McpServerProfile`,
  `MultisigProfile`, `ServiceProfile`.
- `Caip10Address` (typed string with the CAIP-10 grammar).
- `VerificationMethod` (`'dns-txt' | 'signed-url' | 'http-challenge'
  | 'verifiable-presentation'`).
- `AgentIdentityClient` (read + write client for profile resolver
  contract + verification dispatcher).
- `AgentCard` (the canonical JSON shape served at `metadata-uri`).

**Disambiguation:**
- **"profile"** here = HCS-11-aligned agent profile (typed JSON +
  optional on-chain mirror). In `connect-auth` "profile" doesn't
  exist (auth deals with sessions, not agent identity).
- **"verification"** here = endpoint-control verification (does this
  MCP URL actually belong to this Smart Agent?). In `delegation`
  "verification" is delegation-token verification — different concept,
  same word.
- **"agent card"** = the off-chain JSON manifest. Inspired by
  GoDaddy ANS's `agent-card.json` pattern; we don't import any of
  GoDaddy's PKI infrastructure.

**Does not use:** `Delegation`, `Caveat`, `Custodian`, `Trustee`,
`RiskTier`, `KMS`, `JtiStore`, raw passkey material (only
`credentialIdDigest` — a hash). See `capability.manifest.json:forbiddenTerms`.

## 3. Package boundary

**Dependency direction:**

```
types ← connect-auth ← agent-account ← agent-profile
                                        agent-naming   ─ (no edge)
                                        agent-relationships ─ (no edge)
                                        delegation, mcp-runtime, tool-policy,
                                        key-custody, audit, custody ─ (no edge)
```

Per ADR-0007: agent-profile is a sibling to agent-naming +
agent-relationships, not a consumer of either. Demo apps compose:
they resolve a name → fetch the profile → query relationships, in
that order, in the demo layer.

**Allowed imports:**
- `@agenticprimitives/types`
- `@agenticprimitives/connect-auth` (`Signer` type only)
- `@agenticprimitives/agent-account` (`AgentAccountClient` for
  ERC-1271 verification of profile-write authorization)
- `viem`
- `@noble/hashes` (transitive via viem)

**Forbidden imports:** same set as agent-relationships (no
back-edges to `delegation`, `mcp-runtime`, `tool-policy`,
`key-custody`, `audit`, `custody`, `agent-naming`,
`agent-relationships`).

## 4. The profile schema

The on-chain footprint is small (resolver mirror); the rich profile
lives off-chain at `metadata-uri`.

### 4.1 On-chain record (mirror)

The `agent-naming` records schema (spec 215 § 5) already includes:

- `metadata-uri` (URL to off-chain JSON)
- `metadata-hash` (content hash of the JSON for integrity)
- `agent-kind` (one of: `person | org | service` — treasury is a service subtype
  carried by `ProfileType`/`serviceType`, NOT an agent kind; §2 + spec 225 §6)
- `display-name`

Spec 217 ADDS one predicate:

- `native-id` (CAIP-10 — per ADR-0008)

Spec 229 (P5) ADDS one optional string predicate, exported here as
`AUTH_ORIGIN = keccak256("authOrigin")`:

- `authOrigin` — where the agent's **central auth** lives (its own
  `<handle>.impact-agent.io` subdomain holding the ROOT passkey). Read by relying
  sites as `name → agent → getStringProperty(agent, AUTH_ORIGIN)`, a single
  resolution (ADR-0013). Unset → the relying site's platform default origin.

Plus an **optional** on-chain `AgentProfileResolver` contract that
mirrors a few additional fields for cheap discovery without a
metadata-uri fetch:

```solidity
struct ProfileMirror {
  string displayName;
  bytes32 profileTypeHash;   // keccak256 of one of: 'person', 'org', ...
  string metadataUri;
  bytes32 metadataHash;
  bytes32 caip10Hash;        // keccak256 of nativeId string
  uint64 updatedAt;
}
```

This mirror is purely a UX accelerator — the canonical profile is
the off-chain blob.

### 4.2 Off-chain profile shape (HCS-11-aligned, EVM-native)

```ts
export interface AgentCard {
  version: '1';
  type: ProfileType;
  agentName?: string;            // e.g., 'alice.agent'
  nativeId: string;              // CAIP-10
  displayName: string;
  bio?: string;
  socials?: Record<string, string>;
  metadataHash: string;          // self-referential — must match content hash
  metadataUri: string;           // self-referential
  schemaUri?: string;            // optional schema versioning
  capabilities?: string[];       // free-text labels (revocation via EAS in v2)
  // Type-discriminated sub-object (one of):
  aiAgent?: AiAgentProfile;
  mcpServer?: McpServerProfile;
  multisig?: MultisigProfile;
  service?: ServiceProfile;
}

export interface McpServerProfile {
  protocolVersion: string;        // e.g., '2025-03-26'
  endpoints: { mcp: string };     // {mcp: 'https://...'}
  tools?: { name: string; description: string }[];
  resources?: { uri: string; description: string }[];
  verification: VerificationMethod[];  // ['dns-txt', 'signed-url']
}

export interface AiAgentProfile {
  agentType: string;             // free-text label
  capabilities: string[];        // free-text labels
  model?: { provider: string; version: string };
  creator?: { name: string; url?: string };
}

export interface MultisigProfile {
  members: Caip10Address[];      // member Smart Agent addresses
  threshold: number;
  custodyPolicy: Caip10Address;
}

export interface ServiceProfile {
  endpoints: {
    a2a?: string;
    mcp?: string;
    [scheme: string]: string | undefined;
  };
  serviceType: string;           // 'treasury' | 'marketplace' | etc.
}
```

The `verification` array declares HOW callers can prove the endpoint
belongs to this Smart Agent. See § 5.

## 5. Verification methods

The biggest single value-add of HCS-11's `mcpServer.verification`
pattern: a way for callers to verify "this URL really is controlled
by this Smart Agent." We support four methods:

### 5.1 `dns-txt`

DNS TXT record at `_agent.<domain>` (where domain is derived from
the endpoint URL) contains `agent-address=<CAIP-10>`. Caller
fetches the TXT record + verifies it matches the agent's nativeId.

### 5.2 `signed-url`

The profile contains a signature by the agent's Smart Agent over
the endpoint URL. Caller recovers the signature via ERC-1271 on
the agent address.

### 5.3 `http-challenge`

The agent serves `/.well-known/agent-profile` returning
`{ agentAddress, timestamp, signature }`. Caller hits the URL,
verifies the signature (ERC-1271) is recent + matches the agent.

### 5.4 `verifiable-presentation`

The agent presents a W3C Verifiable Presentation issued by a trusted
issuer attesting to endpoint control. (Defers to a future
`@agenticprimitives/agent-credentials` package; Phase 1 just
defines the type, defers implementation.)

Phase 1 ships methods 5.1, 5.2, 5.3. Method 5.4 is a typed enum
value that throws `NotImplemented` if invoked, with a clear
migration path.

## 6. Phase plan

| Phase | Scope | Status |
| --- | --- | --- |
| **Architecture** | This spec + ADR-0007 + ADR-0008. | done 2026-05-23 |
| **Phase 1** | Package scaffold. Profile + AgentCard types + ProfileType discriminator. CAIP-10 encoder/decoder + grammar validation. AgentCard JSON serialization + content-hash helper. Unit tests for the pure helpers. | pending |
| **Phase 2** | `AgentIdentityClient.getProfile(name)` reads metadata-uri + verifies metadata-hash. `verifyEndpoint(profile, method)` dispatches to the chosen verification method. Tests against fixtures. | pending |
| **Phase 3** | Port `AgentAccountResolver.sol` (or equivalent simplified shape) to `apps/contracts/src/identity/AgentProfileResolver.sol`. Forge tests for mirror writes + ERC-1271 authorization. Deploy. | pending |
| **Phase 4** | Wire `AgentIdentityClient.setProfile(...)` + `verifyEndpoint` writes through the owner Smart Agent's ERC-1271. | pending |
| **Phase 5** | Demo integration: demo-web-pro shows agent cards instead of address strings; demo-mcp verifies its own MCP endpoint via `signed-url` and includes the verification in audit context. | pending |

## 7. Cross-package consumption pattern

Other packages don't import `agent-profile`. The demo layer composes:

```ts
// Demo worker, NOT inside any @agenticprimitives/* package:
import { AgentNamingClient } from '@agenticprimitives/agent-naming';
import { AgentIdentityClient } from '@agenticprimitives/agent-profile';
import { buildEvent } from '@agenticprimitives/audit';

const name = await naming.reverseResolve(actor);     // 'alice.agent'
const profile = await identity.getProfile(name);     // AgentCard
const verified = await identity.verifyEndpoint(profile, 'signed-url');

await audit.write(buildEvent({
  action: 'mcp.tool.call',
  actor: { type: 'user', id: actor, name, agentType: profile.type },
  context: { endpointVerified: verified },
}));
```

Per ADR-0006, the `audit`, `tool-policy`, `delegation`, `mcp-runtime`
packages already accept `NameContext` from `types` — extending them
to also accept `agentType` is the integration sweep planned in
NS Phase 2. No back-edges.

## 8. Audit events

Emitted via consumer-supplied `AuditSink`:

- `agent-profile.profile.fetch` — on metadata-uri fetch + hash verify.
- `agent-profile.profile.update` — on mirror update via ERC-1271.
- `agent-profile.endpoint.verify.{success,failure}` — per
  verification attempt with the method tag.
- `agent-profile.endpoint.verify.method-not-supported` — for
  `verifiable-presentation` until v2.

## 9. Security invariants

- **Profile JSON integrity**: `metadata-hash` MUST match
  `keccak256(profileJson)`. Client refuses profiles whose computed
  hash doesn't match the on-chain record (rejects mutation-without-
  update attacks).
- **Verification methods are explicit**, not implicit. A consumer
  who calls `verifyEndpoint` must pick a method; we don't pick one
  silently (avoids the "this verified successfully but I didn't
  check what 'successfully' means" antipattern).
- **CAIP-10 grammar enforced on encode**: unknown namespaces
  rejected (ADR-0008).
- **No raw passkey material in profiles**: only `credentialIdDigest`
  (matches agent-naming records invariant).
- **Profile writes require name-owner authorization**: Phase 4 wire
  goes through `AgentAccount.isValidSignature` → CustodyPolicy
  quorum for mode>0 accounts.

## 10. Refused / deferred

- **No UAID derivation** — see ADR-0008. CAIP-10 `nativeId` only.
- **No on-chain capability revocation** — `capabilities` array is
  free-text labels in Phase 1. EAS-style revocable attestations
  land with `@agenticprimitives/agent-credentials` v2 (deferred
  per ADR-0007).
- **No HCS-10 Inbox/Outbox/Connection topology** — single endpoint
  per service in Phase 1.
- **No GoDaddy-style X.509 + SCITT PKI** — refused in ADR-0007.
- **No DNS-domain-as-namespace** — refused in ADR-0007.

## 11. Acceptance criteria (per phase)

**Phase 1:**
- `pnpm --filter @agenticprimitives/agent-profile typecheck` passes.
- CAIP-10 grammar validation: encoder rejects malformed; decoder
  accepts any grammar-valid string. Round-trip golden vectors for
  `eip155`, `hedera`, `solana`.
- Agent-card JSON serialization deterministic.
- `metadata-hash` derivation matches the canonical
  `keccak256(canonicalJson(profile))` algorithm.
- All types exported; client skeleton throws `I Phase 2`.

**Phase 2:**
- `getProfile(name)` fetches metadata-uri + verifies hash + parses
  + types correctly.
- `verifyEndpoint` dispatches to the right method, returns
  `{ verified: boolean, evidence: string }`.

**Phase 5 (demo integration):**
- demo-web-pro shows "Alice (alice.agent · Person)" instead of
  `0x4b87…`.
- demo-mcp logs include `actor.agentName` + `actor.agentType` on
  every tool-call audit row.

## 12. Reference

- ADR-0006, ADR-0007, ADR-0008.
- Specs 215 (naming), 216 (relationships).
- HCS-11: https://hol.org/docs/standards/hcs-11/
- HCS-14: https://hol.org/docs/standards/hcs-14/
- ERC-8004: https://eips.ethereum.org/EIPS/eip-8004
- GoDaddy ANS registry: https://github.com/godaddy/ans-registry
  (architectural inspiration; we explicitly refuse the PKI stack)
- smart-agent: `packages/contracts/src/AgentAccountResolver.sol`
