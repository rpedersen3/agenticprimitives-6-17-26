# spec/221 — Credential Recovery Process

**Status:** Draft (2026-05-24).
**Doctrine:** [ADR-0011](../docs/architecture/decisions/0011-credential-recovery-and-re-association.md).
**Companion:** [ADR-0010](../docs/architecture/decisions/0010-smart-agent-canonical-identifier.md), [spec 220](./220-agent-identity-bootstrap.md).
**Related contract spec:** [spec 207](./207-smart-account-threshold-policy.md) + [spec 209](./209-erc7579-module-taxonomy.md) (threshold module / `CustodyAction.RecoverAccount`).
**Vocabulary firewall:** [spec 213](./213-custody-layer-carve-out.md).

## Reference: smart-agent patterns to port

`smart-agent`'s `apps/contracts/src/custody/CustodyPolicy.sol` already
ships the on-chain primitives we need: a typed `CustodyAction.RecoverAccount`,
the schedule + safety-delay + apply T6 ceremony, and the canonical
`AgentAccountRecoveryArgs` (`addPasskeys`, `addEoaCustodians`,
`removePasskeyCredentialIdDigests`, `removeEoaCustodians`). This spec
does NOT add new contract surface; it codifies the **process**, the
**vocabulary**, and the **UI / audit** layer that consumes the existing
custody machinery.

Deliberate divergence from `smart-agent`: we elevate the doctrine to
a top-level ADR (ADR-0011) and write a process spec because we have
multiple credential layers in play (passkey, SIWE EOA, hardware wallet
in the near term; MPC + KMS-backed EOA later) and want a single rule
that governs all of them.

## 1. Scope

This spec describes the **process and vocabulary** for adding,
replacing, or removing a control credential on an existing canonical
Smart Agent.

In scope:

- The two recovery modes — trustee-quorum and multi-credential
  self-recovery.
- The credential lifecycle on the SA (active, pending-active, retired,
  revoked, compromised, superseded).
- UI flows and copy rules.
- Audit event shapes.
- Per-package boundaries.

Out of scope:

- The contract-level threshold mechanics (covered by
  [spec 207](./207-smart-account-threshold-policy.md)).
- The module taxonomy (covered by
  [spec 209](./209-erc7579-module-taxonomy.md)).
- The custody / delegation vocabulary firewall (covered by
  [spec 213](./213-custody-layer-carve-out.md)).

## 2. Vocabulary

| Term | Meaning |
| --- | --- |
| **Control credential** | Passkey, SIWE EOA, hardware wallet, MPC share, KMS-backed EOA, etc. — anything that produces a signature that the agent's custody module recognizes as authoritative. |
| **Credential facet** | A control credential viewed through the lens of [ADR-0010](../docs/architecture/decisions/0010-smart-agent-canonical-identifier.md): a registration pointing AT the canonical SA. |
| **Credential recovery** | The process of binding a new credential facet to an existing canonical SA after the loss / replacement of an existing credential. |
| **Credential rotation** | The same process when performed proactively (not in response to loss) — e.g., periodic key hygiene. Mechanically identical to recovery. |
| **Recovery mode** | The pattern of custody approval used: `trustee-quorum`, `guardian-quorum`, `multi-credential`, `multi-signature`. |
| **Trustee-quorum recovery** | N-of-M approval by configured recovery trustees. Sam → Alice + Bob. |
| **Multi-credential self-recovery** | The agent itself signs the credential change using one of its other surviving credentials. |
| **Safety delay** | The on-chain timelock between schedule and apply for recovery operations (`T6` in `CustodyPolicy.sol`; production default 48 h; demo overrides to seconds for UX). |

Forbidden terms in credential-recovery code, copy, and audit events:

- "recover the agent's identity" — the **identity** never changes.
- "delegate recovery to" — recovery is custody, not delegation.
- "issue a new agent" / "create a replacement agent" — the SA persists.
- "agent reset" — there's no reset; only credential rotation.

## 3. Canonical process

### 3.1 Trustee-quorum recovery

```
0. (BIRTH) Agent SA is deployed with custody policy:
     custodians  = [Sam.passkey.PIA]
     trustees    = [Alice.PIA, Bob.PIA]
     recoveryApprovals = floor(N_trustees / 2) + 1   // 2-of-2 for N=2

1. (LOSS) Sam can no longer produce a signature with his current credential.
   Local UI marks the credential lost; on-chain state unchanged.

2. (NEW CREDENTIAL) Sam (or any party with access to the device that
   will hold the replacement) registers a new WebAuthn passkey / EOA /
   etc. on a device under Sam's control. The new credential is NOT yet
   authoritative — it is staged off-chain.

3. (SCHEDULE) Trustee quorum (Alice + Bob) signs a typed
   ScheduleCustodyChangeRequest with:
     action = CustodyAction.RecoverAccount
     innerArgs = buildRecoverAccountArgs({
       addPasskeys: [new credential],
       removePasskeyCredentialIdDigests: [lost credential digest],
     })
   The SA's CustodyPolicy verifies the quorum, records the scheduled
   change, and emits ChangeScheduled with an eta = block.timestamp + T6.

4. (SAFETY DELAY) T6 elapses. During this window the change CAN be
   cancelled by an authorized cancel-quorum (per policy).

5. (APPLY) Trustee quorum signs ApplyCustodyChangeRequest. The SA's
   CustodyPolicy verifies eta has passed, applies the credential change
   atomically (add new + remove old in one transaction), emits
   CredentialAdded + CredentialRemoved events.

6. (POST-RECOVERY) The SA address is unchanged. The new credential
   can authenticate as the SA from this point on; the old credential
   is rejected.
```

### 3.2 Multi-credential self-recovery

```
0. (BIRTH) Agent SA is deployed with custody policy:
     custodians = [Alice.passkey.PIA, Alice.hardware-wallet.EOA]
     // The custody policy permits a single-custodian self-recovery
     // because two distinct credential types are enrolled.

1. (LOSS) Alice loses her laptop passkey.

2. (NEW CREDENTIAL) Alice registers a replacement passkey on a new
   device.

3. (SCHEDULE) Alice signs ScheduleCustodyChangeRequest with her
   hardware-wallet EOA. The custody policy recognizes the surviving
   custodian + the policy's self-recovery rule. Schedule recorded with
   eta.

4. (SAFETY DELAY) T6 elapses.

5. (APPLY) Alice signs ApplyCustodyChangeRequest with her
   hardware-wallet EOA. The custody policy applies the change.

6. (POST-RECOVERY) Same SA address, new passkey + same hardware wallet
   in the custodian set.
```

### 3.3 What both modes share

- One canonical SA throughout. Address unchanged.
- Atomic add-new + remove-old (no half-recovered state).
- On-chain `CustodyAction.RecoverAccount` is the only authoritative
  operation. Off-chain markers ("declared lost") are UI hints, not
  state of record.
- Audit events differ only in `recoveryMode`.

## 4. Credential lifecycle

```
[ unregistered ]
       │ enrolment via custody add operation
       ▼
[ pending-active ] ── safety delay ── ▶ [ active ]
                                            │
       ┌────────────────────────────────────┤
       │ rotation (replace)                 │ removal
       │                                    ▼
       │                              [ retired ]
       │ compromise found                   │
       ▼                                    │
[ compromised ]                       [ superseded ]
       │
       │ remove via custody operation
       ▼
[ revoked ]
```

States:

| State | Meaning |
| --- | --- |
| `pending-active` | Scheduled to be added, not yet within authoritative quorum (during T6). |
| `active` | Currently in the SA's custodian / trustee set. |
| `retired` | Removed cleanly (user-initiated rotation, not under compromise). |
| `superseded` | Replaced as part of a `RecoverAccount` rotation (paired with a new `active`). |
| `revoked` | Removed by policy decision (admin / quorum). |
| `compromised` | Marked compromised before removal; audit-flagged. |

## 5. UI requirements

### 5.1 Banner / framing

Every screen in the credential-recovery flow MUST surface the doctrine.
Recommended banner (use verbatim or close):

```
Canonical identity persists. Credentials rotate.
Your Smart Agent identity stays the same. We are adding a new
credential that can control or connect to it, and retiring the
lost credential.
```

### 5.2 Copy rules

| Forbidden | Required |
| --- | --- |
| "Recover identity" | "Recover access to this Smart Agent" |
| "Restore account" | "Add a replacement credential" |
| "Lost agent" | "Lost credential" |
| "Lost passkey" (when used as identity) | "Lost passkey credential" |
| "Create new agent" | "Register replacement credential" |

### 5.3 Required information

The recovery UI MUST display, at all steps:

- The canonical Smart Agent identifier in CAIP-10 form
  (`eip155:84532:0x…`), prefixed with `Canonical Agent ID:`.
- The agent's display name (if any) as a SECONDARY line, prefixed
  with `Name:`. The name MUST NOT be the primary identifier.
- The current and target credential set (which credential is being
  retired, which is being added).
- The recovery mode (`trustee-quorum` / `multi-credential` / etc.).
- The quorum requirement (e.g., "2-of-2 trustee approval").
- The safety-delay duration.

### 5.4 Confirmation copy

Before the schedule + apply ceremony begins, the UI MUST confirm:

```
You are not creating a new agent. You are rotating the control
credential on the existing Smart Agent {canonicalAgentId}. The
agent's address, name, profile, delegations, and balances are
unchanged.
```

## 6. Audit events

Consumers of `AuditSink` SHOULD emit the following events (consumer
chooses the durable sink; sink schema is forward-compatible).

```jsonc
// Off-chain marker.
{
  "action": "credential.loss.declared",
  "canonicalAgentId": "eip155:84532:0x...",
  "credentialType": "passkey",
  "credentialIdDigest": "0x...",
  "ts": "2026-05-24T18:01:23Z"
}

// Schedule submitted.
{
  "action": "credential.recovery.scheduled",
  "canonicalAgentId": "eip155:84532:0x...",
  "operation": "rotate",
  "addCredentials":    [ /* facets */ ],
  "removeCredentialIdDigests": [ "0x..." ],
  "recoveryMode": "trustee-quorum",
  "approverCount": 2,
  "etaUnix": 1748112000,
  "tx": "0x..."
}

// Apply succeeded.
{
  "action": "credential.recovery.applied",
  "canonicalAgentId": "eip155:84532:0x...",
  "operation": "rotate",
  "oldCredentialStatus": "superseded",
  "newCredentialStatus": "active",
  "recoveryMode": "trustee-quorum",
  "tx": "0x..."
}

// Proactive rotation (same shape, no loss event).
{
  "action": "credential.rotation.applied",
  "canonicalAgentId": "eip155:84532:0x...",
  "operation": "rotate",
  "oldCredentialStatus": "retired",
  "newCredentialStatus": "active",
  "recoveryMode": "multi-credential",
  "tx": "0x..."
}
```

Audit events MUST NOT use the `delegation.*` action namespace.

## 7. Per-package contracts

### `@agenticprimitives/account-custody`
- Owns `CustodyAction.RecoverAccount` enum value + `buildRecoverAccountArgs`.
- Owns the EIP-712 typed-data shapes for the schedule + apply
  ceremony.
- MUST expose helpers usable by both demo apps and production
  consumers without leaking delegation-domain vocabulary.

### `@agenticprimitives/connect-auth`
- Authentication resolves credential → canonical SA.
- After recovery, the new credential authenticates as the SAME SA.
- JWT primary subject = canonical SA; credential / EOA = signer claim.

### `@agenticprimitives/agent-account`
- `AgentAccountClient.address` is stable across credential changes.
- The CREATE2 salt MUST NOT include credential material.

### `@agenticprimitives/delegation`
- MUST refuse to be the authorization layer for credential changes.
- A delegation issued by an SA remains valid after credential
  rotation of that SA. Principal = SA address (not the credential).
- Forbidden terms: any `recoverCredential`, `addCredential`,
  `rotatePasskey` API. Those belong in `custody`.

### `@agenticprimitives/agent-naming` / `agent-identity` / `agent-relationships`
- Records anchored at the SA address are unaffected by credential
  rotation. No re-registration. No record rewrite.

### `@agenticprimitives/types`
- Hosts `ControlCredentialFacet`, `CredentialStatus`,
  `CredentialRole`, `RecoveryMode`, `CredentialRecoveryRequest`
  (per ADR-0011 § Standard data model).

## 8. Reference implementation: `apps/demo-web-recovery`

The recovery demo implements the trustee-quorum path (Mode A). Acts
0–5:

| Act | Doctrine mapping |
| --- | --- |
| 0 — Prereqs | Enrol the trustees' canonical SAs + passkey credentials. |
| 1 — Sam joins | Deploy Sam's SA with Alice + Bob trustees + `recoveryApprovals = 2`. |
| 2 — Lost credential | Mark Sam's credential lost (off-chain marker). |
| 3 — New credential | Register replacement credential (not yet authoritative). |
| 4 — Recovery | Trustee-quorum schedule + apply `CustodyAction.RecoverAccount`. |
| 5 — Verify | On-chain probe confirms: SA address unchanged, new credential is now custodian, old credential is no longer custodian. |

Demo UI MUST show the canonical SA address as the primary identifier
on every act + reference the doctrine banner.

Multi-credential self-recovery (Mode B) is not in the demo today;
adding it is a follow-up.

## 9. Open questions / future work

- **F1.** Multi-credential self-recovery flow in demo + UI primitives.
- **F2.** Cross-device passkey export / sync — when does a "moved
  passkey" count as a new credential vs. the same one? (Lean toward:
  same `credentialIdDigest` = same credential; OS-level sync is
  invisible to the SA.)
- **F3.** Compromise-flag flow — explicit "this credential is
  compromised, blacklist permanently" path.
- **F4.** Treasury / org recovery — the doctrine applies the same;
  the demo for it is in `apps/demo-web-pro` (future Act).
- **F5.** Audit-sink schema versioning for the events in § 6.
