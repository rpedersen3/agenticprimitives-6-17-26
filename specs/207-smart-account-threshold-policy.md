# Spec 207 — Smart-account threshold policy

**Status:** v0 draft · 2026-05-20
**Closes:** new audit finding **N16** (smart-account multi-sig and recovery policy is not productized).
**Builds on:** spec 201 (`agent-account`), spec 202 (`delegation`), spec 130 (`passkey-flow`), the multi-sig contracts shipped in pass 6c.1 (`QuorumEnforcer`, `ApprovedHashRegistry`, `MultiSendCallOnly`).
**Reference: smart-agent patterns to port:** `packages/contracts/src/AgentAccount.sol` (multi-owner mapping shape), `packages/contracts/src/enforcers/QuorumEnforcer.sol` (Safe-compatible signature aggregation — ported in 6c.1), `packages/contracts/src/ApprovedHashRegistry.sol` (pre-approval registry — ported in 6c.1). Deliberate divergence: smart-agent does not productize risk-tier thresholds at the account layer — that pattern is original here, modeled after Safe's owner+threshold+modules+guards architecture and MetaMask's Hybrid / Multisig account modes.

> **Doctrine:** The platform's core direction is **"smart account owns multiple signers and enforces thresholds on-chain."** This spec defines the productized surface across signer types, action tiers, recovery, and admin gating. Multi-sig is not a feature toggle on the side; it is the **default shape** of the AgentAccount once this spec lands. Spec 201 (`agent-account`) v0 ships with `mode = single` as the only mode; spec 207 ships `mode ∈ {single, hybrid, multisig, enterprise}` as the productized matrix.
>
> **Substrate independence:** agenticprimitives ships its own multi-sig end-to-end. We do NOT integrate Gnosis Safe Singleton, Safe{Wallet}, or any other third-party multi-sig contract as a runtime dependency. We DO port battle-tested patterns from Safe (signature packing format, owner+threshold+module architecture) and from MetaMask's account-mode taxonomy — patterns are public goods; runtime deps are not. The "Safe-compatible" framing throughout this spec refers exclusively to the **on-chain signature packing format**, so external Safe-shaped tooling can sign for our accounts. Safe contracts themselves never appear in our deploy.

---

## 1. Goal

Define how an `AgentAccount` represents, authorizes, and recovers from multi-signer ownership. Today the contract has `_owners` as a `mapping(address => bool)` (multi-owner-capable) but the **product surface treats it as 1-of-N** — any single owner can authorize anything via ERC-1271. That's fine for the demo. It's disqualifying for any production deploy that holds non-trivial value, deploys irreversible actions, or carries recovery obligations.

This spec productizes:
- **Signer types** as a first-class taxonomy (EOA / passkey / guardian).
- **Account modes** as the user-selectable shape of the account.
- **Risk-tier thresholds** — different actions require different signer counts, not a single global threshold.
- **High-risk delegation approval** — large-value grants require on-chain pre-authorization via the existing `acceptSessionDelegation` hook.
- **Guarded admin actions** — owner management, upgrade, and registry changes require threshold + (sometimes) timelock.
- **Multi-passkey recovery** — production accounts MUST be recoverable without a single point of compromise.

The 6c.1 primitives (`QuorumEnforcer`, `ApprovedHashRegistry`, `MultiSendCallOnly`) are the on-chain building blocks; this spec defines **how** they compose into a product surface that an operator can reason about.

---

## 2. Audit finding N16 (new — to be added to `docs/architecture/product-readiness-audit.md`)

| ID | Severity | Finding | Owner | Remediation |
| --- | --- | --- | --- | --- |
| **N16** | P2 | **Smart-account multi-sig and recovery policy is not productized.** `AgentAccount` supports multiple owners/passkeys at the contract layer, but the product does not define threshold requirements for recovery, upgrades, owner changes, high-risk delegation grants, or `DelegationManager` changes. Any single owner currently authorizes any action. | `agent-account` + new `multi-sig` package | Land spec 207; productize signer taxonomy + account modes + risk-tier thresholds + guarded admin actions; ship with at least two passkey owners required before any production deploy. Tests required before production listed in § 9 below. |

---

## 3. Signer taxonomy

Three signer types, each with a distinct role + key shape + authority class. These are **product concepts** — they're enforced via contract state + caveats, not via separate signer interfaces in the SDK (which stays the unified `Signer` from `identity-auth`).

| Signer type | Key shape | Authority class | Removable? | Typical use |
| --- | --- | --- | --- | --- |
| **EOA** | secp256k1 private key | Primary signer | Yes, by threshold | The user's wallet (MetaMask, Rainbow, ledger), or a service-account relayer |
| **Passkey** | P-256 WebAuthn credential | Primary signer | Yes, by threshold | Device-bound auth, biometric UV gate available for write tier |
| **Guardian** | EOA OR contract (multi-sig itself) | Recovery-only | Yes, by threshold | Trusted third party (a friend, a custodian, another AgentAccount) authorized to participate in recovery quorum but NOT in routine delegation issuance |

**Why a Guardian role:** Recovery threshold and routine threshold serve different threat models. A guardian should not be able to issue session delegations or trigger payments on the user's behalf; they should only be able to participate in a recovery flow that re-establishes the user's primary signer set. Contract-level distinction: guardians are tracked in a separate `_guardians` mapping; their address recovers ERC-1271 only when the call is gated by the `RECOVERY_QUORUM_CAVEAT` (see § 6).

---

## 4. Account modes

Four canonical modes the user picks during account creation. Each mode pins specific defaults for the § 5 risk-tier table.

| Mode | Owners | Passkeys | Guardians | Default behavior |
| --- | --- | --- | --- | --- |
| **`single`** | 1 EOA | 0 | 0 | Today's demo. 1-of-1 across all tiers. Disqualifying for any production deploy. |
| **`hybrid`** | 1 EOA | ≥ 1 passkey | 0 | Like MetaMask's Hybrid account: the EOA is the "main" signer; passkeys gate write/deploy tiers via UV. Single passkey acceptable for desktop demos; **production requires ≥ 2 passkeys.** |
| **`multisig`** | 0+ EOA | 0+ passkeys | 0+ guardians | First-class threshold account. Owner set is configurable n-of-m; risk tiers map to different sub-thresholds. **Recommended default for any non-trivial value.** |
| **`enterprise`** | 0+ EOA | 0+ passkeys | 0+ guardians | Same shape as `multisig` plus mandatory timelocks on every § 7 admin action, plus separation of duties (a single signer cannot participate in both quorum and timelock-execute roles). |

Mode is **set at deploy time** in the factory's `createAccount*` calls and emitted in the `AccountCreated` event. Mode changes require a § 7 admin flow.

---

## 5. Risk-tier thresholds (the load-bearing table)

This is the spec's headline contribution: actions are not gated by a single global threshold; they are partitioned by **risk tier**, and each tier has its own threshold requirement. The tiers below are the canonical set; new actions added later MUST map to one of them or motivate a new tier.

| Action | Tier | Requirement (single) | Requirement (hybrid) | Requirement (multisig) | Requirement (enterprise) |
| --- | --- | --- | --- | --- | --- |
| Read-only MCP delegation issuance | T1 — Read | 1 signer | 1 signer | 1 signer | 1 signer |
| Write / deploy session delegation | T2 — Write | 1 signer | 1 EOA **+** passkey UV | threshold | threshold + UV |
| Token / value transfer delegation | T3 — Value | 1 signer | 1 EOA + passkey UV | threshold | threshold + UV |
| Add / remove owner | T4 — Admin | 1 signer | 1 EOA + passkey UV | threshold | threshold + timelock |
| Add / remove passkey | T4 — Admin | 1 signer | 1 EOA + passkey UV | threshold | threshold + timelock |
| Add / remove guardian | T4 — Admin | 1 signer | 1 EOA + passkey UV | threshold | threshold + timelock |
| Change account mode | T4 — Admin | 1 signer | n/a (must be multisig+) | threshold | threshold + timelock |
| Upgrade account implementation | T5 — Critical | 1 signer | 1 EOA + passkey UV | threshold + timelock | threshold + timelock + separation |
| Change DelegationManager | T5 — Critical | 1 signer | 1 EOA + passkey UV | threshold + timelock | threshold + timelock + separation |
| Change paymaster / session-issuer role | T5 — Critical | 1 signer | 1 EOA + passkey UV | threshold + timelock | threshold + timelock + separation |
| Recover account (re-establish signer set) | T6 — Recovery | 1 signer | 1 passkey OR EOA + guardian | recovery threshold | recovery threshold + separation |

**Tier definitions:**

- **T1 Read** — Delegations whose redeem can ONLY produce information disclosure or off-chain effects. No on-chain state mutation. No value transfer. Caveats MUST pin the target contract to known read-only surfaces (use `AllowedTargetsEnforcer` + `AllowedMethodsEnforcer` to restrict to view-shaped selectors).
- **T2 Write** — Delegations that mutate on-chain state but transfer no native value or token > `T3_VALUE_CEILING`. Default ceiling: 0.001 ETH equivalent.
- **T3 Value** — Delegations that transfer native ETH or tokens above the T3 ceiling. The QuorumEnforcer caveat is **required** for the multisig/enterprise modes.
- **T4 Admin** — Owner/passkey/guardian/mode changes on the account. Mutates the trust root.
- **T5 Critical** — Mutates platform-level pointers (impl, DelegationManager, paymaster). Effectively a re-architecture of trust.
- **T6 Recovery** — Re-establishes the signer set when the user has lost primary keys.

**"threshold"** in the table means: `signatures count >= account.threshold(tier)`. Each tier has its own threshold getter so e.g. T3 can require 2-of-3 while T5 requires 3-of-3.

**"+ UV"** means: at least one passkey signature with the `UV` (user-verification) flag set. Biometric gate on the device.

**"+ timelock"** means: the action's intent must be queued on-chain via `propose<Action>(...)` and execute only after `block.timestamp >= proposal.eta`. ETA = `block.timestamp + TIMELOCK_DURATION(tier)`. Default durations: 1h for T4, 24h for T5.

**"+ separation"** means: the signer set that participated in `propose` MUST NOT overlap (by `>= threshold(tier)`) with the signer set that participates in `execute`. Enforces "two-person rule" semantics.

---

## 6. High-risk delegation approval

Builds on the existing `acceptSessionDelegation(hash)` hook on `AgentAccount` (see `apps/contracts/src/AgentAccount.sol`). That function already serves as a "this delegation hash has been blessed on-chain" signal; we extend the off-chain delegation verifier to check it conditionally based on tier:

| Tier | Off-chain delegation signature alone? | On-chain `acceptSessionDelegation` required? |
| --- | --- | --- |
| T1 Read | ✅ | ❌ |
| T2 Write | ✅ for `single`/`hybrid`; quorum sig for `multisig`/`enterprise` | ❌ |
| T3 Value | quorum sig | ❌ for routine; ✅ when above `T3_HIGHVALUE_THRESHOLD` |
| T4–T6 | quorum sig | ✅ (timelock+propose flow) |

For T3 high-value grants, the redeem path checks `account.isAcceptedSessionDelegation(hash)` and fails closed if false. The existing `verifyDelegationToken` accept event (audit C3, closed in pass 5b) gets a new `acceptedOnChain: boolean` context field so the audit trail records whether the redeem leaned on the on-chain blessing.

`T3_HIGHVALUE_THRESHOLD` is a per-account configurable bound, defaulting to 1 ETH equivalent (set at account creation, mutable via T4 admin flow).

---

## 7. Guarded admin actions

The actions in the T4–T5 rows of § 5 share a common gating shape. Define them as a single `AdminAction` enum + a routed `proposeAdmin` / `executeAdmin` pair on `AgentAccount`:

```solidity
enum AdminAction {
    AddOwner,
    RemoveOwner,
    AddPasskey,
    RemovePasskey,
    AddGuardian,
    RemoveGuardian,
    ChangeMode,
    UpgradeImpl,
    ChangeDelegationManager,
    ChangePaymaster,
    ChangeSessionIssuer
}
```

`proposeAdmin(AdminAction action, bytes args, bytes quorumSignatures)`:
- Verifies `quorumSignatures` via the same `QuorumEnforcer.beforeHook` machinery used for delegations.
- Records `pendingAdmin[proposalId] = AdminProposal({action, args, eta: now + TIMELOCK_DURATION(tier), proposer: msg.sender})`.
- Emits `AdminProposed(proposalId, action, eta)`.

`executeAdmin(uint256 proposalId, bytes quorumSignatures)`:
- Loads the proposal, requires `block.timestamp >= proposal.eta`.
- In **enterprise** mode: rejects if the executing signer set overlaps the proposing signer set by `>= threshold(tier) - 1` (separation of duties).
- Dispatches via internal `_apply<Action>` functions.
- Emits `AdminExecuted(proposalId)`.

`cancelAdmin(uint256 proposalId, bytes quorumSignatures)`:
- Same threshold as `proposeAdmin`.
- Sets the proposal's `eta = type(uint256).max` so it can never execute.
- Emits `AdminCancelled(proposalId)`.

**Why we don't extend ERC-1271 for admin actions:** ERC-1271 is for signature verification of off-chain payloads. Admin actions are explicit state-mutating calls on the account that MUST emit events for the audit trail; they don't compose cleanly with the ERC-1271 path.

---

## 8. Recovery (T6) — multi-passkey + guardian flow

Recovery hardens audit finding **N7** (passkey recovery is unclear today). The flow:

1. User can no longer produce a primary-signer signature (lost device, forgotten passkey, etc.).
2. User initiates recovery off-chain by contacting their guardians. Each guardian either:
   - Pre-approves the recovery hash via `ApprovedHashRegistry.approveHash(...)` (the v=1 path of QuorumEnforcer), OR
   - Signs the recovery EIP-712 payload off-chain (any of the QuorumEnforcer v=27/28/>30 paths).
3. The recovery flow assembles `recoverySignatures` from a quorum of guardians + (optionally) any surviving primary signers.
4. Calls `proposeRecovery(newOwners[], newPasskeys[], removeOldOwners[], removeOldPasskeys[], recoverySignatures)`.
5. After `TIMELOCK_DURATION(T6_RECOVERY)` (default: 72h), calls `executeRecovery(proposalId, recoverySignatures)`.
6. The 72h timelock window is non-negotiable: it gives the rightful owner a window to **cancel** a hostile recovery attempt if any primary signer is still functional. The primary owner can call `cancelAdmin(proposalId, sig)` with their own signature (T4 threshold) during this window.

**Recovery threshold** is configured at account-creation time, defaulting to `ceil(guardianCount / 2) + 1` (majority + 1). If the account has 0 guardians, recovery is impossible — by design, since key-loss is unrecoverable without external trust. The factory's `createAccount` MUST refuse to deploy a `multisig`/`enterprise` account with 0 guardians.

**Two-passkey-minimum requirement for production:**

| Mode | Minimum config for production |
| --- | --- |
| `single` | Disallowed for production |
| `hybrid` | ≥ 2 passkeys OR 1 passkey + 1 recovery-EOA guardian |
| `multisig` | ≥ 2 guardians required at account creation |
| `enterprise` | ≥ 3 guardians required (so recovery threshold is ≥ 2) |

The factory enforces these minima for any account whose `mode != single`. The frontend (demo-web) MUST warn the user before they deploy a `single` account.

---

## 9. Tests required before production

This section is the **launch gate** for any account mode beyond `single`. Production deploys MUST verify each row:

| # | Test | What it proves |
| --- | --- | --- |
| 1 | T1 read delegation in `multisig` mode with 1 signer succeeds | Tier mapping correctly bypasses quorum on read-only |
| 2 | T2 write delegation in `hybrid` mode without UV fails closed | Hybrid mode's UV gate is load-bearing |
| 3 | T3 value delegation above `T3_HIGHVALUE_THRESHOLD` without `acceptSessionDelegation` fails closed | High-value on-chain blessing is enforced |
| 4 | T4 `AddOwner` in `multisig` with sub-threshold sigs fails closed | Quorum verification on admin path |
| 5 | T5 `UpgradeImpl` in `multisig` without timelock fails closed | Timelock is enforced |
| 6 | T5 `UpgradeImpl` in `enterprise` with overlapping propose/execute signers fails closed | Separation of duties is enforced |
| 7 | T6 recovery with 2-of-3 guardians + 72h timelock succeeds | Recovery happy path |
| 8 | T6 recovery cancelled by primary owner within 72h reverts the execute | Hostile-recovery escape hatch |
| 9 | Recovery with 0 guardians is impossible (factory rejects deploy) | No-recovery footgun blocked |
| 10 | `acceptSessionDelegation` emits an audit event recording the on-chain blessing | Trail captures the high-value gate |
| 11 | All admin actions emit `AdminProposed` / `AdminExecuted` / `AdminCancelled` events | Forensics trail for trust-root mutations |
| 12 | QuorumEnforcer caveat composes correctly with TimestampEnforcer + ValueEnforcer on T3 delegations | Caveat stacking is not broken by quorum requirement |

Each row maps to a Forge test (T1–T11) or a Playwright e2e (T12 via demo flow). System-level testing strategy in `specs/110-test-strategy.md` updated to include this section.

---

## 10. Package surface changes

Concrete changes to land per phase:

### Phase 6c.2 — multi-sig package + AgentAccount extension

- Extend `AgentAccount.sol`:
  - Add `_guardians` mapping + `_modeFlags` packed field for mode + thresholds-per-tier.
  - Add `proposeAdmin` / `executeAdmin` / `cancelAdmin` machinery.
  - Add `recoveryThreshold()`, `threshold(uint8 tier)` getters.
- New `@agenticprimitives/multi-sig` package (TypeScript SDK):
  - `buildQuorumCaveat({signers, threshold, approvedHashRegistry})` — already planned in 6c task description.
  - `packSafeSignatures(parts)` — Safe-compatible 65-byte-slot blob packer.
  - `preApproveHash(account, hash)` — wraps `ApprovedHashRegistry.approveHash`.
  - **NEW from this spec:** `proposeAdminAction({account, action, args, signers})`, `executeAdminAction({account, proposalId, signers})`, `recoveryFlow(...)` helpers.
  - Per-package `CLAUDE.md`, `AUDIT.md`, `capability.manifest.json`, `spec.md` (pointing at this 207 spec).

### Phase 6c.3 — wire QuorumEnforcer caveat into delegation issuance

- `@agenticprimitives/delegation`: re-export `buildQuorumCaveat` for callers issuing T3/T4/T5 delegations.
- `verifyDelegationToken`: accept new `requireQuorum: boolean` opt; fail closed if absent on a delegation that carries a `QuorumEnforcer` caveat.
- Audit C3 emission gets a new `acceptedOnChain` context field on accept rows.

### Phase 6c.4 — frontend wiring

- demo-web Step 0: "Account mode" selector (default to `multisig` once the package lands).
- Step 2: tier-aware delegation issuance flow; for T3+ the UI prompts "this is a high-value grant — n signers must approve."
- Step 4 (NEW): Account admin panel — propose/execute/cancel admin actions; show pending admin proposals with countdown to ETA.
- Step 5 (NEW): Recovery flow — initiate, list guardians, collect approvals, execute.

### Phase 6c.5 — Forge tests + Playwright e2e

- 12 tests from § 9, file naming: `test/ThresholdPolicy*.t.sol` + `tests/e2e/06-account-admin.spec.ts`.

---

## 11. Open questions

- **Per-tier vs per-action thresholds**: spec uses tier-level thresholds. Should we allow per-action overrides (e.g. T5 `UpgradeImpl` needs 4-of-5 but T5 `ChangeDelegationManager` needs 3-of-5)? Defer to v0.1 — tier-level is simpler and easier to reason about.
- **Cross-account guardians**: should a guardian be allowed to be another `AgentAccount` (not just an EOA)? Yes in spirit (the ERC-1271 path handles it), but the demo doesn't exercise this. Document but don't test in v0.
- **Threshold + UV combinatorics in hybrid mode**: hybrid mode's T2/T3 says "1 EOA + passkey UV". Should "passkey UV" count toward an additional quorum slot, or be a parallel gate? Spec treats it as a parallel gate (both must be satisfied independently). Revisit if the UX gets clunky.
- **Auto-rotation of compromised signers**: out of scope. The recovery flow handles total-loss; partial compromise requires the user to add a new signer + remove the compromised one via T4 admin flow, signed by remaining-good signers.

---

## 12. Reference: smart-agent patterns to port

Per the repo doctrine, smart-agent's relevant patterns to mirror:

- **`AgentAccount._owners` multi-owner mapping shape** (`smart-agent/packages/contracts/src/AgentAccount.sol`) — we already have this. Extend with `_guardians` + `_modeFlags`.
- **`QuorumEnforcer` Safe-compatible signature aggregation** — **ported in 6c.1.**
- **`ApprovedHashRegistry` v=1 path** — **ported in 6c.1.**
- **`StewardEligibilityEnforcer` runtime eligibility check** (`smart-agent/packages/contracts/src/enforcers/StewardEligibilityEnforcer.sol`) — useful pattern for guardian eligibility, but smart-agent's coupling to a stewardship registry is too specific; the simpler `_inSet` check in our QuorumEnforcer suffices.

**Deliberate divergence:**

- **Risk-tier table is original to agenticprimitives.** Smart-agent does not productize risk tiers at the account layer. The closest analog is the data-scope grant model in spec 003 (intent marketplace), but that's a delegation-level construct, not an account-level one.
- **Account modes (single/hybrid/multisig/enterprise) are original.** Smart-agent has a single AgentAccount shape; we adopt MetaMask's account-mode taxonomy because it maps cleanly onto user mental models.
- **Timelock semantics are original.** Smart-agent has no timelocked admin actions; we add them for T5/T6 because the threat models genuinely differ from routine signing.

---

## 13. Acceptance for review

When you read this spec, please react to:

1. The signer taxonomy (§ 3) — three types right? Or do we want a fourth ("session" as a first-class signer separate from "delegation"?)
2. The account modes (§ 4) — single/hybrid/multisig/enterprise feel right? Is `enterprise` overkill for v0, or table-stakes?
3. The risk-tier table (§ 5) — tier boundaries map to your mental model?
4. High-risk delegation reuse of `acceptSessionDelegation` (§ 6) — agree it's the right hook?
5. The admin action enum + propose/execute/cancel shape (§ 7) — any actions missing? Anything that shouldn't be guarded?
6. Recovery flow + 2-passkey-minimum (§ 8) — 72h timelock right, or longer / shorter?
7. The 12 launch-gate tests (§ 9) — coverage feels complete? Missing critical edge?
8. Whether 6c.4 (demo-web admin + recovery panels) ships in this phase or moves to phase 7.

Once those are pinned, I'll convert 6c.2 to "implement § 10.1" and proceed.
