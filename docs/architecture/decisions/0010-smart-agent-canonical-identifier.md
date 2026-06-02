# ADR-0010 — Canonical Smart Agent Identifier Rule

**Status:** Accepted (2026-05-24).
**Drivers:** identity coherence, multi-facet interop (naming / ERC-8004 / ANS /
HCS-10 / HCS-11 / HCS-14), authentication routing, recovery / rotation
semantics, audit forensics.
**Concrete process:** [`specs/220-agent-identity-bootstrap.md`](../../../specs/220-agent-identity-bootstrap.md).

---

## The rule

> **Canonical Smart Agent Identifier Rule:**
>
> Every Person, Organization, Service, Treasury, Role, or Team Agent MUST
> be anchored first by a canonical Smart Agent identifier. On EVM chains
> this identifier MUST be represented as a CAIP-10 account ID:
>
> ```
> eip155:<chainId>:<smartAgentAddress>
> ```
>
> Example: `eip155:84532:0x1234567890abcdef1234567890abcdef12345678`.
>
> All naming records, passkey associations, SIWE EOA associations,
> ERC-8004 entries, GoDaddy ANS records, Hashgraph Online records,
> HCS registry entries (HCS-10 / HCS-11 / HCS-14), metadata profiles,
> service endpoints, and other external registrations MUST reference
> this canonical Smart Agent identifier.
>
> Names and external registry IDs are facet identifiers. They MUST NOT
> be treated as canonical identity.

The canonical identifier is the **Smart Agent identity anchor**. It
is not the `.agent` name, not the EOA, not the passkey credential,
not an ERC-8004 record, not a GoDaddy ANS handle, not a Hashgraph /
HCS topic, and not an off-chain profile URL.

Identity starts with the agent. Not the user wallet, not the name,
not the registry.

## Context

We have multiple identity-adjacent layers shipping at the same time —
ERC-4337 Smart Agents, agent-naming (hierarchical `.agent` TLD),
agent-identity (typed AgentCard profiles), agent-relationships
(trust edges), passkey custody, SIWE EOA custody — plus a road to
ecosystem registries (ERC-8004 "Trustless Agents", GoDaddy ANS,
Hashgraph Online HCS-10 / 11 / 14 standards, DIDs, …).

Without a doctrine that picks ONE canonical identifier, every package
ends up speaking a slightly different identity vocabulary, every demo
has to translate between them, and security invariants drift. Prior
on-chain name networks lived with this exact problem (`alice.name` vs `0x…` vs
namehash vs reverse record) and the lesson is consistent: pick an
on-chain canonical identifier and treat everything else as a facet
pointing AT it.

This ADR locks that choice.

## Core principles

### 1. Smart Agent first

Every onboarding flow MUST start by creating or resolving the canonical
Smart Agent. This applies to:

```
Person Agent       → Alice, Bob, Sam
Organization Agent → Acme Construction
Service Agent      → Treasury Service, A2A Service, MCP Service
Role / Team Agent  → Information Architect, Ontologist, Security Reviewer
```

### 2. Names are facet registrations

A `.agent` name (or any other handle in any other registry) is a
**facet registration** — useful for human readability, discovery,
service routing, UX — but **not the canonical identifier**.

If the desired label is unavailable, the registration flow MUST
forced-unique it via a sequential-number suffix:

```
alice.agent    (taken)
alice2.agent   (taken)
alice3.agent   (available — claim this one)
```

The chosen name MUST point to the canonical Smart Agent. The canonical
identifier does NOT change when the name changes.

### 3. External registries reference the canonical Smart Agent

| Registry | Their identifier | MUST reference our canonical SA via |
| --- | --- | --- |
| ERC-8004 Trustless Agents | registry id | `agent_address` |
| GoDaddy ANS | handle | resolver `addr` record |
| Hashgraph Online / HCS-10 | topic id | `accountId` (CAIP-10) |
| HCS-11 profile | topic id | profile `accountId` (CAIP-10) |
| HCS-14 UAID | UAID string | derived from CAIP-10 locally (ADR-0008) |
| External name-registry metadata | namehash | `text` records pointing back |
| DID document | DID URI | `verificationMethod[].controller` |

A facet without a back-link is not a legitimate facet — it's a
parallel-authority risk.

### 4. Credentials attach to the canonical Smart Agent

Passkeys and SIWE EOAs are **authentication / control facets** bound
to the canonical SA via its custody set. The credential / EOA can
authenticate, sign, or prove association — but is NEVER the identity.

```ts
// Passkey facet
{
  canonicalAgentId: "eip155:84532:0xabc…",
  credentialType: "passkey",
  credentialIdDigest: "0x…",
  passkeyIdentityAddress: "0x…",
  status: "active",
}
// SIWE EOA facet
{
  canonicalAgentId: "eip155:84532:0xabc…",
  credentialType: "siwe-eoa",
  eoa: "0x…",
  status: "active",
}
```

### 5. Demos must create fresh canonical Smart Agents on reset

Reset MUST do more than clear local state — it MUST create new
canonical Smart Agents and register their facets:

```
1. Create Alice Smart Agent       → canonicalAgentId = eip155:84532:0x…
2. Register unique name           → alice.agent or alice2.agent
3. Write addr + nativeId records  → both point at canonicalAgentId
4. Enroll passkey + SIWE EOA      → both facets bound to canonicalAgentId
5. (optional) Publish profile     → anchored on the SA
6. (optional) Register facets     → ERC-8004 / ANS / HCS / DID — all
                                    pointing at canonicalAgentId
```

Repeat for Bob, Acme Construction (Org Smart Agent), Treasury Service
(Service Smart Agent). The demo UI MUST display BOTH:

```
Canonical Agent ID: eip155:84532:0x…
Name:               alice.agent
```

…and MUST be clear that the name is a facet registration, not the
root identity.

### 6. All packages preserve canonical-agent-first semantics

| Package | Implication |
| --- | --- |
| `agent-account` | **Owns the canonical identifier.** Exposes `toCaip10(chainId, smartAgentAddress)` as the standard form. CREATE2 salt MUST be derived from auth + scope, NEVER from a name. |
| `agent-naming` | `records.addr = smartAgentAddress`, `records.nativeId = canonicalAgentId`. The `.agent` name is a facet — forced-unique via number-suffix. |
| `agent-identity` | Profile subject = `canonicalAgentId`. Names / EOAs / passkeys / ERC-8004 / HCS records are linked identifiers, not identity. |
| `agent-relationships` | Edges are between **canonical SA addresses**, NOT between names. `aliceSA → memberOf → acmeSA`, not `alice.agent → memberOf → acme.agent`. |
| `identity-auth` | Authentication resolves credential → canonical SA. JWT primary subject = canonical SA; passkey / EOA appear as signer claims only. |
| `custody` | Custodians, trustees, passkeys, EOAs are authority facets OVER the canonical SA. |
| `delegation` | Delegations are agent → agent: `personSA → delegatesTo → serviceSA`, not `EOA → delegatesTo → wallet`. EOAs sign; agents delegate. |
| `mcp-runtime` | Tool grants identify the principal by canonical SA. Names / EOAs are display / auth surface only. |

## Standard data model

These shapes are the cross-package canonical types. The lightweight
TypeScript definitions belong in `@agenticprimitives/types` (so any
package can import them without taking a domain-package dependency).

```ts
// types/src/canonical-identity.ts
// Three kinds only (canonical `AgentType` in types/src/index.ts). treasury is a
// service subtype at the profile layer (ProfileType/serviceType; specs 217/225 §6),
// and 'role' is not a modeled agent kind — neither is an agentKind value.
export type AgentKind = 'person' | 'org' | 'service';

export interface CanonicalAgentIdentity {
  /** CAIP-10 account id, e.g. `eip155:84532:0x...`. The root identity. */
  canonicalAgentId: string;
  chainId: number;
  smartAgentAddress: `0x${string}`;
  agentKind: AgentKind;
  status: 'active' | 'recovered' | 'retired';
}

export type FacetType =
  | 'agent-name'
  | 'passkey'
  | 'siwe-eoa'
  | 'erc-8004'
  | 'godaddy-ans'
  | 'hashgraph-online'
  | 'hcs'
  | 'external-name-registry'
  | 'metadata-uri'
  | 'did';

export interface AgentIdentityFacet {
  canonicalAgentId: string;
  facetType: FacetType;
  /** Registry-specific id (handle, topic id, DID URI, etc.). */
  identifier: string;
  registry?: string;
  status: 'active' | 'pending' | 'revoked' | 'retired';
}

export interface AgentNameRegistration {
  canonicalAgentId: string;
  name: string;                   // e.g. 'alice.agent' or 'alice2.agent'
  nativeId: string;               // === canonicalAgentId
  smartAgentAddress: `0x${string}`;
  agentKind: AgentKind;
}
```

## Forced-unique name algorithm

```ts
async function claimUniqueAgentName(baseLabel: string): Promise<string> {
  const normalized = normalizeAgentName(baseLabel);
  if (await isAvailable(`${normalized}.agent`)) return `${normalized}.agent`;
  for (let i = 2; i <= 9999; i++) {
    const candidate = `${normalized}${i}.agent`;
    if (await isAvailable(candidate)) return candidate;
  }
  throw new Error('unable to allocate unique agent name');
}
```

The name MUST then be registered with:

```ts
{ addr: smartAgentAddress, nativeId: canonicalAgentId, agentKind, displayName }
```

## What this rules out

- ❌ Using a name as an identifier in any cross-package API. Names go
  on the wire only when being rendered to humans or resolved to/from
  an address.
- ❌ A facet registration that does NOT reference the canonical SA. A
  name without an `addr` record, a profile without an anchor, an HCS
  topic without a back-link — all forbidden.
- ❌ Authentication that authorizes "the holder of credential X"
  without resolving to a Smart Agent first.
- ❌ Cross-package code that has to disambiguate `alice` from `alice2`
  from `0xabc…` from `eip155:84532:0xabc…` at runtime. Always reduce
  to the canonical CAIP-10 as early as possible.
- ❌ Generating a UAID. Per ADR-0008, consumers derive UAIDs locally
  from the CAIP-10.

## Cross-references

- [ADR-0006](./0006-agent-naming-as-resolution-layer.md) — naming is a
  resolution layer, not authority.
- [ADR-0007](./0007-agent-identity-stack-three-packages.md) — identity
  stack decomposition.
- [ADR-0008](./0008-caip10-nativeid-record-predicate.md) — CAIP-10
  nativeId as record predicate (no UAID derivation).
- [ADR-0009](./0009-on-chain-ontology-shacl-naming.md) — on-chain
  ontology + SHACL shapes governing facet predicates.
- [`specs/220-agent-identity-bootstrap.md`](../../../specs/220-agent-identity-bootstrap.md)
  — the concrete process spec.
