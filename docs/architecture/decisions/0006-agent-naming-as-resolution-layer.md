# ADR-0006 — Agent naming is a resolution layer, not a foundational dependency

**Status:** accepted (2026-05-23)
**Supersedes:** the "names as foundational primitive that every package
imports" framing in the 2026-05-23 ANS proposal.
**Related:** [spec 215](../../../specs/215-agent-naming.md),
[spec 100](../../../specs/100-package-boundary-doctrine.md),
[ADR-0002](./0002-session-lifecycle-in-delegation.md) (same shape:
authority belongs where it's expressed, not where it's stored).

## Context

A late-2026-05 proposal recommended elevating the Agent Naming
Service (ANS) from a sidecar registry to a foundational primitive
that *every* `@agenticprimitives/*` package imports and depends on.
Specific recommendations included:

1. Make CREATE2 deterministic addresses derive from name + salt.
2. Add `delegateeName: AgentName` into the EIP-712 typed-data payload
   that delegations sign.
3. Auto-register a name as a side-effect of passkey enrolment in
   `identity-auth`.
4. Make `tool-policy`, `delegation`, `mcp-runtime`, `key-custody`,
   `custody`, and `audit` all import `@agenticprimitives/agent-naming`
   to consume names.
5. Use OpenZeppelin `AccessControl` + `TimelockController` on the
   `AgentNameRegistry` contract.

The proposal's underlying goal — "names permeate every layer so the
product reads as one cohesive identity stack" — is correct and
worth committing to. The *mechanics* recommended are wrong in ways
that would actively damage the system. This ADR documents the
architectural choices we make instead.

Competitive signals reviewed:

- **DNS / IP**: protocols sign packets to IPs; UIs render hostnames.
  Naming is the rendering layer; binding is the address layer.
- **ENS**: addresses don't depend on ENS names. ENS records point
  AT addresses. Name transfers don't break anything signed against
  the address.
- **Lit Protocol** + **Turnkey** + **Privy** (see ADR-0002): every
  one of these puts identity/naming as injection context, not as a
  hard import dependency of authority primitives.

## Decision

`@agenticprimitives/agent-naming` is a **downstream resolution layer**.
Other packages accept naming as **injected optional context**, never
as an import.

The cross-package primitive is `NameContext`, defined in
`@agenticprimitives/types`:

```ts
export type AgentType = 'person' | 'org' | 'service'; // treasury ⊂ service (profile subtype; specs 217/225 §6)

export interface NameContext {
  /** Resolved name of the subject (caller, delegator, actor, etc.). */
  agentName?: string;
  /** Discriminator the consumer can branch on. */
  agentType?: AgentType;
}
```

Each package's integration point:

| Package | Integration | Imports `agent-naming`? |
| --- | --- | --- |
| `types` | Defines `NameContext` + `AgentType`. | n/a |
| `audit` | `buildEvent` accepts `actor.name?: string`. Console + D1 sinks render it. | no |
| `tool-policy` | `evaluatePolicy(classification, { callerName?, callerAgentType? })`. New rules can branch on name/type but MUST be derivable from address alone — name is display + filter, not bypass. | no |
| `delegation` | Off-chain claims wrapper carries optional `context: { delegatorName?, delegateName? }`, signed alongside the delegation hash. **NOT in EIP-712 typed-data.** The delegation binds to addresses. | no |
| `mcp-runtime` | `withDelegation` opts gain `nameContext?: NameContext`, threaded into audit + tool-policy decision. | no |
| `identity-auth` | JWT claims gain optional `agentName: string`. identity-auth signs whatever the app supplies — does not resolve. | no |
| `agent-account` | **Unchanged.** CREATE2 stays address-deterministic from custodian + passkey + salt. Names are records pointing AT addresses. | no |
| `key-custody` | `canonicalContextBytes` already accepts arbitrary `aadContext: Record<string,string>`. Callers can include `agent-name` when they want name-binding in AAD. **No package change.** | no |
| `custody` | **Unchanged.** Recovery is trustee-governed. Demos label flows by name; contract path is identical. | no |
| `agent-naming` | The resolution layer. Apps call it to populate `NameContext` before invoking other packages. | n/a |

The contract surface:

- `AgentNameRegistry` ships in `apps/contracts/src/naming/`.
- Smart Agents own names. Authorization is via the agent's ERC-1271
  `isValidSignature`, which for mode>0 accounts routes through our
  existing CustodyPolicy quorum.
- **No OpenZeppelin `AccessControl` + `TimelockController`** on the
  registry — our CustodyPolicy IS the RBAC + timelock for the agent
  that owns a name. Recovery rotation of a name uses
  `CustodyPolicy.ApplySystemUpdate`-style quorum, encoded via
  `@agenticprimitives/agent-naming/custody` builders that don't
  import the custody package.

## Why each refused mechanism is harmful

### Refused: names in CREATE2 / deterministic address

If `AgentAccountClient.getAddressForAgentAccount` includes name in
the salt, then every name transfer or rotation changes the address.
Every existing delegation, balance, custody record, and audit row
keyed on that address becomes orphaned. The "name survives recovery"
property of ENS-style naming relies on **address stability**. Names
must point AT addresses, not the other way around.

This is not a marginal preference — it's load-bearing for the
recovery story already shipped in demo-web-recovery (Wave R3).

### Refused: names inside EIP-712 typed-data

Names are mutable. EIP-712 typed-data is the cryptographic primary
key of a delegation. If a delegation signs `delegateeName:
'alice.agent'`:

- **If we consider the delegation invalid after name transfer**, a
  delegate's authority disappears the moment Alice changes her name.
- **If we consider it still valid**, an attacker who squats a name
  inherits Alice's old delegations. Either reading is a footgun.

The clean shape: delegation binds to address (current behavior).
Off-chain claims wrapper carries `delegatorName` / `delegateName`
as signed context — useful for human review, replay-safe (signed
alongside the delegation hash), but never the cryptographic primary
key.

### Refused: name registration as passkey-enrolment side-effect

Sounds like "no extra steps" but it's worse UX:

- Passkey enrolment is a millisecond browser operation.
- Name registration is a multi-second on-chain transaction that
  can fail (RPC outage, paymaster deposit low, name collision).
- Coupling them means every passkey enrolment can fail for naming
  reasons.

Additionally, `identity-auth` would need to import `agent-naming` —
a back-edge into a layer that already has many consumers, breaking
the package-boundary doctrine.

The right shape: enrolment is single-purpose (auth). The app offers
name registration as a follow-up step with sensible defaults
(`alice-{shortHash}.agent` prefilled).

### Refused: every package imports `agent-naming`

The vocabulary firewall + acyclic dependency graph are load-bearing
for the per-package audit doctrine (spec 100 + spec 213). Hard
imports from `delegation`/`custody`/`mcp-runtime`/`tool-policy`/
`key-custody` into `agent-naming` would either:

- Force a new dependency-graph layer for everyone (slows builds,
  widens the boundary for every consumer), or
- Create back-edges (`agent-naming → delegation → agent-naming`)
  that break the workspace's structural invariants.

`NameContext` as an optional `types`-defined parameter gives 100%
of the value with 0% of the structural damage.

### Refused: OpenZeppelin `AccessControl` + `TimelockController` on the registry

We already shipped CustodyPolicy with T1-T6 timelock tiers + quorum
(spec 207 + spec 209). For an Org Smart Agent that owns `acme.agent`,
name rotation IS a CustodyPolicy.ApplySystemUpdate-style admin
action. Adding a parallel RBAC system on the registry contract
fragments the authority model — the agent's CustodyPolicy quorum
is the authority; adding a registry-level role on top would let a
registry admin override the agent's quorum.

The clean shape: registry calls `IERC1271.isValidSignature(node,
hash, sig)` on the owner Smart Agent. The agent's CustodyPolicy
routes the authorization through the right quorum. One authority
model, one place to govern.

## Consequences

**Positive:**

- The vocabulary firewall + dependency graph remain intact.
  `pnpm check:all` continues to enforce them.
- Names appear in audit rows, policy decisions, delegation context,
  MCP wrapper, JWT claims, and demo UIs — with no back-edges and
  no new mandatory dependency.
- Addresses stay stable across name transfers, preserving the
  recovery story.
- Delegations bind cryptographically to addresses (replay-safe);
  names render in UIs with signed mapping proof.
- Identity-auth stays narrow: passkey enrolment is millisecond-fast
  and can't fail for naming reasons.
- One authority model for name rotation: the owning Smart Agent's
  CustodyPolicy. No parallel RBAC.

**Negative:**

- Apps must explicitly resolve names and populate `NameContext`
  before calling downstream packages. We accept this — making it
  explicit is the point. A demo-side helper (`withResolvedName`)
  abstracts the boilerplate without re-creating the back-edge.
- `NameContext` is a `types` addition — every package recompiles
  on changes to that shape. Mitigated by keeping `NameContext`
  minimal + additive.

## Implementation

1. **types**: add `AgentType` + `NameContext` (this turn).
2. **audit**: add `name?: string` to `Actor` (next turn).
3. **tool-policy**: extend `evaluatePolicy` second-arg with
   `callerName? / callerAgentType?` (next turn).
4. **delegation**: extend off-chain claims envelope with `context?:
   { delegatorName?, delegateName? }` (next turn). NOT EIP-712.
5. **mcp-runtime**: thread `nameContext` through `withDelegation`
   (next turn).
6. **identity-auth**: JWT claims accept optional `agentName: string`
   (next turn). identity-auth signs; doesn't resolve.
7. **agent-naming**: stays the resolution layer (Phase 1 shipped;
   Phase 2-5 follows). Apps consume it to populate `NameContext`.

The 2026-05-23 proposal's spirit — names everywhere as the user-
facing identity layer — is fully realized. The architecture stays
clean.
