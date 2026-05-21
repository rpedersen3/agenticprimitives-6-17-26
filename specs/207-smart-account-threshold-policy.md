# Spec 207 — Smart-account threshold policy

**Status:** v0 mostly implemented · 2026-05-20 — contract + SDK + runtime layers shipped end-to-end (Forge 181/181 + workspace tests green); live wiring + Playwright e2e for § 9 rows 1/2/3/12 pending. **Open blocker (phase 6c.5-d):** `AgentAccount` runtime bytecode is 26,876 bytes — 2,300 over the EIP-170 deploy ceiling — so the impl can't deploy to Base Sepolia (or any EIP-170-enforcing chain). Live wiring blocked on the **ERC-7579 module decomposition** documented in [spec 209](./209-erc7579-module-taxonomy.md). § 14 of this spec (an earlier "AdminModule delegatecall blob" plan) is superseded by spec 209. See `docs/architecture/cross-cutting-capabilities.md` for the current row.
**Closes:** new audit finding **N16** (smart-account multi-sig and recovery policy is not productized).
**Builds on:** spec 201 (`agent-account`), spec 202 (`delegation`), spec 204 (`tool-policy`), spec 130 (`passkey-flow`), the multi-sig contracts shipped in pass 6c.1 (`QuorumEnforcer`, `ApprovedHashRegistry`, `MultiSendCallOnly`).
**Reference: smart-agent patterns to port:** `packages/contracts/src/AgentAccount.sol` (multi-owner mapping shape), `packages/contracts/src/enforcers/QuorumEnforcer.sol` (Safe-compatible signature aggregation — ported in 6c.1), `packages/contracts/src/ApprovedHashRegistry.sol` (pre-approval registry — ported in 6c.1). Deliberate divergence: smart-agent does not productize risk-tier thresholds at the account layer — that pattern is original here, modeled after Safe's owner+threshold+modules+guards architecture and MetaMask's Hybrid / Multisig account modes.

> **Doctrine: multi-sig is safety + recovery, not a "ceremony."** Seamless products (Safe, MetaMask Smart Accounts, Coinbase Smart Wallet) do not present multi-sig as a crypto ceremony. They present it as **account safety, recovery, approval policy, and delegation control**. We adopt the same framing throughout spec text, contract NatSpec, SDK docs, and UX copy. "Sign hash" is a smell; the user should see *"2 approvals required to let Agent X spend up to 10 USDC/day until Friday."* Spec 201 (`agent-account`) v0 ships with `mode = single` as the only mode; spec 207 ships `mode ∈ {single, hybrid, threshold, org}` as the productized matrix. Threshold=1 with one signer is the trivial case (the existing demo flow), not a separate code path.
>
> **Integration, not bolt-on.** Multi-sig is NOT a standalone `@agenticprimitives/multi-sig` package or an opt-in feature surface. The threshold + signer-set + risk-tier concepts thread through the existing packages by ownership:
> - `agent-account` owns multi-owner state, `_guardians`, `_modeFlags`, threshold getters, admin actions, and recovery.
> - `delegation` carries signer sets natively (threshold=1 is the trivial case), and `buildQuorumCaveat` is a peer of the existing caveat builders.
> - `tool-policy` owns the risk-tier taxonomy (T1 Read / T2 Write / T3 Value / T4 Admin / T5 Critical / T6 Recovery) — risk tiers are already its domain per spec 204.
> - `identity-auth` is unchanged — the `Signer` interface stays signer-shape-agnostic.
> - `mcp-runtime` is unchanged — `withDelegation` calls verify; verify transparently handles n-of-m once delegation does.
>
> A consumer reading our docs should not have to "enable multi-sig" — they should always be dealing with `Delegation` objects that may have 1+ signers, gated by `threshold(tier)` on the account. The on-chain primitives shipped in 6c.1 (`QuorumEnforcer`, `ApprovedHashRegistry`, `MultiSendCallOnly`) stay where they landed in `apps/contracts/`; they're not getting wrapped in a new package boundary.
>
> **Substrate independence.** agenticprimitives ships its own multi-sig end-to-end. We do NOT integrate Gnosis Safe Singleton, Safe{Wallet}, or any other third-party multi-sig contract as a runtime dependency. We DO port battle-tested patterns from Safe (signature packing format, owner+threshold+module architecture) and from MetaMask's account-mode taxonomy — patterns are public goods; runtime deps are not. The "Safe-compatible" framing throughout this spec refers exclusively to the **on-chain signature packing format** so external Safe-shaped tooling can sign for our accounts. Safe contracts themselves never appear in our deploy.

---

## 1. Goal

Define how an `AgentAccount` represents, authorizes, and recovers from multi-signer ownership. Today the contract has `_owners` as a `mapping(address => bool)` (multi-owner-capable) but the **product surface treats it as 1-of-N** — any single owner can authorize anything via ERC-1271. That's fine for the demo. It's disqualifying for any production deploy that holds non-trivial value, deploys irreversible actions, or carries recovery obligations.

This spec productizes:
- **Signers as a two-dimensional model** — kind (EOA / passkey / smart-account / hardware wallet) × role (primary / recovery / agent / steward). Sessions are an authority role, not a signer kind.
- **Account modes** as the user-selectable shape of the account: `single` / `hybrid` / `threshold` / `org`. User-facing labels: "Just me" / "Me + backups" / "Multiple approvers" / "Organization."
- **Threshold classes** — different actions require different signer counts; the T1–T6 tier table in § 5 is the contract-layer surface, exposed in user-readable language ("daily threshold," "admin threshold," "high-risk delegation threshold," "recovery threshold") in SDK + UI.
- **High-risk delegation approval** — large-value grants require human-readable permission cards + threshold approval + on-chain pre-authorization via the existing `acceptSessionDelegation` hook.
- **Guarded admin actions** — owner / passkey / guardian / mode changes require threshold; upgrade + DelegationManager + paymaster + session-issuer changes also require timelock.
- **Multi-passkey enrollment as normal onboarding** — "Add a backup so you don't lose your agent account" is the second step after account creation, not buried in advanced settings (Coinbase Smart Wallet doctrine).
- **Permission UX as security** — no caveat-free production delegation; every caveat has human-readable copy; permission cards show who / what / where / when / how much / how often / how to revoke.

The 6c.1 primitives (`QuorumEnforcer`, `ApprovedHashRegistry`, `MultiSendCallOnly`) are the on-chain building blocks; this spec defines **how** they compose into a product surface that an operator can reason about.

---

## 2. Audit finding N16 (new — to be added to `docs/architecture/product-readiness-audit.md`)

| ID | Severity | Finding | Owner | Remediation |
| --- | --- | --- | --- | --- |
| **N16** | P2 | **Smart-account safety + recovery policy is not productized.** `AgentAccount` supports multiple owners/passkeys at the contract layer, but the product does not define threshold requirements for recovery, upgrades, owner changes, high-risk delegation grants, or `DelegationManager` changes. Any single owner currently authorizes any action; no human-readable permission UX exists for high-risk grants. | `agent-account` + `delegation` + `tool-policy` (integrated, no new package per the integration-not-bolt-on doctrine) | Land spec 207; productize signer kind × role model + account modes + threshold classes + guarded admin actions + permission-UX requirements; ship with at least one backup signer required for the hybrid+ modes before any production deploy. Tests required before production listed in § 9 below. |

---

## 3. Signers — two dimensions: kind × role

The signer model is **two-dimensional**, not a flat list. Every signer has both:

- a **kind** — the key shape + verification path
- a **role** — the authority class on this account (what they're allowed to authorize)

This separation is the critical insight from the product-lessons survey (Safe / MetaMask / Coinbase / ZeroDev). A "guardian" isn't a *different kind of key* — it's an EOA or passkey (or other account) playing a different *role*. A "session" isn't a kind of key — it's an authority role with delegated, temporary power.

### Signer kinds (how the verification works)

| Kind | Key shape | Verification path |
| --- | --- | --- |
| **EOA** | secp256k1 | ECDSA / eth_sign / EIP-191 (`SignatureSlotRecovery` v ∈ {27, 28, > 30}) |
| **Passkey** | P-256 WebAuthn | On-chain `_verifyWebAuthn` for routine; pre-approved-hash registry (v = 1) for joining quorums it can't natively prove |
| **Smart account** | ERC-1271 caller | `IERC1271.isValidSignature` (`SignatureSlotRecovery` v = 0) — covers another `AgentAccount`, a Safe (interop), or any other ERC-1271 wallet |
| **Hardware wallet** | secp256k1 (Ledger, etc.) | ECDSA via the EOA path — kind is informational only at the contract layer, but the SDK / UI distinguishes for UX |

Keeping kinds as a *non-exhaustive* set: future kinds (RIP-7212 P-256 precompile, FIDO L3 attested keys, etc.) plug in via the `SignatureSlotRecovery` library without changing the role surface.

### Authority roles (what they're allowed to authorize)

| Role | Removable? | Authorizes |
| --- | --- | --- |
| **Primary** | Yes, by threshold | Routine delegation issuance, T1–T3 actions, account admin (with quorum). The default role. |
| **Recovery (guardian)** | Yes, by threshold | T6 recovery quorum only. Cannot participate in routine signing or delegation issuance. |
| **Agent (session)** | Auto-expires | Off-chain agent operations under a redelegated session keypair. Not stored as a signer on-chain — represented as the delegate of a `Delegation`. Listed here for completeness because the user sees it as "an authority that can act," even though the contract layer treats it as a delegation grant. |
| **Steward** | Yes, by threshold | A primary-role signer with explicit cross-delegation rights. Stewards can re-delegate narrower scopes to agents but cannot widen scope (attenuation invariant). Use case 4 below. |

**Why this two-dimensional model matters:**

- A user can have one EOA in **primary** role + the same EOA's mobile-passkey-paired contract account in **recovery** role. The kind is reused; the role differs.
- A "guardian" with the kind = smart account is a *vouching* guardian (their own multi-sig blesses recovery), which is exactly the "another AgentAccount as guardian" pattern referenced in spec 207 § 11 open questions.
- The SDK exposes `addSigner({ kind, role, address })` rather than separate `addOwner` / `addGuardian` calls, which makes the role explicit and prevents the "I accidentally added them to the wrong set" footgun.

Contract layer: today `agent-account` keeps separate mappings (`_owners` for primary EOAs, `_passkeys` for primary passkeys, `_guardians` for recovery). That's fine — the role is encoded by which mapping the signer lives in. The two-dimensional model is the **user-facing concept**, not necessarily the storage layout.

---

## 4. Account modes

Four canonical modes the user picks during account creation. Each mode pins specific defaults for the § 5 threshold table.

| Mode | Primary signers | Guardians | Default behavior | UX framing |
| --- | --- | --- | --- | --- |
| **`single`** | 1 EOA *or* 1 passkey | 0 | 1-of-1 across all tiers. **Demo-only.** Disqualifying for any production deploy. | "Just me on this device." |
| **`hybrid`** ★ | 1 primary + ≥ 1 backup (different kind preferred) | 0–N | Routine: 1-of-N. Admin / recovery: threshold. Coinbase-style — multi-passkey enrollment is **normal onboarding**, not "advanced security." | "Me + my backup devices." |
| **`threshold`** | ≥ 2 primary | ≥ 0 | n-of-m for routine; m-of-m (or m-1-of-m) for admin; recovery via guardians. Replaces what we used to call "multisig." | "Multiple approvers required." |
| **`org`** | ≥ 2 primary | ≥ 2 | `threshold` plus mandatory timelocks on every T4/T5 admin action, plus separation of duties on T5 (no signer participates in both propose and execute). Replaces what we used to call "enterprise." | "Treasury / organization account." |

★ **`hybrid` is the default consumer mode.** The frontend's account-creation flow defaults to `hybrid` and prompts the user to *"add a backup passkey"* as the immediate next step after account deploy. `single` is intentionally available only as a development / demo affordance, and the UI labels it as such (e.g. "Demo mode — single signer"). This default matches the MetaMask Hybrid + delegation-toolkit shape that the platform's current substrate is closest to (see § 4.3 below) and gets every consumer to a recoverable account without optional steps.

**Mode-naming doctrine** (per the safety + recovery framing): the user-facing labels are `Just me` / `Me + backups` / `Multiple approvers` / `Organization`. Contract / SDK identifiers stay `single` / `hybrid` / `threshold` / `org` so dev-facing log lines + docs use a consistent vocabulary that maps cleanly to the UX.

**One substrate, explicit policy modes** (load-bearing design move): there is exactly one `AgentAccount` contract. Account mode is a packed state field (`_modeFlags` in the threshold-policy storage) — not separate contract types, not separate factories, not separate inheritance branches. The same substrate runs in `single` / `hybrid` / `threshold` / `org`; what changes is the policy that gates actions. New contract files claiming to be "for the multi-sig mode" are a red flag and violate the integration-not-bolt-on doctrine.

Mode is **set at deploy time** in the factory's `createAccount*` calls and emitted in the `AccountCreated` event. Mode changes require a § 7 admin flow.

---

## 4.1 The five use cases (every design must support these)

A spec, contract change, SDK method, or UX flow that doesn't fit at least one of these is suspect. Listed here so future contributors can sanity-check additions.

1. **Individual user, seamless recovery** — User creates an account with one passkey. The next step in onboarding is *"add a backup passkey or recovery wallet."* Adding a backup flips mode from `single` to `hybrid`. Low-risk actions stay 1-of-N; admin and recovery actions become threshold. **UX copy: "Add a backup so you don't lose your agent account."**

2. **High-risk agent delegation** — User delegates "transfer up to 10 USDC/day to approved vendors" to an agent. Because it's T3 value, it requires (a) human-readable permission card showing token + cap + recipient allowlist + expiry + revoke link, (b) threshold approval at issue time, and (c) `acceptSessionDelegation(hash)` on-chain blessing. **UX copy: "This permission needs 2 approvals because it can move money."**

3. **Org treasury** — Org creates an `org`-mode account with 3 admins. Threshold: 2-of-3 for treasury actions; 3-of-3 for trust-root changes. Agent can *draft* payments (propose) but cannot execute without threshold approval. Low-risk profile reads stay 1-of-N. **UX copy: "Agent prepared payment. Needs 2 approvals."**

4. **Steward → delegate → agent chain** — User grants a steward primary role with profile-read + limited-write authority. Steward re-delegates a *narrower* scope to an agent. System proves the child delegation is a subset of the parent (attenuation). Agent cannot widen scope. **UX copy: "Steward can delegate only these permissions. Agent received a narrower permission."**

5. **Lost device recovery** — User loses laptop passkey. Signs in with phone passkey. Initiates `T6 Recovery` proposing removal of the lost passkey + (optional) addition of a new one. Recovery requires guardian quorum and runs through the 48h timelock. **UX copy: "Recovery requested. This change becomes active in 24 hours unless cancelled."**

These five drive every test gate in § 9 and every UX surface in phase 7.

---

## 4.2 ERC-7579-shaped mapping to our packages

Per Rhinestone's modular-account model (validators / executors / hooks / fallbacks), our existing package boundaries already map cleanly:

| ERC-7579 module type | Our package | Owns |
| --- | --- | --- |
| **Validators** (who can approve) | `identity-auth` + on-chain signer state in `agent-account` | `Signer` interface, ERC-1271 verification, owner / passkey / guardian state |
| **Executors** (what can act) | `delegation` | `Delegation`, sessions, caveat builders, redelegation chain |
| **Hooks** (pre / post checks) | `tool-policy` + the caveat enforcer contracts in `apps/contracts/src/enforcers/` | Risk tiers, classification, `evaluatePolicy`, `beforeHook` / `afterHook` |
| **Runtime adapters** | `mcp-runtime` (today); future `a2a-runtime` etc. | Wraps the validator → executor → hook pipeline behind a transport-specific surface |

This validates the existing package-boundary doctrine. Spec 207 doesn't change any boundary; it deepens the integration along this already-correct architecture.

---

## 4.3 Where we are vs. where we go

The current substrate is closest to "MetaMask Hybrid + Delegation Toolkit." Spec 207 is the bridge from "we support EOA / passkey" to "we have a production smart-account security model." This table maps platform capabilities to MetaMask's published account-mode taxonomy + Safe-style features so reviewers can locate gaps:

| MetaMask / Safe concept | Our design equivalent | Status today | Gap closed by spec 207 § |
| --- | --- | --- | --- |
| Hybrid account (EOA + passkeys) | `AgentAccount` with `_owners` + `_passkeys` + `_validateSig` dispatch | Mostly present | § 4 default `hybrid` mode + § 8 multi-passkey recovery |
| Multisig account (M-of-N + threshold) | `_owners` set + (new) `_thresholdPolicyStorage` + `proposeAdmin` machinery | Substrate present, policy not productized | § 5 + § 7 + § 10 |
| Safe Guards (pre/post checks) | `tool-policy.evaluatePolicy` + `ICaveatEnforcer.beforeHook/afterHook` | Present (T1 read enforcers shipped) | § 5 + spec 208 (argument-level caveats) |
| Safe Modules (scoped execution paths) | Sessions + redelegation in `delegation` | Present (single-tier) | § 6 high-risk gate + § 5.1 threshold matrix |
| Delegation Toolkit | `@agenticprimitives/delegation` + `DelegationManager.sol` | Present | DTK alignment audit pass (task #89) |
| Caveat enforcers | `apps/contracts/src/enforcers/*` + caveat builders in `delegation` | Present, needs parameter-level parity | Spec 208 |
| Advanced Permissions / permission cards | demo-web consent / authorize flow | Early | § 1 bullet "Permission UX as security" + phase 7 UI |
| Paymaster / verifying paymaster | `SmartAgentPaymaster.sol` verifying mode | Present | (closed by pass 4 / audit C2) |
| Account recovery (multi-passkey + guardian) | passkey + guardian + timelock + cancel | **Missing** | § 8 |
| Action-specific thresholds | `_thresholdPolicyStorage.thresholdByTier` | **Missing** | § 5 / § 5.1 |
| Pending-approval flow + UX | `proposeAdmin` / `executeAdmin` / `cancelAdmin` | **Missing** | § 7 + phase 7 admin panel |
| High-risk delegation gating | `acceptSessionDelegation` hook | Hook present; not gated by tier | § 6 |

The "**Missing**" rows are the load-bearing additions in spec 207. Nothing in the table requires forking the `AgentAccount` substrate; everything is additive policy + state on the same contract.

---

## 5. Risk-tier thresholds (the load-bearing table)

This is the spec's headline contribution: actions are not gated by a single global threshold; they are partitioned by **risk tier**, and each tier has its own threshold requirement. The tiers below are the canonical set; new actions added later MUST map to one of them or motivate a new tier.

| Action | Tier | Requirement (single) | Requirement (hybrid) | Requirement (threshold) | Requirement (org) |
| --- | --- | --- | --- | --- | --- |
| Read-only MCP delegation issuance | T1 — Read | 1 signer | 1 signer | 1 signer | 1 signer |
| Write / deploy session delegation | T2 — Write | 1 signer | 1 EOA **+** passkey UV | threshold | threshold + UV |
| Token / value transfer delegation | T3 — Value | 1 signer | 1 EOA + passkey UV | threshold | threshold + UV |
| Add / remove owner | T4 — Admin | 1 signer | 1 EOA + passkey UV | threshold | threshold + timelock |
| Add / remove passkey | T4 — Admin | 1 signer | 1 EOA + passkey UV | threshold | threshold + timelock |
| Add / remove guardian | T4 — Admin | 1 signer | 1 EOA + passkey UV | threshold | threshold + timelock |
| Change account mode | T4 — Admin | 1 signer | n/a (must be threshold+) | threshold | threshold + timelock |
| Upgrade account implementation | T5 — Critical | 1 signer | 1 EOA + passkey UV | threshold + timelock | threshold + timelock + separation |
| Change DelegationManager | T5 — Critical | 1 signer | 1 EOA + passkey UV | threshold + timelock | threshold + timelock + separation |
| Change paymaster / session-issuer role | T5 — Critical | 1 signer | 1 EOA + passkey UV | threshold + timelock | threshold + timelock + separation |
| Recover account (re-establish signer set) | T6 — Recovery | 1 signer | 1 passkey OR EOA + guardian | recovery threshold | recovery threshold + separation |

**Tier definitions:**

- **T1 Read** — Delegations whose redeem can ONLY produce information disclosure or off-chain effects. No on-chain state mutation. No value transfer. Caveats MUST pin the target contract to known read-only surfaces (use `AllowedTargetsEnforcer` + `AllowedMethodsEnforcer` to restrict to view-shaped selectors).
- **T2 Write** — Delegations that mutate on-chain state but transfer no native value or token > `T3_VALUE_CEILING`. Default ceiling: 0.001 ETH equivalent.
- **T3 Value** — Delegations that transfer native ETH or tokens above the T3 ceiling. The QuorumEnforcer caveat is **required** for the threshold/org modes.
- **T4 Admin** — Owner/passkey/guardian/mode changes on the account. Mutates the trust root.
- **T5 Critical** — Mutates platform-level pointers (impl, DelegationManager, paymaster). Effectively a re-architecture of trust.
- **T6 Recovery** — Re-establishes the signer set when the user has lost primary keys.

**"threshold"** in the table means: `signatures count >= account.threshold(tier)`. Each tier has its own threshold getter so e.g. T3 can require 2-of-3 while T5 requires 3-of-3.

**"+ UV"** means: at least one passkey signature with the `UV` (user-verification) flag set. Biometric gate on the device.

**"+ timelock"** means: the action's intent must be queued on-chain via `propose<Action>(...)` and execute only after `block.timestamp >= proposal.eta`. ETA = `block.timestamp + TIMELOCK_DURATION(tier)`. Default durations: **1h for T4, 24h for T5, 48h for T6 Recovery**. (T6's 48h covers a weekend without dragging; the primary-owner cancel window is the first 24h of that — see § 8.) All durations are per-account configurable via a T5 admin flow.

**"+ separation"** means: the signer set that participated in `propose` MUST NOT overlap (by `>= threshold(tier)`) with the signer set that participates in `execute`. Enforces "two-person rule" semantics.

### 5.1 Default threshold matrix

When a `threshold` account is created with N owners, the factory installs these per-tier thresholds by default. Users can override via the factory's `createAccount*` parameters or post-deploy via a T5 `SetThreshold` admin action.

| N owners | T1 Read | T2 Write | T3 Value | T4 Admin | T5 Critical | T6 Recovery |
| --- | --- | --- | --- | --- | --- | --- |
| 2 | 1 | 2 | 2 | 2 | 2 | majority of guardians |
| 3 | 1 | 2 | 2 | 3 | 3 | majority of guardians |
| 5 | 1 | 3 | 3 | 4 | 5 | majority of guardians |
| 7 | 1 | 4 | 4 | 5 | 6 | majority of guardians |

**Doctrine:** routine = majority of owners; trust-root mutations (T4/T5) = unanimous or near-unanimous; recovery = majority of *guardians* (separate set from owners). The asymmetry is the point — a single offline owner can't brick an account, but no single owner can unilaterally rotate the signer set or upgrade the impl.

For N=2, the factory issues a warning at deploy time: "2-of-2 means either signer can deadlock the account; recommended minimum is 3 owners." Demo-web's account-creation flow nudges N=3 unless the user explicitly opts for N=2.

For N >= 5, factory issues a warning: "large signer sets risk coordination failure; consider whether a guardian set is a better fit for some signers."

`org` mode adds **separation of duties** on T5: any owner who participated in `propose<T5>` is disqualified from participating in `execute<T5>`. This means N=5 `org` effectively requires a *6th distinct signer* to execute a propose-quorum-of-5 — impossible by construction. So `org` mode requires either N ≥ 7 (so 5 propose + 5 execute can be disjoint at the threshold level) OR a relaxed T5 threshold that allows for the SoD constraint. Factory rejects `org` deploys that can't satisfy the math.

---

## 6. High-risk delegation approval

Builds on the existing `acceptSessionDelegation(hash)` hook on `AgentAccount` (see `apps/contracts/src/AgentAccount.sol`). That function already serves as a "this delegation hash has been blessed on-chain" signal; we extend the off-chain delegation verifier to check it conditionally based on tier:

| Tier | Off-chain delegation signature alone? | On-chain `acceptSessionDelegation` required? |
| --- | --- | --- |
| T1 Read | ✅ | ❌ |
| T2 Write | ✅ for `single`/`hybrid`; quorum sig for `threshold`/`org` | ❌ |
| T3 Value | quorum sig | ❌ for routine; ✅ when above `T3_HIGHVALUE_THRESHOLD` |
| T4–T6 | quorum sig | ✅ (timelock+propose flow) |

For T3 high-value grants, the redeem path checks `account.isAcceptedSessionDelegation(hash)` and fails closed if false. The existing `verifyDelegationToken` accept event (audit C3, closed in pass 5b) gets a new `acceptedOnChain: boolean` context field so the audit trail records whether the redeem leaned on the on-chain blessing.

`T3_HIGHVALUE_THRESHOLD` is a per-account configurable bound, defaulting to **0.01 ETH** equivalent (set at account creation, mutable via the T4 `ChangeT3Ceiling` admin flow in § 7). The low default is deliberate: it makes the high-value on-chain blessing gate observable in demo + early-production usage so the path is exercised before a real-value account hits it.

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
    ChangeSessionIssuer,
    // Operational tuning + atomic-rotation actions:
    RotateAllOwners,        // T4 — atomic "replace entire owner set" so a
                            // post-incident rotation doesn't pass through
                            // fragmented intermediate states (owner partially
                            // added, partially removed) where authority is
                            // ambiguous. Args: (address[] newOwners).
    ChangeT3Ceiling,        // T4 — tune T3_HIGHVALUE_THRESHOLD without a
                            // full impl upgrade. Args: (uint256 newCeilingWei).
    SetRecoveryThreshold    // T4 — explicit recovery-threshold setter so
                            // guardian-set churn doesn't leave a stale
                            // implicit threshold. Args: (uint8 newThreshold).
}
```

`proposeAdmin(AdminAction action, bytes args, bytes quorumSignatures)`:
- Verifies `quorumSignatures` via the same `QuorumEnforcer.beforeHook` machinery used for delegations.
- Records `pendingAdmin[proposalId] = AdminProposal({action, args, eta: now + TIMELOCK_DURATION(tier), proposer: msg.sender})`.
- Emits `AdminProposed(proposalId, action, eta)`.

`executeAdmin(uint256 proposalId, bytes quorumSignatures)`:
- Loads the proposal, requires `block.timestamp >= proposal.eta`.
- In **org** mode: rejects if the executing signer set overlaps the proposing signer set by `>= threshold(tier) - 1` (separation of duties).
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
5. After `TIMELOCK_DURATION(T6_RECOVERY)` (default: **48h**), calls `executeRecovery(proposalId, recoverySignatures)`.
6. The first **24h** of the 48h window is the primary-owner **cancel window**: any surviving primary signer can call `cancelAdmin(proposalId, sig)` with a single T4-threshold signature to kill a hostile recovery. After the 24h window closes, recovery can only be cancelled by another recovery-threshold quorum. Rationale: 24h gives the rightful owner one full waking day to react to a notification; the remaining 24h is the "no one objected" window that lets recovery proceed even if the rightful owner is on vacation (different threat model from active compromise).

**Recovery threshold** is configured at account-creation time, defaulting to `ceil(guardianCount / 2) + 1` (majority + 1). If the account has 0 guardians, recovery is impossible — by design, since key-loss is unrecoverable without external trust. The factory's `createAccount` MUST refuse to deploy a `threshold`/`org` account with 0 guardians.

**Recommended guardian count: 5.** That's the sweet spot: a 5-guardian account loses 1 or 2 guardians (to forgetfulness, key loss, life events) and still passes a 3-of-5 recovery threshold. 3 guardians is the practical minimum (passes 2-of-3) but leaves zero slack. >7 starts to make coordination cumbersome. Frontend SHOULD nudge users toward 5 during account setup; spec only enforces minima (see table below).

**Two-passkey-minimum requirement for production:**

| Mode | Minimum config for production |
| --- | --- |
| `single` | Disallowed for production |
| `hybrid` | ≥ 2 passkeys OR 1 passkey + 1 recovery-EOA guardian |
| `threshold` | ≥ 2 guardians required at account creation |
| `org` | ≥ 3 guardians required (so recovery threshold is ≥ 2) |

The factory enforces these minima for any account whose `mode != single`. The frontend (demo-web) MUST warn the user before they deploy a `single` account.

---

## 9. Tests required before production

This section is the **launch gate** for any account mode beyond `single`. Production deploys MUST verify each row:

| # | Test | What it proves |
| --- | --- | --- |
| 1 | T1 read delegation in `threshold` mode with 1 signer succeeds | Tier mapping correctly bypasses quorum on read-only |
| 2 | T2 write delegation in `hybrid` mode without UV fails closed | Hybrid mode's UV gate is load-bearing |
| 3 | T3 value delegation above `T3_HIGHVALUE_THRESHOLD` without `acceptSessionDelegation` fails closed | High-value on-chain blessing is enforced |
| 4 | T4 `AddOwner` in `threshold` mode with sub-threshold sigs fails closed | Quorum verification on admin path |
| 5 | T5 `UpgradeImpl` in `threshold` mode without timelock fails closed | Timelock is enforced |
| 6 | T5 `UpgradeImpl` in `org` mode with overlapping propose/execute signers fails closed | Separation of duties is enforced |
| 7 | T6 recovery with 3-of-5 guardians + 48h timelock succeeds | Recovery happy path |
| 8 | T6 recovery cancelled by primary owner within the 24h cancel window reverts the execute | Hostile-recovery escape hatch (cancel window enforced) |
| 9 | Recovery with 0 guardians is impossible (factory rejects deploy of `threshold`/`org`) | No-recovery footgun blocked |
| 10 | `acceptSessionDelegation` emits an audit event recording the on-chain blessing | Trail captures the high-value gate |
| 11 | All admin actions emit `AdminProposed` / `AdminExecuted` / `AdminCancelled` events | Forensics trail for trust-root mutations |
| 12 | QuorumEnforcer caveat composes correctly with TimestampEnforcer + ValueEnforcer on T3 delegations | Caveat stacking is not broken by quorum requirement |
| 13 | T6 recovery proposal during a pending T5 admin proposal — recovery executes; the T5 proposal is implicitly invalidated | Precedence: recovery wins over in-flight trust-root changes |
| 14 | Mode change from `threshold` → `single` with non-empty guardian set is rejected | No downgrading to a mode that loses recovery |
| 15 | `QuorumEnforcer` caveat with `threshold=1` and a 1-address signer set behaves identically to a non-quorum delegation | Validates the doctrine "threshold=1 IS the trivial case" — no separate code path |

Each row maps to a Forge test (T1–T11, T13–T15) or a Playwright e2e (T12 via demo flow). System-level testing strategy in `specs/110-test-strategy.md` updated to include this section.

---

## 10. Package surface changes

The "integration, not bolt-on" doctrine maps the surface across existing packages by ownership. **No new package is created** — the on-chain primitives shipped in 6c.1 (`QuorumEnforcer`, `ApprovedHashRegistry`, `MultiSendCallOnly`) plug into the current package set:

| Package | Concept it owns | What lands here |
| --- | --- | --- |
| `agent-account` | Multi-owner state, mode, thresholds, admin actions, recovery, owner-signature aggregation | `_guardians` mapping, `_modeFlags`, `threshold(tier)` + `recoveryThreshold()` getters, propose / execute / cancel admin machinery, `AdminAction` enum (incl. `RotateAllOwners` / `ChangeT3Ceiling` / `SetRecoveryThreshold`), recovery flow. SDK: `AgentAccountClient` gains `proposeAdmin` / `executeAdmin` / `cancelAdmin` / `initiateRecovery` / `executeRecovery` / `preApproveHash(hash)`. Also **`packSafeSignatures(parts)`** — the Safe-compatible 65-byte-slot blob packer lives here because owners' signatures are aggregated by the account-side SDK, not the delegation builder. |
| `delegation` | Signer-set + quorum-aware delegations and caveats | `Delegation` shape stays as-is (signer set is implicit in the caveats it carries). `buildQuorumCaveat({signers, threshold, approvedHashRegistry})` joins the existing caveat-builder peers (`buildCaveat`, `buildMcpToolScopeCaveat`, `buildDelegateBindingCaveat`, `buildDataScopeCaveat`). `verifyDelegationToken` gains an optional `requireQuorumForTier(tier)` opt (fail-closed when a tier requires quorum but the delegation lacks the caveat). |
| `tool-policy` | Risk-tier taxonomy + policy decision | Risk-tier constants (`TIER_READ` ... `TIER_RECOVERY`) become first-class exports. `evaluatePolicy(classification)` returns a `{ tier, requiresQuorum, requiresUv, requiresAcceptedOnChain }` decision that the caller composes with `delegation.verifyDelegationToken`. The existing `@sa-risk-tier` classification metadata gains the tier IDs from this spec. |
| `identity-auth` | (unchanged) | The `Signer` interface stays signer-shape-agnostic. Multi-sig is below this layer — `identity-auth` doesn't know whether the eventual signer set is 1-of-1 or 3-of-5. |
| `mcp-runtime` | (effectively unchanged) | `withDelegation` already calls `verifyDelegationToken`. It transparently handles n-of-m once `delegation` does. The only addition: the `tool-policy` decision (`requiresQuorum`, etc.) is threaded into the verify call. |
| `audit` | (unchanged interface; new emitter actions) | Spec 206 vocabulary table grows: `agent-account.admin.{propose,execute,cancel}`, `agent-account.recovery.{propose,execute,cancel}`, `delegation.quorum.{accept,reject}`. |
| `apps/contracts` | On-chain primitives | Already-shipped: `QuorumEnforcer`, `ApprovedHashRegistry`, `MultiSendCallOnly`. New: `AgentAccount` extended in place (no new contract); `AgentAccountFactory.createAccount*` signatures grow to take `mode + initial signers + initial guardians + thresholds`. |

### Phase 6c.2 — AgentAccount extension (Solidity)

- Extend `AgentAccount.sol` (in place — no new contract):
  - `_guardians` mapping + `_modeFlags` packed field (mode + per-tier thresholds).
  - `propose<AdminAction>` / `execute<AdminAction>` / `cancel<AdminAction>` machinery dispatching on the `AdminAction` enum from § 7.
  - `threshold(uint8 tier)` + `recoveryThreshold()` getters.
  - Reuse existing `_owners` mapping (already multi-capable); add `_passkeys` partition tracking if not yet split out from owners.
- Extend `AgentAccountFactory.sol`: `createAccount` / `createAccountWithPasskey` signatures grow to take an initial mode + signer set + guardian set + threshold vector. Refuse to deploy `threshold` / `org` mode with 0 guardians.
- Forge tests: rows 1, 4, 5, 6 from § 9 land here. T11 (admin event emission) verified in this pass.

### Phase 6c.3 — Delegation + tool-policy integration (TypeScript)

- `@agenticprimitives/tool-policy`: export `Tier` enum + `RISK_TIER_REQUIREMENTS` map. `evaluatePolicy(classification)` returns `{ tier, requiresQuorum, requiresUv, requiresAcceptedOnChain }`. Tier resolution from existing `@sa-risk-tier` classification metadata.
- `@agenticprimitives/delegation`:
  - New caveat builder: `buildQuorumCaveat({signers, threshold, approvedHashRegistry})`.
  - `verifyDelegationToken`: accept `requireQuorumForTier(tier)` opt. When the tool-policy decision says a tier requires quorum, verify checks the delegation carries a `QuorumEnforcer` caveat; otherwise fail closed.
  - Audit C3 emission gets a new `acceptedOnChain` context field on accept rows (for T3+ delegations that needed the on-chain `acceptSessionDelegation` blessing).
- `@agenticprimitives/agent-account` SDK: `AgentAccountClient` gains `proposeAdmin` / `executeAdmin` / `cancelAdmin` / `initiateRecovery` / `executeRecovery` + `preApproveHash(hash)` + **`packSafeSignatures(parts)`** (the Safe-compatible 65-byte-slot blob packer — moved here from `delegation` because owners' signatures are aggregated by the account-side SDK).
- Per-package `CLAUDE.md` + `AUDIT.md` updates documenting the new exports + the integration story.

### Phase 6c.4 — mcp-runtime integration (TypeScript)

- `@agenticprimitives/mcp-runtime`: `withDelegation` reads `tool-policy.evaluatePolicy(classification)` (already calls this for the H2 fix), threads the result's `requiresQuorum` / `requiresAcceptedOnChain` into the `verifyDelegationToken` opts. No new public exports — the wrapper transparently enforces tier requirements.
- Audit spec 206 vocabulary table updated with the new action names.

### Phase 6c.5 — Forge tests + Playwright e2e

- 15 tests from § 9, files: `test/AgentAccountAdmin.t.sol`, `test/AgentAccountRecovery.t.sol`, `test/ThresholdPolicy.t.sol`, `test/OrgSeparation.t.sol` (T6 org SoD), `tests/e2e/06-threshold-delegation.spec.ts` (T12 — caveat composition end-to-end). Demo-web's admin + recovery panels are deferred to **phase 7**; the SDK + contract surface is the substrate, and cast / scripts can drive the actions during the 6c testing pass without an admin UI.

### Phase 6c.6 — audit doc refresh

- Add **N16** to `docs/architecture/product-readiness-audit.md` open findings. Mark it closed in the same pass that finishes 6c.5 (or earlier sub-phase, whichever fully productizes the multi-sig per § 9 launch gates).
- Per-package `AUDIT.md` refreshed in: `agent-account`, `delegation`, `tool-policy`, `mcp-runtime`, `audit`.

### Phase 7 — demo-web admin + recovery UI (deferred)

- Step 0: "Account mode" selector. Default to `threshold` for any account that adds >1 signer.
- Step 2: tier-aware delegation issuance — when `tool-policy.evaluatePolicy` says T3+, prompt n signers in sequence.
- Step 4: Account admin panel — propose/execute/cancel admin actions; show pending admin proposals with countdown to ETA.
- Step 5: Recovery flow — initiate, list guardians, collect approvals, execute.
- This phase MUST take a proper UX-designer pass (trust-critical screens — adding/removing owners, initiating recovery — are highest-stakes UI in the whole demo).

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
- **Account modes (single/hybrid/threshold/org) are original.** Smart-agent has a single AgentAccount shape; we adopt MetaMask's account-mode taxonomy because it maps cleanly onto user mental models.
- **Timelock semantics are original.** Smart-agent has no timelocked admin actions; we add them for T5/T6 because the threat models genuinely differ from routine signing.

---

## 13. Resolved decisions + open follow-ups

Resolved in v0 (2026-05-20):

- ✅ Signer model: kind × role two-dimensional (§ 3); session is an authority role, not a kind.
- ✅ Account modes: `single` / `hybrid` / `threshold` / `org` (§ 4). All four ship in v0; `org` is table-stakes per the org-treasury use case.
- ✅ Risk-tier table (§ 5) with T3_HIGHVALUE_THRESHOLD default 0.01 ETH and timelocks 1h T4 / 24h T5 / 48h T6.
- ✅ `acceptSessionDelegation` reused as the high-risk gate (§ 6).
- ✅ AdminAction enum (§ 7) — 14 actions including the operational `RotateAllOwners` / `ChangeT3Ceiling` / `SetRecoveryThreshold`.
- ✅ Recovery: 48h timelock + 24h primary-owner cancel window; recommended 5 guardians (§ 8).
- ✅ 15 launch-gate tests (§ 9).
- ✅ Integration map (§ 10): no new package; surface threads through `agent-account` / `delegation` / `tool-policy`.
- ✅ Phase 7 deferral of admin + recovery UI; SDK + contract surface ship in 6c.

Open follow-ups (tracked separately):

- **Spec 208 — argument-level caveat policies (Biconomy-style predicates).** Tool-policy's risk tiers + existing caveats are tool-level today. Argument-level — target, method, value ceiling, token, recipient allowlist, parameter predicates, usage count, chain ID, time bounds — is the future. Owned by `tool-policy`; should land before any production deploy with non-trivial agent authority because "Allow agent to call `get_profile`" is too vague for the human-readable permission card model.
- **Permission-UX spec (phase 7 prerequisite).** Define the human-readable card schema: who / what / where / when / how much / how often / how to revoke. Maps onto the caveat-builder output so SDK can render cards directly from the issued `Delegation`.
- **Cross-account guardian semantics.** Open question in § 11 — a guardian whose kind is "smart account" votes via ERC-1271 (v=0 path already supported by `SignatureSlotRecovery`). Demo doesn't exercise this in v0; document the pattern when a real consumer asks.
- **Threshold-class language mapping.** SDK + UI surface uses "daily threshold," "admin threshold," "high-risk delegation threshold," "recovery threshold" (per the safety+recovery doctrine memory); spec text keeps the T1–T6 tier IDs as the canonical names. The mapping doc is a phase 7 deliverable alongside the permission-UX spec.

---

## 14. Phase 6c.5-d — AdminModule split (deploy-size unblock) — **SUPERSEDED BY [SPEC 209](./209-erc7579-module-taxonomy.md)**

> **Read spec 209 first.** This section describes an earlier, less-correct plan that proposed a single `AgentAccountAdminModule` delegatecall blob. The user's architectural correction (this conversation, 2026-05-20) was that ERC-7579 module decomposition (validators / executors / hooks / fallbacks) is the right pattern — a single blob just shifts the size problem one layer and introduces storage-layout coupling that ERC-7579 module isolation eliminates by design. The trigger description below (EIP-170 ceiling overshoot) remains accurate; the proposed solution below does NOT. Preserved as the architect-of-record for *why* spec 209 exists.

**Discovered 2026-05-20 during phase 6c.5-c (live wiring):** the `AgentAccount`
implementation's runtime bytecode is **26,876 bytes** — 2,300 bytes over the
EIP-170 deploy ceiling (24,576). The bloat is concentrated in the propose /
execute / cancel surface added across 6c.2-b/c/e: the `AdminAction` dispatcher
(15 cases), per-action `_apply*` handlers, `_verifyQuorum` body,
`_adminPayloadHash`, and `_applyRecoverAccount`. Solidity compiler tuning
(`optimizer_runs = 1`, `via_ir = true`) only recovers 943 bytes — the surface
fundamentally doesn't fit in one EIP-170-compliant contract.

This section pins the unblock design. It is a follow-on to spec 207 v0, not a
re-design — the on-chain ABI, storage layout, and threat model are preserved.

### 14.1 Approach

**Split `AgentAccount` into two contracts:**

- **`AgentAccount`** (the proxy implementation, still ~16-18KB): all
  EIP-4337 surface, owners + passkeys + sessions storage, signature
  validation (ERC-1271 + 6492), execute / executeBatch, modules surface,
  upgrade surface, all view functions exposed by the admin surface
  (`mode()`, `threshold(tier)`, `recoveryThreshold()`, `guardianCount()`,
  `proposalCount()`, `getPendingAdmin(id)`, `isGuardian(addr)`,
  `approvedHashRegistry()`).
- **`AgentAccountAdminModule`** (new singleton, ~10-12KB): the
  state-mutating admin path — `proposeAdmin` / `executeAdmin` /
  `cancelAdmin` bodies + the 13 `_apply*` action handlers +
  `_verifyQuorum` + `_adminPayloadHash` + `_applyRecoverAccount`.

**`AgentAccount`'s 3 external admin functions become delegatecall forwarders.**
The function selectors + arg shapes + return shapes are unchanged — the body
becomes a one-liner that `delegatecall`s into the module. Storage writes from
the module land on the account's storage because that's how `delegatecall`
works. The module contract itself never holds account state.

### 14.2 Storage invariant

`ThresholdPolicyStorage` (ERC-7201 namespaced at slot
`0x9bf0...6f00`) is **shared between** `AgentAccount` and `AgentAccountAdminModule`.
Both contracts declare the struct + the slot constant + the
`_thresholdPolicyStorage()` accessor; **the layout MUST be byte-identical**
or delegatecall reads/writes will corrupt state. Same applies to the
non-namespaced storage the admin path touches: `_owners`, `_ownerCount`,
`_modulesStorage`, `_passkeyStorage`. Phase 6c.5-d adds a single Forge
invariant test (`AdminModuleStorageLayout.t.sol`) that pins the slot
positions of every field touched by the module + fails if `AgentAccount`'s
shape drifts.

### 14.3 Trust binding

`AgentAccount` adds a single immutable: `address public immutable adminModule`.
Set in the constructor; the factory deploys the module first, then passes
its address into the `AgentAccount` constructor. The module address cannot
change without an `UpgradeImpl` admin action (which re-deploys the whole
impl). Per-account rotation of the module is out of scope for v0 — same
substrate doctrine as the rest of spec 207.

### 14.4 Forwarder shape

```solidity
function proposeAdmin(AdminAction action, bytes calldata args, bytes calldata sigs)
    external returns (uint256 proposalId)
{
    (bool ok, bytes memory ret) = adminModule.delegatecall(msg.data);
    if (!ok) {
        assembly { revert(add(ret, 32), mload(ret)) }
    }
    return abi.decode(ret, (uint256));
}
```

`executeAdmin` + `cancelAdmin` follow the same shape. `msg.data` forwarding
preserves arg layout exactly; the bubbled revert preserves the original
error selector so external callers see the same error shape as before the
split.

### 14.5 What the module does NOT have

- **No constructor args.** The module is a code-only contract; it reads no
  storage that's not delegate-called into.
- **No `selfdestruct`.** Phase 6c.5-d adds a Forge static check.
- **No external state.** No mappings, no slots, no fallback. Code only.
- **No `address(this)` semantics.** Inside delegatecall, `address(this)` is
  the account, never the module — the module's code MUST NOT branch on
  `address(this) == <module-address>` or read any module-side state.

### 14.6 Live-deploy sequence (phase 6c.5-c resumes after 6c.5-d lands)

1. `forge create AgentAccountAdminModule` (deployer EOA, single tx)
2. `forge create AgentAccountFactory(EP, DM, deployer, deployer, deployer,
   adminModuleAddr)` — factory constructor signature gets a 6th arg.
   Factory deploys new `AgentAccount` impl as a side-effect, passing
   `adminModuleAddr` into the AgentAccount constructor.
3. Merge `agentAccountAdminModule` + new `agentAccountFactory` +
   `agentAccountImplementation` addresses into
   `deployments-base-sepolia.json`.
4. `pnpm deploy:cloudflare` → workers + demo-web-pro pick up new addresses.

The 2 enforcers already on-chain from phase 6c.5-c (QuorumEnforcer +
ApprovedHashRegistry) stay — they're independent of the AdminModule split.

### 14.7 Test posture for the split

181 existing Forge tests MUST still pass without modification — the
external ABI is unchanged. Tests that subclass `AgentAccount` to seed
internal state (`TestAgentAccount`) keep working because the
`_thresholdPolicyStorage()` accessor stays `internal` in both contracts.

New tests:

- `AdminModuleStorageLayout.t.sol` — invariant: every field touched by the
  module has the same `keccak`-derived slot in `AgentAccount` and in
  `AgentAccountAdminModule`.
- `AdminModuleDelegatecall.t.sol` — three rows: each forwarder selector
  delegates into the module + the module's revert selectors bubble
  identically + the module address is the impl's `adminModule()` view.
- `AdminModuleStateless.t.sol` — fuzz: the module's storage layout is
  empty (no slots written when called as a top-level contract).

### 14.8 Size targets

Post-split, expected sizes (10% slack vs EIP-170 ceiling):

| Contract | Target | Headroom vs 24,576 |
| --- | --- | --- |
| `AgentAccount` | ≤ 22,000 | ≥ 2,576 |
| `AgentAccountAdminModule` | ≤ 14,000 | ≥ 10,576 |
| `AgentAccountFactory` | ≤ 6,000 (no change from current) | ≥ 18,576 |

If the post-split `AgentAccount` is still over 22KB, the next lever is
moving `addPasskey` / `removePasskey` / `setUpgradeTimelock` / module
install/uninstall onto the AdminModule too (currently
`onlySelf`-gated; the threat model is compatible with a delegatecall
forwarder). Document that as 6c.5-d.alt if needed.
