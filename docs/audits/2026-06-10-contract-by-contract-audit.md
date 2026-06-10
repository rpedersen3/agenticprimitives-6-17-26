# Contract-by-contract deep audit — `packages/contracts/src` (2026-06-10)

**Scope:** every Solidity contract under `packages/contracts/src` + deploy scripts.
**Status of findings:** tracked in [`findings.yaml`](./findings.yaml) (the High + the SC-class Mediums are
first-class entries there). This document is the detailed per-contract record; the Low/Info backlog lives
here + in `packages/contracts/AUDIT.md`.
**Headline:** the prior engagement under-covered exactly where two High issues were hiding — **CA-F1**
(pre-deployment custody hijack of the canonical identity) and **CP-1** (unconfigured quorum tiers collapsing
to single-signer) — plus the on-chain normalization gap **AN-1-ONCHAIN** (the SDK fix doesn't cover direct
callers) and **ATT-1** (the SC-2 bug class still live in `assertJointAgreement`'s issuer side). Those are the
mainnet blockers.

## Consolidated severity roll-up

| Severity | Findings |
|---|---|
| **High** | CA-F1 (factory custody-config front-run), CP-1 (custody tiers default 1-of-n), AN-1-ONCHAIN (no on-chain normalization), SUB-1 (subregistry front-run), SUB-2 (sybil squatting) |
| **Medium** | CA-1, CA-2, DM-1, DM-2, EN-11, EN-13, EN-22, CP-2, PM-1, PM-2, GOV-1, WA-1, WA-2, ATT-1, ATT-2, AGR-1, ONT-4, ONT-7, AN-2, RES-1 |
| **Low/Info** | CA-3/4/5/6, DM-3/4/5/6/7/8/10, EN-9/12/14, CP-3/4/5, PM-3/4, GOV-2/3/4, WA-3, LIB-1/2/3/4 |

## Group A — Account core

### `AgentAccount.sol` (1495 LOC) — ERC-4337 + 7579 modular account
Authority closure is tight: every admin path is `onlySelf`, `_authorizeUpgrade` is `onlySelf` (:415), legacy
single-sig upgrade fully disabled (:438-440), WebAuthn pins per-credential rpIdHash + requires UV on the
UserOp path (:1231-1233), reentrancy guards correct, pause kept off the validation path.
- **CA-1 · Medium — upgrade timelock is dead code.** `_pendingUpgrade` is never written;
  `executePendingUpgrade`/`cancelPendingUpgrade` unreachable; `setUpgradeTimelock` (:483) stores a value
  nothing reads. A single-sig owner who sets a 30-day timelock still gets instant upgrades. **Fix:** wire the
  queue or delete the inert surface.
- **CA-2 · Low/Med — ERC-1271 paths lack `address(this)`/chainid binding** (:1099-1177). A custodian shared
  across accounts A and B → a signature for A validates on B. (UserOp path is safe; approved-hash path bound.)
- **CA-3 · Low —** `isValidSignature` reverts (not `0xffffffff`) on a malformed ERC-6492 envelope (:1118-1125).
- **CA-4 · Low/Info —** validation-phase self-call + P256 precompile staticcall may trip strict ERC-7562 bundlers.
- **CA-5/CA-6 · Info —** `_factoryInitConsumed` declared after `__gap`; mode-0 factory-init branch stays open.

### `AgentAccountFactory.sol` (303 LOC)
- **CA-F1 · High — counterfactual address commits only to custodians/passkey/salt.** `_initData` (:197) does
  not include `mode`, `trustees`, or `timelockOverrides` (applied post-deploy via `installModule`, :168-171).
  The collision guard (:160) then silently returns a pre-existing account. An attacker who knows a victim's
  public salt + custodians **front-runs deployment at the victim's canonical address with attacker-chosen
  recovery trustees**, then drives a CustodyPolicy recovery to seize the identity — directly breaking
  "address is the identity." **Fix:** fold mode/trustees/timelocks into the salt or initialize, and assert
  config match on the occupied branch.
- **CA-F2 · Low —** silent adoption with no config-equality check (the mechanism behind CA-F1).

### `ApprovedHashRegistry.sol` (57 LOC) — production-ready (Info: approvals never expire).
### `UniversalSignatureValidator.sol` (139 LOC) — production-ready (malleability-safe `tryRecover`; the
inherent ERC-6492 arbitrary-call-relay caveat: don't grant privileges to its `msg.sender`).
### `IAgentAccount.sol` — Info: ABI still advertises the disabled `upgradeToWithAuthorization`.

## Group B — Delegation + enforcers

### `agency/DelegationManager.sol` (537 LOC)
Leaf `delegate == msg.sender` confirmed (:413-417); `nonReentrant`; revocation auth hardened; SC-3 no-code
enforcer view fix correct (:322). No Critical/High.
- **DM-1 · Medium — no redemption nonce/consumption record.** Caveat caps are per-call, not cumulative: a
  1-ETH `ValueEnforcer` delegation can be redeemed N times. ERC-7710-faithful, but no cumulative enforcer
  ships — document loudly or add a stateful budget enforcer.
- **DM-2 · Medium — quorum/approved-hash signatures have no nonce** → the same signed blob re-authorizes the
  same call (compounds DM-1).
- **DM-3 · Low —** `_executeFromDelegator` (:486-505) bare-calls; an EOA delegator returns success with no
  execution → silent no-op "success" + event. Add `code.length` guard.
- **DM-5 · Low —** pause gate fails open if governance reverts (:154-159), in tension with ADR-0013.
- **DM-4/6/7/8/10 · Info —** data shadowing; empty after-hook phase; unbounded loops; redundant re-hashing;
  `verifyAuthorization` (non-`ForCall`) skips caveats.

### Enforcers
- **QuorumEnforcer.sol — EN-11 · Medium:** `threshold == 0` passes with zero signatures (:160-179) — fail-open;
  add `if (threshold==0) revert`. **EN-13 · Medium:** no nonce/expiry in `QUORUM_ACTION_TYPEHASH` → identical-
  call replay. EN-12/EN-14 · Low. Otherwise the strongest enforcer (execution-context binding, sorted dedup).
- **ValueEnforcer.sol — EN-22 · Medium:** per-call not cumulative (same root as DM-1).
- **CallDataHashEnforcer.sol — EN-9 · Low:** binds calldata only, not target/value — must be composed.
- **AllowedMethods / AllowedTargets / Timestamp** — correct; empty afterHooks not exploitable.
- **CaveatEnforcerBase.sol — Info:** dead base; no enforcer inherits it (no ERC-7579 introspection on deployed enforcers).

## Group C — Custody / paymaster / governance / crypto libs

### `custody/CustodyPolicy.sol` (969 LOC)
Replay/CEI/dedup hygiene strong (account+changeId binding, strict-increasing signer order, CEI before call).
- **CP-1 · High — tier thresholds default to 1-of-n.** `onInstall` only writes a tier when `thresholds[t] > 0`
  (:373-376); `_approvalsValue` returns 1 for 0 (:633-637); the `_defaultApprovals` matrix is a pure view never
  invoked. A zeroed/partial threshold array → a single custodian key can rotate the whole custodian set (T4) or
  upgrade the implementation (T5). **Fix:** populate defaults at install; hard-revert unconfigured T4–T6.
- **CP-2 · Medium — `recoveryApprovals` unvalidated at install** (:369); can be 0 (recovery disabled) or
  > trustee count (recovery unmeetable) → bricks the T6 lifeline. The mutator path validates; install doesn't.
- **CP-3 · Low —** custody quorum never enforces UV on passkey signers. **CP-4 · Low —** scheduled changes never
  expire after eta. **CP-5 · Info —** dead `OnInstallNotByAccount`.

### `SmartAgentPaymaster.sol` (310 LOC)
Replay-hardened (full-UserOp + chainId + EntryPoint binding), malleability-safe, no fail-open dev mode.
- **PM-1 · Medium — validation reads governance storage** (`governance.staticcall(isPaused)`, :237-242) → ERC-
  7562 violation; compliant bundlers drop sponsored ops. Move pause to own-storage.
- **PM-2 · Medium — EntryPoint deposit drainable by the Ownable owner** (`withdrawTo`/`withdrawStake`), no
  timelock, decoupled from governance (:132). Set owner = governance timelock + enforce in deploy preflight.
- **PM-3 · Low/Med —** empty `_postOp`, no per-sender spend budget. **PM-4 · Low —** dev mode accept-all if misconfigured.

### Governance
- **AgenticGovernance.sol — GOV-1 · Medium:** immutable guardian can perpetually re-pause (instant pause :97,
  timelock-only unpause :105) → permanent DoS only fixable by full redeploy. GOV-2/GOV-3 · Low.
- **GovernanceManaged.sol — GOV-4 · Low:** `_pausedSafe` fail-opens for non-conforming governance (:69-74).

### Crypto libraries
- **WebAuthnLib.sol / P256Verifier.sol — WA-1 · Medium:** no low-s enforcement → P-256 malleability (an
  explicitly-required check, unmet). **WA-2 · Medium:** UV enforced only on opt-in + the live custody caller
  passes `requireUv=false`. Bounds-checking + rpIdHash pinning solid; fail-closed without RIP-7212. WA-3 · Low.
- **SignatureSlotRecovery.sol — LIB-1 · Low** (ecrecover lacks low-s, mitigated by dedup); tail-bounds hardened.
  LIB-2 · Info.
- **MultiSendCallOnly.sol — delegatecall ban correct.** LIB-3 · Low (no per-entry bounds). LIB-4 · Info (test harness in src/).

## Group D — Naming + identity
- **naming/AgentNameRegistry.sol — AN-1-ONCHAIN · High:** the on-chain registry enforces **no label
  normalization**. `register` (:237) + `initializeRoot` (:192) only check `EmptyLabel`, then hash raw bytes.
  The TS `normalizeLabel` fix (AN-1) is **bypassable by any direct caller** → homoglyph / mixed-case /
  zero-width / embedded-dot squatting of `.agent` names is live on-chain. **Fix:** enforce `[a-z0-9-]` on-chain.
  **AN-2 · Medium:** expiry is decorative (`isExpired` exists but registration never sets/enforces it).
  Reverse resolution correct + `eth_getLogs`-free + round-trip enforced (confirmed positive).
- **naming/PermissionlessSubregistry.sol — SUB-1 · High:** name front-running (no commit-reveal). **SUB-2 ·
  High:** sybil/homoglyph mass-squatting (no rate/cost barrier + the AN-1-ONCHAIN charset gap).
- **naming/AgentNameUniversalResolver.sol — RES-1 · Medium:** forward `resolveName` can return an unverified
  owner-asserted address (owner fallback) → a name can resolve to an address that doesn't reverse-resolve back.
- AgentNameAttributeResolver / AgentNamePredicates / AgentProfileResolver / AgentProfilePredicates — no
  high-severity findings (predicate-resolver trust is the watch item).

## Group E — Registries
- **attestation/AttestationRegistry.sol** — SC-2 (`assertAssociation`) confirmed fixed. **ATT-1 · Medium/High:**
  the SC-2 bug class survives in `assertJointAgreement` — the **issuer** signature is verified over a bare
  `req.credentialHash` (:217) with no typehash/parties/schema/chain/contract binding, so a known issuer
  signature can be reused to anchor a spoofed issuer-backed joint attestation. (The bilateral-consent half is
  correctly recomputed + verified via `JOINT_CONSENT_TYPEHASH` :222-226 — only the issuer side is unbound.)
  **ATT-2 · Medium:** revocation is cosmetic — salt-replay re-anchors a revoked attestation under a new UID.
- **agreement/AgreementRegistry.sol** — SC-1 confirmed fixed (:164-179). **AGR-1 · Medium:** the
  status-transition digest (`TRANSITION_TYPEHASH`, :244-245) lacks chain/contract binding → cross-chain replay.
- **ontology/ShapeRegistry.sol — ONT-4 · Medium:** trusts a caller-supplied store address.
  **ontology/AttributeStorage.sol — ONT-7 · Medium:** base has no subject-ownership gate.
- GeoFeatureRegistry / relationships/* / SkillDefinitionRegistry / OntologyTermRegistry — digest math sound;
  remaining items Low/Info.

## Block-on-mainnet shortlist
**CA-F1, CP-1, AN-1-ONCHAIN, SUB-1, SUB-2** (the five Highs) **+ ATT-1** (SC-2 class live in the issuer half of
`assertJointAgreement`). External formal contract audit (N1-adjacent) remains a gate above all of these.
