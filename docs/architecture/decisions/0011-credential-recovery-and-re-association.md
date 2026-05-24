# ADR-0011 — Credential Recovery and Re-Association Rule

**Status:** Accepted (2026-05-24).
**Drivers:** credential loss / rotation / compromise handling, custody-policy
authority, audit forensics, separation between credential set changes and
delegation.
**Companion doctrine:** [ADR-0010](./0010-smart-agent-canonical-identifier.md)
(canonical Smart Agent identifier).
**Concrete process:** [`specs/221-credential-recovery.md`](../../../specs/221-credential-recovery.md).

---

## The rule

> **Credential Recovery Principle:**
>
> A Smart Agent's canonical identity is stable. Credentials are
> replaceable control facets.
>
> When a passkey, SIWE EOA, hardware wallet, or other authentication
> credential is lost, replaced, or newly added, the system performs a
> **credential recovery** or **credential rotation** operation against
> the existing canonical Smart Agent identifier.
>
> This operation binds a new credential facet to the existing Smart
> Agent so it can be used for future connection, authentication, and
> initiation of agent activity. It does NOT create a new canonical
> identity and it is NOT ordinary delegation.
>
> For recoverable, organizational, treasury, service, or
> multi-custodian agents, credential recovery MUST be authorized
> through the agent's custody / recovery policy — such as a trustee
> quorum, guardian quorum, multi-signature approval, or an approved
> multi-credential recovery rule. It MUST NOT be authorized only
> through the delegation, mandate, or tool-authority layer.

### One-line restatement

```
Identity persists. Credentials rotate.
```

```
Identity     = canonical Smart Agent (ADR-0010)
Credentials  = replaceable control facets
Delegation   = authority from one Smart Agent to another
Recovery     = custody-policy-governed credential-set change on the same Smart Agent
```

## Context

[ADR-0010](./0010-smart-agent-canonical-identifier.md) established that
the canonical identifier of every Person / Organization / Service /
Treasury / Role agent is its ERC-4337 Smart Agent address (CAIP-10
`eip155:<chainId>:<sa>`). Credentials — passkeys, SIWE EOAs, hardware
wallets — are facets that authenticate as that SA, not the SA itself.

The unresolved question this ADR closes:

> When a credential is lost, compromised, or rotated, which authority
> layer authorizes the change — and what semantic name does the
> operation carry?

The wrong answer would be to model it as a **delegation** ("give the
new passkey authority to act on behalf of the lost one"). That conflates
two structurally distinct concepts: *credentials* (who can authenticate
as this agent) and *delegation* (which agent has been granted authority
by another agent). Mixing them poisons audit trails, breaks the
authority model, and leads to bypass paths through the delegation layer
that should never have existed.

The right answer is that credential changes are a **custody-policy-
governed account-control operation** on the same canonical Smart Agent.
Recovery is what the custody / threshold / trustee / guardian
infrastructure exists for. This ADR locks that choice.

## Core principles

### 1. Canonical identity persists

The canonical Smart Agent identifier (`eip155:<chainId>:<sa>`) does NOT
change during credential recovery. Same SA address before and after.

This preserves:

- Outbound delegations the agent has issued.
- Inbound delegations the agent holds.
- Naming records (`.agent`), ERC-8004 entries, profile anchors, HCS
  topics, ANS records.
- Trust-fabric edges (`agent-relationships`).
- Treasury / escrow / vault balances.
- Audit history.

Recovery does NOT migrate any of these. The SA's address is the
identity; it stays.

### 2. Credentials are control facets

Passkeys, SIWE EOAs, hardware wallets, MPC shares, and other
authentication credentials are **control credential facets**. They
authenticate AS the canonical SA, by virtue of being in its custodian
or trustee set.

A credential's role on the agent:

- **Custodian** — day-to-day signer authorized to initiate user-ops.
- **Trustee** — recovery-quorum member authorized to schedule + apply
  account-control changes.
- (Other roles defined by the custody policy.)

A credential is identified by the canonical fields shown in the
[Standard data model](#standard-data-model) below — never by the
human name attached to it.

### 3. Recovery is a custody-policy-governed operation

Credential add / replace / remove operations MUST flow through the
agent's `CustodyPolicy` (or equivalent multi-sig / threshold module),
NOT through `delegation` or `mcp-runtime`.

| Operation | Authority |
| --- | --- |
| Add a new credential | Custody quorum (custodians + / or trustees per policy) |
| Replace a credential (atomic add + remove) | Same |
| Remove / retire a compromised credential | Same |
| Mark a credential lost (off-chain) | Local UI marker; on-chain only via the above |
| Self-recovery with multiple credentials already held | Surviving custodian credential satisfying the policy |

The atomic add-new + remove-old shape (one transaction, no
half-recovered state) is the recommended default. The on-chain
custody module enforces the quorum + safety-delay (`T6` / safety
timelock) before the change applies.

### 4. Two recovery modes, same primitive

Two distinct UX modes resolve to the **same** custody operation.

**Mode A — Trustee-quorum recovery (social / custodial).**

```
Sam loses his passkey.
Sam has trustees: Alice + Bob (configured at SA birth).
Alice + Bob jointly schedule + apply the credential change.
Sam's SA's custodian set rotates: old passkey out, new passkey in.
Sam's canonical SA address is unchanged.
```

**Mode B — Multi-credential self-recovery.**

```
Alice loses her laptop passkey.
Alice still has a hardware-wallet EOA registered as a custodian.
The custody policy permits a surviving-custodian self-recovery.
Alice signs the change with her hardware-wallet EOA.
Alice's SA's custodian set rotates: old passkey out, new passkey in.
Alice's canonical SA address is unchanged.
```

Both modes are **credential-set changes on the same canonical SA**,
authorized by the applicable custody policy. They differ in *who*
satisfies the quorum, not in what kind of operation it is.

### 5. Recovery is NOT delegation

A delegation is **agent → agent** authority: agent A grants agent B
the right to take certain actions on A's behalf, optionally scoped
by caveats, optionally bound to a session, revocable, expirable.

Recovery is **inside one agent** — the same canonical SA before and
after. No second agent is delegated authority. No mandate is issued.
No tool grant is created. Mixing this with the delegation layer would
allow a delegated party to mutate the delegator's custody — a privilege
escalation the architecture explicitly refuses.

Specifically:

- A delegation MUST NOT be used to authorize a credential change.
- A delegation issued by an SA remains valid across credential
  rotation of that SA (the SA address is the principal).
- A delegated party MUST NOT gain custody powers through delegation.

### 6. Old credentials and audit

After recovery the old credential is one of: `retired`, `revoked`,
`compromised`, or `superseded`. The custody policy decides which is
allowed; the on-chain record reflects the chosen status.

Audit events MUST distinguish credential operations from delegation
operations and from canonical identity events. Sample event shapes
(consumer of `AuditSink` writes these — see [spec 221 § 8](../../../specs/221-credential-recovery.md)):

```jsonc
// Trustee-quorum recovery applied.
{
  "action": "credential.recovery.applied",
  "canonicalAgentId": "eip155:84532:0x...",
  "credentialType": "passkey",
  "operation": "rotate",
  "oldCredentialStatus": "retired",
  "newCredentialStatus": "active",
  "authorizedBy": "custody-policy",
  "recoveryMode": "trustee-quorum",
  "approverCount": 2
}

// Multi-credential self-recovery applied.
{
  "action": "credential.rotation.applied",
  "canonicalAgentId": "eip155:84532:0x...",
  "credentialType": "passkey",
  "operation": "rotate",
  "oldCredentialStatus": "retired",
  "newCredentialStatus": "active",
  "authorizedBy": "custody-policy",
  "recoveryMode": "multi-credential"
}
```

## Standard data model

These shapes belong in `@agenticprimitives/types` alongside the
canonical-identity shapes from ADR-0010.

```ts
// types/src/credential-recovery.ts
export type CredentialType =
  | 'passkey'
  | 'siwe-eoa'
  | 'hardware-wallet'
  | 'mpc-share'
  | 'kms-backed-eoa';

export type CredentialStatus =
  | 'active'
  | 'pending-active'
  | 'retired'
  | 'revoked'
  | 'compromised'
  | 'superseded';

export type CredentialRole = 'custodian' | 'trustee' | 'observer';

export interface ControlCredentialFacet {
  /** CAIP-10 of the canonical SA this credential controls. */
  canonicalAgentId: string;
  credentialType: CredentialType;
  /** keccak256 digest of the WebAuthn credentialId, EOA address, etc. */
  credentialIdDigest: `0x${string}`;
  /** Passkey x/y for passkey; address for EOA. */
  publicIdentifier: string;
  role: CredentialRole;
  status: CredentialStatus;
  enrolledAt: string; // ISO 8601
  retiredAt?: string;
}

export type RecoveryMode =
  | 'trustee-quorum'      // social / custodial: Bob + Carol approve
  | 'guardian-quorum'     // formal guardian set (org / treasury)
  | 'multi-credential'    // surviving custodian credential
  | 'multi-signature';    // generic multi-sig threshold

export interface CredentialRecoveryRequest {
  canonicalAgentId: string;
  addCredentials: ControlCredentialFacet[];
  removeCredentialIdDigests: `0x${string}`[];
  mode: RecoveryMode;
  /** Policy-supplied quorum identifier (e.g. CustodyAction.RecoverAccount). */
  custodyAction: number;
}
```

## Product wording

The user-facing surface MUST follow this language. UI strings that
imply identity is being recovered are forbidden — only access is.

| Don't say | Say |
| --- | --- |
| "Recover identity" | "Recover access to this Smart Agent" |
| "Restore your account" | "Add a replacement credential" |
| "Reset agent" | "Rotate credential" |
| "Lost agent" | "Lost credential" |
| "New agent" | "New control credential" |

Recommended explainer copy (use verbatim or close):

> Your Smart Agent identity stays the same. We are adding a new
> credential that can control or connect to it, and retiring the lost
> credential.

## What this rules out

- ❌ Modeling credential changes as a delegation (a Caveat, a Steward
  grant, a session-bound mandate). Use the custody policy.
- ❌ Authority of a delegated party to mutate the delegator's
  custodian set or recovery trustees.
- ❌ Treating loss of a credential as loss of the agent's identity.
  The agent persists; the credential set rotates.
- ❌ Issuing a brand-new canonical Smart Agent on recovery. The SA
  address never changes during credential rotation.
- ❌ UI copy that says "create a new agent for the recovered user."
- ❌ Audit events that conflate credential changes with delegation
  events. Different `action`, different schema.

## Per-package implications

| Package | Implication |
| --- | --- |
| `agent-account` | Exposes the canonical SA address that persists across credential changes. Salt MUST NOT include credential material — credentials change; the address can't. |
| `identity-auth` | Authentication resolves credential → canonical SA. After recovery, the new credential authenticates as the SAME SA. Session JWT subject is the SA address. |
| `custody` | **Owns** credential recovery operations. `CustodyAction.RecoverAccount` (atomic add + remove), `AddCustodian`, `RemoveCustodian`. Quorum + safety delay enforced on chain. |
| `delegation` | NEVER authorizes credential changes. A delegation issued before recovery remains valid after; its principal is the SA, not the rotated credential. |
| `agent-naming` | Name records are unaffected by recovery. `addr` still resolves to the same SA. Credential changes do NOT trigger re-registration. |
| `agent-identity` | Profile is unaffected by recovery. Same SA, same content hash unless the profile itself is updated. |
| `key-custody` | The credential material in KMS may change (new keys provisioned); the SA's KMS-account references update through the same custody-policy path, not through delegation. |
| `mcp-runtime` | Tool grants identify principals by SA. After credential rotation, the SAME `principal: Address` is still authorized. |
| `audit` | Distinguish `credential.*` events from `delegation.*` events. |

## Cross-references

- [ADR-0010](./0010-smart-agent-canonical-identifier.md) — canonical
  Smart Agent identifier.
- [`specs/207`](../../../specs/207-smart-account-threshold-policy.md) —
  threshold / quorum product spec.
- [`specs/209`](../../../specs/209-erc7579-module-taxonomy.md) — module
  taxonomy (CustodyPolicy as the module that enforces this).
- [`specs/213`](../../../specs/213-custody-layer-carve-out.md) —
  vocabulary firewall between custody and delegation.
- [`specs/221`](../../../specs/221-credential-recovery.md) — concrete
  process spec for this ADR.
