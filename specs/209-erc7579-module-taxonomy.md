# Spec 209 — ERC-7579 module taxonomy for AgentAccount

> **Vocabulary note (phase 6g.1 / spec 213):** the first module extraction was originally named `ThresholdValidator`. Phase 6g.1 renamed it to `CustodyPolicy` to align with the custody / agency vocabulary firewall (spec 212 § 2.2 + spec 213). All references here use the new name; `(was ThresholdValidator)` is annotated where helpful for one cycle.

**Status:** drafted 2026-05-20 · supersedes spec 207 § 14

> **Implementation status (2026-05-25) — plan vs shipped (audit AUD-03).** This
> spec is the architectural *plan*; the contracts have diverged and this records
> reality so the catalog below isn't read as "all shipped":
> - **Shipped:** d.0 `executeFromModule` + d.1 `CustodyPolicy` (the EIP-170
>   unblock). These are live.
> - **`GuardianRecoveryValidator` (d.2) was NOT extracted** — guardian/trustee
>   recovery is the **T6 `RecoverAccount` path inside `CustodyPolicy`**, not a
>   separate validator. The §2.2 / §4 / §7 rows naming it describe a plan that
>   was consciously folded into `CustodyPolicy`. If that's permanent (it is, for
>   now), it warrants an ADR; treat the d.2 rows as "absorbed", not pending.
> - **Hooks (d.3) + executors (d.4) + `CaveatVerifierHook` (d.5) are NOT built.**
>   The only `Allowed*` / `Value*` contracts on disk are **delegation caveat
>   enforcers** (`apps/contracts/src/enforcers/*Enforcer.sol`) — a DIFFERENT
>   taxonomy from this spec's account-level **hooks** (`AllowedTargetsHook`,
>   etc.). Do not conflate `AllowedTargetsEnforcer` (caveat, redeem-time) with
>   the planned `AllowedTargetsHook` (account hook, execute-time).
**Closes:** the architectural problem revealed by phase 6c.5-c — `AgentAccount` runtime bytecode hit 26,876 bytes (2,300 over the EIP-170 ceiling) because optional / policy-heavy / risky surfaces were inlined into the core contract.
**Builds on:** spec 201 (`agent-account` core), spec 202 (`delegation`), spec 204 (`tool-policy`), spec 206 (`audit`), spec 207 (threshold-policy product surface). Does NOT build on spec 207 § 14's "AdminModule delegatecall blob" plan — that plan is superseded by this one.
**Reference: industry patterns to port:** ERC-7579 (modular smart account standard — module type IDs, install/uninstall hooks, the `onInstall` / `onUninstall` lifecycle), Safe's module/guard pattern (separately-deployed module contracts that call back into the Safe via `execTransactionFromModule`), Rhinestone's ModuleKit, Biconomy's V2 modular accounts. The existing `installModule` / `uninstallModule` / `isModuleInstalled` / `accountId` surface in `apps/contracts/src/AgentAccount.sol:769-921` is the in-tree ERC-7579 registry — this spec makes it load-bearing.

> **Doctrine: AgentAccount is a thin modular core.** Optional, policy-heavy, risky, or app-specific behavior MUST be a module contract (validator / executor / hook / fallback) — never inlined into the core. If a feature is required for every account to exist safely, it stays in core. Everything else is a module. The simple rule:
>
> | Feature shape | Where it lives |
> | --- | --- |
> | Required for every account to exist safely | Core (`AgentAccount.sol`) |
> | Optional / policy-heavy / likely to change / high-risk / app-specific | Module |
>
> **Why this doctrine, why now.** Phase 6c.5-d hit the EIP-170 deploy ceiling because the threshold-policy + admin-proposal + recovery surfaces all inlined into `AgentAccount`. The reflexive fix — extract them into a single `AdminModule` delegatecall blob — just shifts the size problem one layer; the blob itself eventually bloats too, and storage-layout coupling between core and blob creates a class of bug that ERC-7579's module isolation eliminates by design. Industry-standard accounts (Safe, Biconomy V2, Rhinestone, Kernel) all use the module taxonomy. We adopt it because the alternatives don't scale.

---

## 1. Goal

Define what stays in `AgentAccount.sol` (the core), what becomes a module, the four module type IDs in use, the `executeFromModule` callback that lets a module act on the core's behalf, the install permission model, and the migration plan that moves the threshold-policy + guardian-recovery + spend-limit + session/delegation-execution surfaces out of core into properly-typed modules.

`AgentAccount` was always supposed to be modular — the registry shipped in pass 6 already implements ERC-7579 `installModule` / `uninstallModule` / `accountId` (returns `"smart-agent.agent-account.2"`). Spec 209 makes the registry **load-bearing** rather than vestigial: every module-shaped feature actually uses it.

---

## 2. The split — what's core, what's a module

### 2.1 Core (stays in `AgentAccount.sol`)

The core is what every account needs to exist safely + interoperate with ERC-4337 / ERC-1271 / ERC-7579 tooling. Touching the core requires governance + a UUPS upgrade. The core is therefore deliberately small.

| Surface | Why it's core |
| --- | --- |
| ERC-4337 `validateUserOp` entry | Required by the EntryPoint; every account must implement |
| `execute` / `executeBatch` (BaseAccount) | Required by the EntryPoint; bundlers expect this entry |
| ERC-7579 module registry (`installModule` / `uninstallModule` / `isModuleInstalled` / `supportsModule` / `getInstalledModules`) | Without this, no modules can attach |
| `onlySelf` admin gate (the modifier itself) | Required for the userOp-driven self-call pattern; modules build on top |
| Minimal owner root (single-owner ECDSA happy path) | The trivial case — every account starts as 1-of-1 EOA |
| Passkey root (single-passkey ECDSA / WebAuthn dispatch) | Common enough to be a primitive; advanced passkey policy is a module |
| Factory + initializer | Required to deploy; per-mode init is via post-deploy module install |
| UUPS upgrade authorization (`_authorizeUpgrade`) | The core's own upgrade gate; module upgrades are independent |
| Basic ERC-1271 (`isValidSignature`) — owner / passkey single-sig validation | Required by signer-agnostic verifiers (DM, paymaster, third-party) |
| `executeFromModule(target, value, data)` (NEW — phase 6c.5-d.0) | The single callback path modules use to act on the core's behalf |

### 2.2 Modules (extract from core, install on accounts that need them)

Per ERC-7579 the type IDs are:

```
MODULE_TYPE_VALIDATOR = 1    (already supported in registry)
MODULE_TYPE_EXECUTOR  = 2    (already supported in registry)
MODULE_TYPE_FALLBACK  = 3    (NOT yet supported; phase 7+)
MODULE_TYPE_HOOK      = 4    (already supported in registry; capped at MAX_HOOKS=8)
```

(These match the constants in `apps/contracts/src/AgentAccount.sol:754-757`. They follow the ERC-7579 spec which assigns FALLBACK=3 and HOOK=4 — earlier drafts of this spec had them swapped; corrected here for fidelity to the implementation.)

**Validators** (`MODULE_TYPE_VALIDATOR`) — decide *who* can authorize. Called from `_validateSignature` / `validateUserOp` when the signature payload encodes a validator selector.

| Module | What it does | Migration phase |
| --- | --- | --- |
| `PasskeyAdvancedValidator` | Multi-passkey, attestation policy, credential rotation, RPID binding | Phase 7+ (current single-passkey root stays in core) |
| `CustodyPolicy` (was `ThresholdValidator` — renamed phase 6g.1) | n-of-m custodian-set + per-tier approvals + safety-delay policy (the surface that previously bloated core) | **Phase 6c.5-d.1** (the EIP-170 unblock) |
| `GuardianRecoveryValidator` | Guardian-quorum recovery (T6 admin path) | Phase 6c.5-d.2 |
| `SessionKeyValidator` | Per-session signer authority with TTL + scope (the delegation surface's signing side) | Phase 6c.5-d.4 (after spec 208 lands) |

**Executors** (`MODULE_TYPE_EXECUTOR`) — decide *what* can execute. Call back into the core via `executeFromModule`.

| Module | What it does | Migration phase |
| --- | --- | --- |
| `DelegationExecutor` | Redeems a delegation token via the DM; ports the existing DM-call path out of `execute` | Phase 6c.5-d.4 |
| `TreasuryExecutor` | Scheduled / approved treasury payments | Phase 6e (treasury package) |
| `McpToolExecutor` | Calls an external MCP tool address via `executeFromModule`, threading the tool-policy decision | Phase 6f (post-6e) |

**Hooks** (`MODULE_TYPE_HOOK`) — run pre / post execution. Capped at `MAX_HOOKS = 8` to bound the per-call loop.

| Module | What it does | Migration phase |
| --- | --- | --- |
| `AllowedTargetsHook` | Reject calls whose target isn't in an allowlist | Phase 6c.5-d.3 (already exists as a delegation caveat — port as account-level hook) |
| `AllowedMethodsHook` | Reject calls whose selector isn't allowlisted | Phase 6c.5-d.3 (mirror of `AllowedTargetsHook`) |
| `SpendingCapHook` | Per-window value ceiling, rolling reset | Phase 6c.5-d.3 |
| `RateLimitHook` | Per-period call count cap | Phase 7 |
| `CaveatVerifierHook` | The tool-policy decision boundary at the execution layer (mirror of the delegation-time check) | Phase 6c.5-d.5 (after spec 208) |
| `AuditEmitterHook` | Post-execution audit event emission (closes spec 206 C3 at the account layer) | Phase 7 |
| `OrgPolicyGuardHook` | Org-mode separation-of-duties guard at execution time | Phase 7 |

**Fallbacks** (`MODULE_TYPE_FALLBACK`, type ID 3) — add extra interfaces without changing core. Phase 7+ — not yet supported by the registry; opting in requires registry update + fallback selector dispatch.

| Module (phase 7+) | What it does |
| --- | --- |
| `ERC1271CompatibilityFallback` | Extended ERC-1271 surface for legacy callers |
| `TokenReceiverFallback` | ERC-721 / ERC-1155 / ERC-4626 receiver hooks |
| `CrossChainMessageFallback` | Inbound message receiver for cross-chain protocols |

---

## 3. The `executeFromModule` callback

Modules act on the account's behalf via a single callback. The account checks that `msg.sender` is an installed module of the right type, then forwards the call.

```solidity
/// @notice Called by an installed executor module to act on the account's behalf.
/// @dev Only an installed MODULE_TYPE_EXECUTOR can call this. Validators
///      MUST NOT call it (they're authorization-side only); hooks MUST NOT
///      call it (they're pre/post-check only).
function executeFromModule(address target, uint256 value, bytes calldata data)
    external
    returns (bytes memory result)
{
    ModulesStorage storage $ = _modulesStorage();
    if (!$.installed[MODULE_TYPE_EXECUTOR][msg.sender]) {
        revert ModuleNotInstalled(MODULE_TYPE_EXECUTOR, msg.sender);
    }
    (bool ok, bytes memory ret) = target.call{value: value}(data);
    if (!ok) {
        assembly { revert(add(ret, 32), mload(ret)) }
    }
    return ret;
}
```

### 3.1 Why a single callback (and not per-action helpers)

A naive design would expose `addOwnerFromModule` / `removeOwnerFromModule` / `addPasskeyFromModule` / etc. — one helper per privileged action. That's wrong:

- Selector-bloat in the core defeats the whole point of the refactor.
- Every new module-driven action would require a core upgrade to add a helper.
- The `onlySelf` modifier is already the right gate — `executeFromModule` produces `msg.sender == address(this)` semantics by being itself called from the core. **Wait, no — `executeFromModule` makes `msg.sender == module` at the target.** The right model is: `executeFromModule` does a self-call (`address(this).call(data)`) so the inner action runs with `msg.sender == address(this)`, satisfying `onlySelf`. See § 3.2.

### 3.2 Self-call shape (corrected)

```solidity
function executeFromModule(address target, uint256 value, bytes calldata data)
    external
    returns (bytes memory result)
{
    if (!_modulesStorage().installed[MODULE_TYPE_EXECUTOR][msg.sender]) {
        revert ModuleNotInstalled(MODULE_TYPE_EXECUTOR, msg.sender);
    }
    // Self-call so inner `onlySelf` checks pass when the target is the
    // account itself. For external targets (DM redeem, treasury payment,
    // ERC-20 transfer), value/data flow through directly.
    if (target == address(this)) {
        (bool ok, bytes memory ret) = address(this).call{value: value}(data);
        if (!ok) { assembly { revert(add(ret, 32), mload(ret)) } }
        return ret;
    }
    (bool ok2, bytes memory ret2) = target.call{value: value}(data);
    if (!ok2) { assembly { revert(add(ret2, 32), mload(ret2)) } }
    return ret2;
}
```

For a `CustodyPolicy` module that needs to `addCustodian` after a quorum check, the call chain is:
`user → CustodyPolicy.applyCustodyChange(account, changeId, sigs)` → `CustodyPolicy` verifies, then `account.executeFromModule(account, 0, abi.encodeCall(addCustodian, owner))` → `account.addCustodian(owner)` runs with `msg.sender == account` satisfying `onlySelf`.

---

## 4. Module install permission model

Module install is **security-critical** — a malicious module installed once can drain or brick the account. The install path therefore has the same threat model as a T5 admin action (Critical).

| Install path | When | Gate |
| --- | --- | --- |
| `single` mode | Trivial — single signer self-installs at init | `onlyOwnerOrSelf` (current) |
| `hybrid` / `threshold` / `org` mode | Post-init module changes | T5 admin action through the `CustodyPolicy` module (once installed) — gated by quorum + timelock |
| Factory-time install | Initial set of modules at account creation | Factory passes a list of modules + initData; account installs them atomically during `initialize` |

The factory becomes the **canonical place** to install the right modules for the chosen mode:

- `single` mode → no modules installed; minimal owner root in core is sufficient.
- `hybrid` mode → `CustodyPolicy` + `GuardianRecoveryValidator`.
- `threshold` mode → `CustodyPolicy` + `GuardianRecoveryValidator`.
- `org` mode → `CustodyPolicy` + `GuardianRecoveryValidator` + `OrgPolicyGuardHook`.
- All non-`single` modes → `AllowedTargetsHook` + `SpendingCapHook` if value-handling.

Post-deploy module install is via the T5 admin action `InstallModule(moduleTypeId, moduleAddr, initData)` — which is itself a `CustodyPolicy` action, so it requires quorum + timelock.

---

## 5. Module storage isolation

Every module declares its per-account state at an ERC-7201 namespaced slot derived from its own canonical name. For example, `CustodyPolicy` uses:

```
slot = keccak256(abi.encode(uint256(keccak256("agenticprimitives.module.custody-policy.v1")) - 1)) & ~bytes32(uint256(0xff))
```

Two consequences:

1. **No storage-layout coupling between core and modules.** Adding a state variable to AgentAccount NEVER shifts a module's slots, and vice versa. This is the property that the spec 207 § 14 "AdminModule delegatecall blob" plan got wrong — it required core + blob to share linear-layout state.
2. **Modules can be deployed independently + reused across accounts.** A single `CustodyPolicy` contract is installed on N accounts; each account's threshold-policy state lives at the same ERC-7201 slot but the module's internal mapping is keyed by `address(this)` (the account, accessed via `delegatecall`-aware accessors) so reads/writes don't collide.

But **a validator-module is NOT delegatecalled** — that's the executor pattern. A validator is *called*. So its storage is its OWN storage, keyed by account. The state of `(account, threshold)` lives at `mapping(address => uint8)` in the validator's storage. The module is a regular contract; its caller (user, then forwarded to core) is `msg.sender == account` only inside `executeFromModule`'s self-call. Account address is passed explicitly into the module's external functions.

This is the **Safe pattern** — modules hold their own state, keyed by Safe. We adopt the same shape.

---

## 6. Threats + invariants

| Threat | Mitigation |
| --- | --- |
| Malicious module installed | Install requires T5 quorum + timelock (post-init) or factory + governance (init); `MAX_HOOKS=8` bounds hook-loop griefing |
| Module misimplements `onInstall` / `onUninstall` | Wrapped in `try/catch`; install rolls back atomically; uninstall is loud (reverts on failure) |
| Module storage collides with core | Each module uses ERC-7201 namespaced slots derived from its own name |
| `executeFromModule` called by non-module | Check `MODULE_TYPE_EXECUTOR` install flag; revert with typed error |
| Validator returns invalid for valid sig | Tested by validator's own unit suite; multiple validators can co-exist (additive — any installed validator's accept-sig accepts) |
| Hook loop griefs gas | `MAX_HOOKS = 8` cap; hooks must complete within a per-call gas budget set by the caller |
| Module-driven removal of last signer | `executeFromModule` self-call lands at `_applyRemoveOwner` which already has the `CannotRemoveLastSigner` check — invariant preserved |

---

## 7. Migration plan — Phase 6c.5-d series

Each phase is one or two PRs. Each leaves the system shippable (181 Forge tests + workspace tests green).

| Phase | What lands | Core delta |
| --- | --- | --- |
| **6c.5-d.0** | `executeFromModule(target, value, data)` shipped in core. Tests: only installed `EXECUTOR` can call; self-call satisfies `onlySelf`; external-call path works. No existing module uses it yet. | +1 function in core; ~200 bytes |
| **6c.5-d.1** | `CustodyPolicy.sol` module shipped. Holds: per-account `mode` / `approvalsRequiredByTier` / `safetyDelayByTier` / `trusteeCount` / `scheduledChangeCount` / `pending` mapping / `proposerCustodians`. Implements `scheduleCustodyChange(account, action, args, sigs)` / `applyCustodyChange(account, changeId, sigs)` / `cancelScheduledChange(account, changeId, sigs)`. Calls back via `account.executeFromModule(account, 0, encodedAction)`. Old `AgentAccount.scheduleCustodyChange` / `applyCustodyChange` / `cancelScheduledChange` REMOVED from core. Old `initializeWithThresholdPolicy` REMOVED — factory now installs the validator module + passes init data. | −7-9 KB from core (target: 18-20 KB total runtime) |
| **6c.5-d.2** | `GuardianRecoveryValidator.sol` module shipped — extracted from the T6 branch of the old `CustodyPolicy`. Owns: guardian set, recovery threshold, dual cancel window. Reuses `executeFromModule` for the atomic add/remove dispatch in `_applyRecoverAccount`. | −1-2 KB from validator module; further specialization |
| **6c.5-d.3** | Three hook modules shipped: `AllowedTargetsHook`, `AllowedMethodsHook`, `SpendingCapHook`. Pre-execution hook surface wired in core's `execute` path (already exists; this fills the catalog). | No core delta |
| **6c.5-d.4** | `DelegationExecutor.sol` + `SessionKeyValidator.sol` modules. Delegation-redemption path moves out of core into the executor. | −1-2 KB from core (if the redemption path was inlined; check before pulling) |
| **6c.5-d.5** | `CaveatVerifierHook.sol` — the execution-time tool-policy check, mirror of the delegation-time check that already exists. Depends on spec 208 (argument-level caveats). | No core delta |
| **6c.5-d.6** | Cross-cutting capability docs updated: per-module `CLAUDE.md`, demo guide updates, four-artifact pattern preserved. | No core delta |

After **6c.5-d.1** alone, AgentAccount fits in EIP-170 + the live deploy can resume. Phases d.2 through d.6 are independently sequencable.

---

## 8. Test posture

| Test surface | Where it lives |
| --- | --- |
| Core ERC-4337 + ERC-7579 install/uninstall | `apps/contracts/test/AgentAccount*.t.sol` (existing 181 tests) |
| `executeFromModule` unit + permission | `apps/contracts/test/ExecuteFromModule.t.sol` (NEW, phase 6c.5-d.0) |
| CustodyPolicy unit + integration | `apps/contracts/test/modules/CustodyPolicy.t.sol` + per-account integration with a mock `AgentAccount` |
| Each module has its own dedicated test file | `test/modules/<ModuleName>.t.sol` |
| Multi-module composition (validator + hook + executor on one account) | `test/integration/MultiModuleAccount.t.sol` |
| Cross-account module reuse (one validator deployed, installed on N accounts) | `test/integration/ModuleReuse.t.sol` |

Test counts grow but stay tractable — each module is independently verifiable.

---

## 9. Cross-cutting capability impact

The multi-sig capability index entry in `docs/architecture/cross-cutting-capabilities.md` updates after phase 6c.5-d.1 to reflect:

- Spec 207 governs the **product surface** (modes, risk tiers, recovery semantics, permission UX language).
- Spec 209 governs the **implementation architecture** (which surface lives in core vs which module).
- The participating-packages row stays the same; the canonical-demo-guide row stays the same; the spec column now points to BOTH `specs/207` AND `specs/209`.

The audit capability is unaffected — it's a server-side concern (`mcp-runtime` + `audit` package). Future `AuditEmitterHook` (phase 7) extends it onto the account layer; spec 206 updates then.

---

## 10. Spec 207 § 14 supersession

Spec 207 § 14 (the AdminModule delegatecall blob plan) is **superseded by this spec**. The doctrine was correct (split AgentAccount), the implementation was wrong (single blob, identical inheritance chain, storage layout coupled). Future readers should:

- Read § 14 to understand the architectural problem and the trigger.
- Read this spec for the actual solution.
- Treat § 14's "8-14h scope estimate" as obsolete — the phase 6c.5-d series breaks the work into d.0 / d.1 / d.2 / etc., each independently shippable.

Spec 207's main body (§ 1 through § 13) is **unchanged**. The product surface — modes, tiers, recovery semantics — stays the same. What moves is implementation: the threshold-policy state + propose/execute/cancel surface relocates from `AgentAccount.sol` into `apps/contracts/src/custody/CustodyPolicy.sol`.

---

## 11. Resolved decisions + open follow-ups

Resolved in this spec (2026-05-20):

- ✅ AgentAccount is a thin ERC-7579 modular core; module taxonomy is validator / executor / hook / fallback.
- ✅ `executeFromModule(target, value, data)` is the single callback path (self-call satisfies `onlySelf`).
- ✅ Module storage isolated via ERC-7201 namespaced slots; no shared linear-layout state.
- ✅ Install permission model: factory at init, T5 admin via `CustodyPolicy` post-init.
- ✅ Migration order: validator (threshold) first → guardian recovery → hooks → executors.
- ✅ Spec 207 § 14 superseded.

Open follow-ups:

- **Fallback type ID 3 support.** `_isSupportedModuleType` currently rejects it; phase 7 adds fallback selector dispatch.
- **Per-module governance.** A module is itself an upgradeable contract (likely UUPS); who upgrades it? Likely the same governance multisig that deploys the factory. Document in phase 6c.5-d.1.
- **Module versioning + `accountId` bump.** When a module's interface changes, accounts that installed it need to know. Likely an additional `installedVersion` slot per `(moduleTypeId, module)`. Phase 7.
- **Hook gas budgets.** `MAX_HOOKS=8` bounds the loop count but not per-hook gas. Phase 7+ adds a per-hook gas-limit field.
- **Module discovery from off-chain.** Modules should be discoverable by `accountId()` + `getInstalledModules(typeId)` — already implemented. Future: a `ModuleRegistry` contract that lists vetted modules + their addresses on each chain. Phase 7+.
