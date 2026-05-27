# Agentic Primitives Differentiators

Related brand docs:

- [Agentic Connect Brand Positioning](./agentic-connect-positioning.md) — passkey
  SSO, OIDC for "who is this," and delegation for "what may this app do."

## The Fundamental Move

Most web3 products still speak in the language of:

- users,
- wallets,
- EOAs,
- accounts,
- signers,
- transactions.

Agentic Primitives moves the center of gravity to a different vocabulary:

- `prov:Person`,
- `prov:Organization`,
- `ap:ServiceAgent`,
- Person Agent,
- Organization Agent,
- Service Agent.

This is not a naming exercise. It is a different model of authority.

The old model asks:

> Which wallet signed this transaction?

The Agentic Primitives model asks:

> Which Agent acted, on behalf of whom, under what authority, with what limits, and with what provenance?

That is the paradigm shift.

## From Wallet-Centric to Agent-Centric

In a wallet-centric system, authority usually starts from a key:

```text
User -> Wallet / EOA -> Account -> Transaction
```

In Agentic Primitives, authority starts from an Agent:

```text
Person Smart Agent -> Organization Agent -> Service Agent -> Activity
```

The human still matters, but the human is not the authority-bearing object in the system. The human controls a Person Smart Agent, typically through a passkey. From there, authority flows through delegations between Agents.

This creates a system where actions are attributable to durable agents, not temporary browser sessions or raw wallet addresses.

## PROV-O As Product Language

Agentic Primitives borrows from W3C PROV-O because PROV-O already has the right conceptual foundation:

```text
prov:Agent
├── prov:Person
├── prov:Organization
└── prov:SoftwareAgent
```

Agentic Primitives extends this into an operational smart-agent vocabulary:

```text
prov:Person
  -> Person Smart Agent
  -> Person Agent

prov:Organization
  -> Organization Smart Agent
  -> Organization Agent

prov:SoftwareAgent
  -> Service Agent
  -> Treasury, Trading Agent, Research Agent, Compliance Agent
```

The important part is that these are not just labels. They are authority-bearing actors.

A Person Agent can act.

An Organization Agent can act.

A Treasury Service Agent can act.

And each action can be tied to a provenance chain.

## The Digital Twin Interpretation

The Agentic Primitives model maps naturally to digital twin language:

| Real-world entity | Agentic counterpart | Role |
| --- | --- | --- |
| A human person | Person Smart Agent / Person Agent | Represents the person in agentic systems |
| A company, DAO, team, or fund | Organization Agent | Represents collective authority |
| A business function | Service Agent | Performs a scoped job for an organization |
| A treasury department | Treasury Service Agent | Holds, proposes, approves, and disburses value |
| A compliance function | Compliance Service Agent | Reviews activity against policy |
| A research function | Research Service Agent | Produces analysis under delegated authority |

This lets us model software agents as first-class operational counterparts to real-world actors and functions.

## Why "Treasury" Is Not Just an Account

In a wallet-centric product, a treasury is often described as:

> a multisig wallet that holds funds.

In Agentic Primitives, a Treasury is:

> a Service Agent that acts on behalf of an Organization, embodied by an on-chain AgentAccount, governed by an account safety policy, and constrained by explicit authority grants.

The on-chain account is the embodiment, not the identity.

The identity is the Treasury Service Agent.

That distinction matters because a Treasury can:

- hold assets,
- propose payments,
- receive authority from an Organization,
- delegate limited authority to Person Agents,
- enforce spending limits,
- participate in audit trails,
- act on behalf of an Organization.

Those are agency properties, not just account properties.

## Delegation Between Agents

The conventional framing is:

```text
Wallet A delegates to Wallet B
EOA signs a delegation
Account grants a session key
```

Agentic Primitives reframes this as:

```text
Person Agent delegates to Organization Agent
Organization Agent delegates to Treasury Service Agent
Treasury Service Agent delegates limited authority to Person Agents
Service Agent acts on behalf of Organization Agent
```

Delegation is no longer a workaround for wallet UX.

Delegation becomes the core language of agentic authority.

Each delegation answers:

- who is granting authority,
- who receives authority,
- what activity is permitted,
- what limits apply,
- when authority expires,
- how it can be revoked,
- which Agent is accountable.

## Admin Authority vs Stewardship

Agentic Primitives separates two concepts that wallet-centric systems often blur.

### Admin Authority

Admin authority is control over an Agent itself:

- add or remove controllers,
- change approvals required,
- update recovery,
- rotate policy,
- upgrade implementation,
- issue or revoke standing authority grants.

This is high-friction and audit-heavy. It belongs behind approvals, safety delays, and recovery rules.

User-facing language:

- scheduled admin change,
- account safety policy,
- approvals required,
- safety delay.

### Stewardship

Stewardship is delegated operational authority:

- draft a payment,
- read treasury balances,
- propose a budget use,
- run a recurring service,
- act within a spending limit,
- perform an MCP tool call within granted scope.

This is lower-friction, bounded, and composable. It is how agents operate day to day.

User-facing language:

- permission,
- authority grant,
- treasury permission card,
- service-agent authority.

The flow is:

```text
Admin authority creates stewardship.
Stewardship is used for routine work.
```

## Why This Is Different From Multi-Sig

Multi-sig asks:

> How many signatures are needed to move funds?

Agentic Primitives asks:

> Which Agents are authorized to perform which Activities on behalf of which other Agents?

Multi-sig is still useful. It becomes one enforcement mechanism inside a broader agentic authority model.

For example:

```text
Alice Person Smart Agent + Bob Person Smart Agent
  jointly administer
Treasury Service Agent
  which acts on behalf of
Acme Organization Agent
  and grants bounded treasury permissions to
Alice Person Agent and Bob Person Agent
```

That is richer than "2-of-2 wallet."

It captures:

- identity,
- agency,
- provenance,
- stewardship,
- service boundaries,
- organizational context,
- auditability.

## Vocabulary Shift

| Old language | Agentic Primitives language | Why it matters |
| --- | --- | --- |
| User | Person | A person is a provenance actor, not just an app session |
| Wallet | Person Smart Agent | Authority lives in a durable smart agent |
| EOA | Passkey-controlled Person Smart Agent | Human control does not require raw EOA authority |
| Account | AgentAccount embodiment | The contract is infrastructure, not the identity |
| Multisig wallet | Organization Agent or Service Agent with account safety policy | Multi-party control is a policy, not the whole product |
| Session key | Limited agent permission | The key is implementation; the permission is the product concept |
| Delegation to wallet | Delegation between Agents | Authority moves through provenance-aware actors |
| Treasury wallet | Treasury Service Agent | Treasury has a job, policy, agency, and audit trail |
| Transaction history | Provenance trail | The question is not just what happened, but who acted on behalf of whom |

## What We Should Avoid Saying

Avoid leading with:

- "connect wallet",
- "wallet-to-wallet delegation",
- "EOA owner",
- "session key management",
- "multisig account",
- "validator module",
- "proposal quorum".

These terms are still valid in implementation docs, but they are not the brand story.

Prefer:

- "control your Person Smart Agent with a passkey",
- "grant authority to another Agent",
- "create a Treasury Service Agent",
- "schedule an admin change",
- "approve a service-agent authority grant",
- "trace who acted on behalf of whom".

## Product Differentiators

### 1. Agent-first identity

Agentic Primitives treats Person, Organization, and Service as first-class actors. Wallets and accounts are embodiments of those actors, not the actors themselves.

### 2. Delegation as the core primitive

Delegation is not only for session keys. It is the mechanism for agent-to-agent authority: Person to Organization, Organization to Service, Service to Person Agent, Service to Service.

### 3. Provenance-native audit trails

Every important action can be expressed as:

```text
Agent performed Activity on behalf of Agent under Delegation with Limits.
```

That is more useful than a transaction hash alone.

### 4. Service Agents with true agency

A Treasury is not a passive wallet. It is a Service Agent that can hold assets, enforce policy, receive authority, grant bounded permissions, and act on behalf of an Organization.

### 5. Human-friendly control through passkeys

Humans control their Person Smart Agents through passkeys. The architecture avoids making EOAs the center of user authority.

### 6. Composable authority

New business functions become new Service Agents:

- Treasury,
- Trading,
- Research,
- Compliance,
- Procurement,
- Delivery.

Each can receive scoped authority and produce provenance-aware activity.

## One-Line Positioning

Agentic Primitives turns wallets and accounts into provenance-aware agents: Persons, Organizations, and Services that can delegate authority, act within limits, and leave an accountable trail.

## Short Positioning Variants

For developers:

> Build applications where authority flows between Smart Agents, not raw wallets.

For product teams:

> Model people, organizations, and business services as agents with real authority and auditability.

For security reviewers:

> Every action answers who acted, on behalf of whom, under what grant, with which limits.

For enterprise buyers:

> Move from shared wallets to accountable service agents for treasury, compliance, research, and operations.

## Canonical Example

Acme Construction has:

- Alice's Person Smart Agent,
- Bob's Person Smart Agent,
- Acme Organization Agent,
- Acme Treasury Service Agent.

Alice and Bob control their own Person Smart Agents with passkeys.

The Acme Organization Agent authorizes the Treasury Service Agent to act on behalf of the organization.

The Treasury Service Agent grants bounded treasury permissions to Alice and Bob's Person Agents.

When a payment is drafted, approved, and executed, the audit trail can say:

```text
Alice Person Agent drafted a payment
acting under authority from Acme Treasury Service Agent
which acted on behalf of Acme Organization Agent
with final admin authority controlled by Alice and Bob's Person Smart Agents.
```

That is the differentiator.

