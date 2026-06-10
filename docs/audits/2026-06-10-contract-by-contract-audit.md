# Independent Contract-by-Contract Deep-Dive Audit (`packages/contracts/src`)

**Date:** 2026-06-10
**Auditor:** Independent AI security-audit agent (full per-contract source read; findings only, no patches).
**Scope:** All 42 Solidity files under `packages/contracts/src/`, audited one contract at a time and grouped A–E. This is a *secondary deep dive* that builds on, re-verifies, and corrects the severities of the first-pass contract findings.
**Verification provenance:** Every contract in this report was read line-by-line by the auditor directly (not delegated). The independent read produced three further corrections beyond the first deep dive — AGR-1 withdrawn (false positive) and ONT-4 / ONT-7 downgraded to by-design — each documented inline with the exact code that disproves the original framing. Per-contract provenance is tagged in §0.1.
**Companion reports:**

- [`archive/2026-06-09/2026-06-09-independent-contracts-audit.md`](archive/2026-06-09/2026-06-09-independent-contracts-audit.md) — the first contract pass (SC-1..SC-5). SC-1/SC-2/SC-3 are confirmed fixed in code; this deep dive supersedes it as the active contract tracker.
- [`archive/2026-06-09/2026-06-09-independent-package-audit.md`](archive/2026-06-09/2026-06-09-independent-package-audit.md) — all 31 TS packages.

> **Remediation status (as of this commit) — see [`findings.yaml`](findings.yaml) for the authoritative ledger.**
> The three block-mainnet items are now FIXED in code: **ATT-1** (PR #274 — `JOINT_ISSUER_TYPEHASH`), **AN-1-ONCHAIN** (PR #275 — on-chain `_validateLabel`), **CA-F1**+CA-F2 ([ADR-0035](../architecture/decisions/0035-counterfactual-address-commits-to-custody-config.md) — custody-config-bound CREATE2 salt; moves all addresses → redeploy required). **AGR-1**: this deep dive WITHDREW it after reading the already-bound transition digest; on `master` the digest genuinely lacked `chainId`/`address(this)`, so the registry-binding wave (#274) added the binding — it is retained as the canonical chain/contract binding (reverting would reintroduce cross-registry replay). The severity corrections below (CP-1/SUB-1/SUB-2 → Medium, RES-1/ONT-4/ONT-7 → Low/by-design) are reconciled in `findings.yaml`.

---

## 0. Why a secondary pass (methodology)

The first-pass per-contract findings came from parallel auditors whose severities were **not all spot-checked against the reachable call path**. Close re-reading already corrected two:

- **SC-3** was originally written as "caveat enforcers fail open in redemption." Redemption actually fails **closed** — solc 0.8 injects an `extcodesize` check on the high-level void hook call, so a no-code enforcer reverts. Only the *view* verifier (`verifyAuthorizationForCall`, raw `staticcall`) failed open. The fix landed there.
- **CP-1** was framed as "normal deploys collapse to 1-of-n." The factory's `_buildValidatorInitData` (`AgentAccountFactory.sol:281-301`) **does** populate tiers T1–T5 via `defaultApprovals(nSigners, t)` and sets `recoveryApprovals = trustees/2+1`. The 1-of-n default only bites on a **direct `onInstall`** that bypasses the factory, or on tier-6 reads via `_approvalsValue`. Re-rated **High → Medium**.

This pass re-derives every finding's severity from the *reachable* path (factory vs direct install, redemption vs view, on-chain enforcement vs SDK-only), and records an explicit exploit precondition for each. Where a first-pass severity was overstated, the correction is called out inline.

### Severity corrections vs the first pass

| Finding | First pass | This pass | Reason |
| --- | --- | --- | --- |
| CP-1 | High | Medium | Factory fills T1–T5 + recoveryApprovals; gap is direct-install / T6 fallback defense-in-depth |
| SUB-1 | High | Medium | Front-running is real, but the contract is explicitly documented demo-grade (`PermissionlessSubregistry.sol:24-29`) |
| SUB-2 | High | Medium | A one-name-per-`msg.sender` cap exists (`:93-94`); sybil bypasses it, but "no rate barrier" was inaccurate; demo-grade |
| RES-1 | Medium | Low | Forward `resolveName` falls back to owner, the node's legitimate authority; reverse path is round-trip enforced |
| ATT-1 | Medium/High | High | Same trust-binding bug class as SC-1/SC-2, on a live registry write path; confirmed unbound issuer signature |
| AGR-1 | Medium | Withdrawn (not a finding) | Independent read: the transition digest at `AgreementRegistry.sol:248` DOES bind `block.chainid` + `address(this)` + a nullifier (`:229-230`). No cross-chain replay exists |
| ONT-4 | Medium | Info (by-design) | `ShapeRegistry.validateSubject/isValid` are view-only; the caller-supplied store grants no authority and only fools the caller; all mutators are `onlyGovernor` |
| ONT-7 | Medium | Info (by-design) | `AttributeStorage` is abstract with all-internal setters that explicitly delegate auth to subclasses; not a base-level vuln (re-scope: verify concrete subclasses gate writes) |

### Corrected severity roll-up (contract layer, open)

| Severity | Findings |
| --- | --- |
| High | CA-F1 (factory custody-config front-run), AN-1-ONCHAIN (no on-chain label normalization), ATT-1 (joint-agreement issuer signature unbound) |
| Medium | CA-1, CA-2, DM-1, DM-2, EN-11, EN-13, EN-22, CP-1, CP-2, PM-1, PM-2, GOV-1, WA-1, WA-2, ATT-2, AN-2, SUB-1, SUB-2 |
| Low/Info | CA-3, CA-4, CA-5, CA-6, CA-I1, DM-3, DM-4, DM-5, DM-6, DM-7, DM-8, DM-10, EN-9, EN-12, EN-14, CP-3, CP-4, CP-5, PM-3, PM-4, GOV-2, GOV-3, GOV-4, WA-3, WA-4, LIB-1, LIB-2, LIB-3, LIB-4, RES-1, CA-R1, CA-U1, CA-U2, ONT-4, ONT-7 |
| Withdrawn | AGR-1 (transition digest is chain/contract/nullifier-bound — no replay) |

**Block-mainnet items:** CA-F1, AN-1-ONCHAIN, ATT-1. (All three now fixed in code — see the remediation banner above.) CP-1, CP-2, PM-1, PM-2, WA-1, WA-2 are the next tier.

**Confirmed fixed (verified present, not re-reported as open):** SC-1 (AgreementRegistry issuer digest recomputed on-chain), SC-2 (AttestationRegistry.assertAssociation binds subject+issuer+schema+type+hash+chain+contract), SC-3 (view verifier returns no-code-enforcer, `DelegationManager.sol:322`).

### 0.1 Per-contract verification provenance

Every contract below was read line-by-line by the auditor for this report. Findings were additionally cross-checked against their reachable callers (factory vs direct install, redemption vs view).

| Group | Contracts independently read (line-by-line) |
| --- | --- |
| A — Account core | `AgentAccount.sol`, `AgentAccountFactory.sol`, `ApprovedHashRegistry.sol`, `UniversalSignatureValidator.sol`, `IAgentAccount.sol` |
| B — Delegation + enforcers | `DelegationManager.sol`, all 6 enforcers, `CaveatEnforcerBase.sol`, `ICaveatEnforcer.sol`, `IDelegationManager.sol` |
| C — Custody/paymaster/gov/libs | `CustodyPolicy.sol`, `SmartAgentPaymaster.sol`, `AgenticGovernance.sol`, `GovernanceManaged.sol`, `IGovernance.sol`, `WebAuthnLib.sol`, `P256Verifier.sol`, `SignatureSlotRecovery.sol`, `MultiSendCallOnly.sol`, `IERC7579Module.sol` |
| D — Naming + identity | `AgentNameRegistry.sol`, `AgentNameUniversalResolver.sol`, `PermissionlessSubregistry.sol`, `AgentNameAttributeResolver.sol`, `AgentNamePredicates.sol`, `AgentProfileResolver.sol`, `AgentProfilePredicates.sol` |
| E — Registries | `AgreementRegistry.sol`, `AttestationRegistry.sol`, `ShapeRegistry.sol`, `AttributeStorage.sol`, `OntologyTermRegistry.sol`, `RelationshipTypeRegistry.sol`, `AgentRelationship.sol`, `AgentRelationshipPredicates.sol`, `SkillDefinitionRegistry.sol`, `GeoFeatureRegistry.sol` |

All 42 `.sol` files are accounted for (the two `content/` files in the original scope do not exist in the repo).

---

## Group A — Account core

### `AgentAccount.sol` (1495 LOC) — ERC-4337 + ERC-7579 modular account

Authority closure is genuinely tight: every admin path is `onlySelf`, `_authorizeUpgrade` is `onlySelf` (`:415`), the legacy single-sig upgrade path is fully disabled (`:438-440`), WebAuthn pins per-credential `rpIdHash` and requires UV on the UserOp path (`:1231-1233`), reentrancy guards are correct, and pause is correctly kept off the validation path.

- **CA-1 · Medium** — Upgrade timelock is dead code. `_pendingUpgrade` is never written; `executePendingUpgrade`/`cancelPendingUpgrade` are unreachable; `setUpgradeTimelock` (`:483`) stores a value no path consults. The live upgrade is a direct self-call into `upgradeToAndCall` gated only by `_authorizeUpgrade`'s `onlySelf`. A single-signer (mode-0) owner who sets a timelock still upgrades instantly. Fix: wire the queue or delete the inert surface.
- **CA-2 · Medium** — ERC-1271 ECDSA/WebAuthn paths verify the raw hash with no `address(this)`/`block.chainid` binding (`:1099-1177`). The `0x03` approved-hash path IS account-bound; ECDSA/WebAuthn are not. A custodian key shared across accounts A and B → a signature satisfying `A.isValidSignature` also satisfies `B.isValidSignature`. The UserOp path is unaffected. Fix: verify against an EIP-712 wrapper bound to `address(this)`+chainid.
- **CA-3 · Low** — `isValidSignature` `abi.decode`s a malformed ERC-6492 envelope without try/catch (`:1118-1125`), reverting instead of returning `0xffffffff`.
- **CA-4 · Low/Info** — Validation-phase external self-call + P256 precompile staticcall may trip strict ERC-7562 bundler simulation for passkey UserOps. Confirm against target bundlers.
- **CA-5 · Info** — `_factoryInitConsumed` (`:744`) declared after `__gap` — latent upgrade-safety hazard, no collision today.
- **CA-6 · Info** — For mode 0 the factory installs no module, so `_factoryInitConsumed` stays false and the `msg.sender == factory && !consumed` branch stays open indefinitely (not exploitable today; latent).

**Verdict:** conditionally ready — fix CA-1 (false assurance on single-sig accounts), review CA-2 if the 1271 surface is consumed externally with shared keys.

### `AgentAccountFactory.sol` (303 LOC)

- **CA-F1 · High** — The CREATE2 counterfactual address commits only to custodians/passkey/`delegationManager`/factory + the bare `salt`. It does **not** include `mode`, `trustees`, or `timelockOverrides` (applied after deploy via `installModule`). Two calls with identical custodians/passkey/salt but different `mode`+`trustees` resolve to the **same address**, and the collision guard (`:160`) silently returns whichever deployed first. *Exploit:* a victim publishes address `X` (mode-3 org, trustees `[G1,G2,G3]`); an attacker front-runs with the same custodians+salt but `mode=1, trustees=[attacker]`; the proxy deploys at `X` with the attacker as sole recovery trustee, who then drives a `CustodyPolicy` T6 recovery to seize the canonical identity. *Fix:* fold `mode`/`trustees`/`timelockOverrides` into the CREATE2 salt (or `initialize`); on the occupied branch assert config match. **(FIXED — [ADR-0035](../architecture/decisions/0035-counterfactual-address-commits-to-custody-config.md): salt now `keccak256(abi.encode(salt, mode, trustees, timelockOverrides))`.)**
- **CA-F2 · Low** — Silent adoption of a pre-existing account with no config-equality check (`:160`) — the mechanism that turns CA-F1 into a silent hijack. **(FIXED by CA-F1: the occupied branch is now reachable only by an identical-config request.)**

**Verdict:** ~~not ready until CA-F1 fixed~~ → CA-F1 fixed (ADR-0035); needs the factory redeploy (addresses move).

### `ApprovedHashRegistry.sol` (57 LOC) — production-ready
Self-keyed boolean approvals; no replay/malleability surface. **CA-R1 · Info:** approvals never expire (consumer-layer discipline).

### `UniversalSignatureValidator.sol` (139 LOC) — production-ready
Stateless ERC-1271/6492/ECDSA verifier; malleability-safe `tryRecover`; view variant refuses to deploy. **CA-U1 · Low/Info:** the 6492 path is an unguarded arbitrary-call relay (inherent to ERC-6492; the contract holds nothing). **CA-U2 · Info:** 6492 deploy asserted via `signer.code.length` — fails closed.

### `IAgentAccount.sol` — Info only
**CA-I1 · Info:** the interface still advertises `upgradeToWithAuthorization` while the impl reverts `LegacyUpgradePathDisabled`. Mark it a deprecated always-reverting stub.

---

## Group B — Delegation + enforcers

### `agency/DelegationManager.sol` (537 LOC)
Leaf `delegate == msg.sender` (or `OPEN_DELEGATION`) confirmed; `redeemDelegation` is `nonReentrant`; revocation auth hardened; SC-3 view fix confirmed (`:322`). No Critical/High.

- **DM-1 · Medium** — No redemption nonce/consumption record. A delegation capped only by `ValueEnforcer(maxValue=1 ETH)` can be redeemed N times for N ETH — caveat caps are per-call, not cumulative. ERC-7710-faithful, but no shipped enforcer is cumulative. Fix: a stateful budget/nonce enforcer keyed by `delegationHash`, or document per-call semantics loudly.
- **DM-2 · Medium** — Quorum/approved-hash signatures are replayable for identical repeated calls (no nonce/expiry in the quorum typehash). Fix: add a nonce/expiry + per-delegation consumed state.
- **DM-3 · Low** — `_executeFromDelegator` does a bare call with no `delegator.code.length` check; a call to an EOA "succeeds" with empty returndata. Fix: `require(delegator.code.length > 0)`.
- **DM-5 · Low** — Pause gate fails open: reverts only when the governance staticcall succeeds AND returns ≥32 bytes AND decodes true. A reverting/selfdestructed governance silently disables the kill-switch (tension with ADR-0013). Fix: fail closed.
- **DM-4 / DM-6 / DM-7 / DM-8 / DM-10 · Info** — `data` local shadows the calldata arg; after-hook phase enforces nothing; unbounded chain/caveat loops (self-DoS); redundant hash recompute; `verifyAuthorization` (non-ForCall) skips caveats by design (naming footgun).

**Verdict:** structurally sound, no Critical/High. Center of gravity is per-call-vs-cumulative semantics + identical-call replay (DM-1/DM-2).

### Enforcers
- **QuorumEnforcer.sol** — strongest enforcer (execution-context binding, sorted-ascending dedup). **EN-11 · Medium:** `threshold == 0` passes with zero signatures; reachable only via a direct mint with hand-crafted terms; still a fail-open footgun. Fix: `if (threshold == 0) revert`. **EN-13 · Medium:** no nonce/expiry → identical-call replay. **EN-12 · Low:** no `threshold <= signerSet.length` check (fails closed). **EN-14 · Low:** approveHash approvals are standing/reusable.
- **ValueEnforcer.sol** — **EN-22 · Medium:** per-call cap, not cumulative (same root as DM-1). Fix: document + a cumulative SpendLimitEnforcer.
- **CallDataHashEnforcer.sol** — **EN-9 · Low:** binds calldata only, not target/value — compose with AllowedTargets+Value.
- **AllowedMethods/AllowedTargets/Timestamp** — correct; empty afterHooks not exploitable.
- **CaveatEnforcerBase.sol** — Info: dead base; no shipping enforcer inherits it.
- **ICaveatEnforcer / IDelegationManager** — `afterHook` advertised but unused; `Caveat.args` is redeemer-supplied and not hash-bound (future enforcers must treat `args` as untrusted).

**Group B verdict:** no Critical/High. Address per-call-vs-cumulative + identical-call replay (DM-1/DM-2/EN-13/EN-22) + the EN-11 zero-threshold guard.

---

## Group C — Custody / paymaster / governance / crypto libs

### `custody/CustodyPolicy.sol` (969 LOC)
Replay/CEI/dedup hygiene is strong (account+changeId binding, strict-increasing signer order, CEI, cross-account replay blocked on two axes).

- **CP-1 · Medium (corrected from High)** — Tier thresholds silently default to 1-of-n (`onInstall` writes a tier only when `thresholds[t] > 0`; `_approvalsValue` returns 1 for unset). The factory populates T1–T5 + recoveryApprovals, so factory-deployed accounts are NOT 1-of-n; the gap is a direct `onInstall` bypassing the factory, or a T6 read via `_approvalsValue` (defense-in-depth). Fix: populate unset tiers from `_defaultApprovals` at install + hard-revert unconfigured T4–T6.
- **CP-2 · Medium** — `recoveryApprovals` unvalidated at install (`:369`): can be 0 (recovery permanently disabled) or > trustee count (recovery un-meetable). The mutator path validates this; the install path doesn't. Fix: apply `recThr >= 1 && recThr <= trusteeCount` in `onInstall`.
- **CP-3 · Low** — Custody quorum never enforces User-Verified on passkey signers (`SignatureSlotRecovery` v=2 hardcodes `requireUv=false`). Fix: thread a per-tier `requireUv`; require UV for T4+.
- **CP-4 · Low** — Scheduled changes never expire after `eta` (mitigated: apply re-verifies a fresh quorum). Add a grace window.
- **CP-5 · Info** — `onInstall` publicly callable into the caller's own config slot; benign.

**Verdict:** needs work — CP-1/CP-2 are install-path defense-in-depth / fail-brick gaps that mirror already-fixed mutator-path checks.

### `SmartAgentPaymaster.sol` (310 LOC)
Replay-hardened (`getHash` binds full UserOp + chainId + `address(this)` + entryPoint), malleability-safe, no fail-open dev mode.

- **PM-1 · Medium** — `_validatePaymasterUserOp` reads external-contract storage during validation (`governance.staticcall(isPaused)`) — ERC-7562 forbids this; a spec-compliant public bundler drops every sponsored UserOp. Fix: own-storage pause flag, or enforce at the governance layer.
- **PM-2 · Medium** — EntryPoint deposit drainable by the Ownable owner (`withdrawTo`/`withdrawStake`), no timelock, decoupled from governance. Fix: set `initialOwner` to the governance timelock + enforce in `check:production-deploy`.
- **PM-3 · Low/Medium** — Empty `_postOp`, no per-sender spend budget. Fix: track per-sender cumulative spend + cap.
- **PM-4 · Low** — Dev mode is accept-all; keep the deploy preflight asserting `devMode()==false` on mainnet.

**Verdict:** not drainable by an unauthorized external caller and replay-hardened; resolve PM-1 (bundler compat) + PM-2 (deposit authority → timelock) before mainnet.

### `governance/AgenticGovernance.sol` (140 LOC)
- **GOV-1 · Medium** — A compromised (immutable) guardian can perpetually re-pause (pause is instant + guardian-only; unpause needs the 24h timelock), freezing every downstream `whenNotPaused` write. Fix: let the timelock rotate/revoke the guardian.
- **GOV-2 · Low** — `execute` is an unrestricted arbitrary call + value (timelock-gated, by design). Document the trust assumption.
- **GOV-3 · Low** — All authorities immutable → no rotation without a redeploy cascade.

### `governance/GovernanceManaged.sol` (75 LOC)
- **GOV-4 · Low** — `_pausedSafe` fail-opens for non-conforming governance. Same pattern in `CustodyPolicy._systemPausedFor` + PM-1. Fix: require a code-bearing, conforming governance for production builds (fail closed).

### Crypto libs
- **WebAuthnLib.sol / P256Verifier.sol** — **WA-1 · Medium:** no low-s enforcement → P-256 malleability (impact low today: quorum dedups by recovered signer; any future use as a uniqueness key breaks). Fix: enforce `s <= P256_N/2`. **WA-2 · Medium:** UV enforced only when the caller opts in; the live custody caller passes `requireUv=false` (same root as CP-3). **WA-3 · Low:** caller-supplied offsets trusted (impractical to exploit given rpIdHash pinning). **WA-4 · Info:** fail-closed on chains without RIP-7212 (Base has it).
- **SignatureSlotRecovery.sol** — **LIB-1 · Low:** `ecrecover` paths use raw `ecrecover` (high-s not rejected); mitigated downstream by quorum dedup. **LIB-2 · Info:** assembly tail over-read (harmless).
- **MultiSendCallOnly.sol** — **LIB-3 · Low:** no per-entry bounds validation (not externally reachable; self-DoS). **LIB-4 · Info:** test harness ships in `src/`. Positive: delegatecall ban enforced.
- **IERC7579Module.sol** — clean.

---

## Group D — Naming + identity

### `naming/AgentNameRegistry.sol`
- **AN-1-ONCHAIN · High** — The on-chain registry enforces no label normalization: `register` + `initializeRoot` only check `EmptyLabel`, then hash raw bytes. Any direct caller (bypassing the SDK) registers homoglyph / mixed-case / zero-width / embedded-dot variants. Fix: enforce a `[a-z0-9-]` charset on-chain. **(FIXED — PR #275: `_validateLabel` on both write paths.)**
- **AN-2 · Medium** — Expiry is decorative (`register` never sets expiry; `isExpired` always false). Names are permanent; no renewal/reclaim. Fix: set + enforce expiry with a renewal flow, or remove the dead surface.

Positives: reverse resolution correct + `eth_getLogs`-free; round-trip enforced; root front-run closed (initializer-gated).

### `naming/PermissionlessSubregistry.sol`
- **SUB-1 · Medium (corrected from High)** — Name front-running: `register(label, newOwner)` has no commit-reveal. The contract documents itself as demo/sybil-rollup grade (`:24-29`). Fix: commit-reveal for production.
- **SUB-2 · Medium (corrected from High)** — Sybil / homoglyph mass-squatting. A one-name-per-`msg.sender` cap + `MIN_LABEL_LENGTH=3` exist (so "no rate barrier" was inaccurate), but the per-sender cap is sybil-bypassable, and the AN-1-ONCHAIN gap amplified homoglyphs (now closed via `register` enforcement). Fix: registration fee or governance allowlist.

### `naming/AgentNameUniversalResolver.sol`
- **RES-1 · Low (corrected from Medium)** — Forward `resolveName` falls back to `REGISTRY.owner(node)` when no explicit `ATL_ADDR` record is set; the owner is the node's legitimate authority, so this is a defensible default. `reverseResolve`/`reverseResolveString` ARE round-trip enforced. Fix (optional): document that forward resolution via the owner fallback is not a canonical bidirectional binding.

`AgentNameAttributeResolver`, `AgentNamePredicates`, `AgentProfileResolver`, `AgentProfilePredicates` — no high-severity findings; predicate-resolver trust (a node's resolver is whatever the owner set) is the main watch item.

---

## Group E — Registries

### `attestation/AttestationRegistry.sol`
- **SC-2** — confirmed fixed (`assertAssociation` binds subject+issuer+schema+type+hash+chain+contract).
- **ATT-1 · High (corrected up from Medium/High)** — The SC-1/SC-2 trust-binding bug class survives in `assertJointAgreement`: the issuer signature is verified over a bare `req.credentialHash` (`:217`) — no typehash, no parties/schema/chain/contract binding. Any valid issuer signature over a known credential hash can be reused to anchor a spoofed issuer-backed joint attestation. (The bilateral-consent half IS correctly recomputed via `JOINT_CONSENT_TYPEHASH`.) Fix: a canonical typed issuer digest binding issuer+parties+schema+type+hash+chainId+verifyingContract. **(FIXED — PR #274: `JOINT_ISSUER_TYPEHASH`.)**
- **ATT-2 · Medium** — Revocation is cosmetic: a UID derives from caller-chosen salt, so re-anchoring the same logical attestation under a fresh salt produces a new UID that bypasses the revoked one. Fix: key revocation on `(issuer, credentialHash)` rather than the salted UID.

### `agreement/AgreementRegistry.sol`
- **SC-1** — confirmed fixed (`register` recomputes the issuer digest via `AGREEMENT_ISSUER_TYPEHASH` binding agreementCommitment/schemaHash/issuer/chainid/`address(this)`).
- **AGR-1 · WITHDRAWN (not a finding)** — The first pass claimed the status-transition digest lacks chain/contract binding. The independent read of the code at hand shows `updateStatus` recomputes `keccak256(abi.encode(TRANSITION_TYPEHASH, agreementCommitment, toStatus, nullifier, block.chainid, address(this)))` + enforces a per-transition nullifier + a recomputed party set. No cross-chain/same-chain replay. *Reconciliation note:* on `master` the transition digest genuinely did NOT bind `block.chainid`/`address(this)` (typehash + `abi.encode` were 3-field); the registry-binding wave (#274) added the binding. The deep dive read the already-fixed code. The binding is retained — reverting it would reintroduce cross-registry replay (nullifiers are per-instance storage).

### `ontology/ShapeRegistry.sol`
- **ONT-4 · Info (by-design — downgraded from Medium)** — `validateSubject`/`isValid` are view-only; a caller-supplied store grants no authority and mutates no state. Every mutator is `onlyGovernor`. Optional: document that consumers must pass a trusted store. Not a vulnerability.

### `ontology/AttributeStorage.sol`
- **ONT-7 · Info (by-design — downgraded from Medium)** — abstract contract; every setter is `internal`; the docstring delegates auth to subclasses. Cannot be deployed; no external write. Re-scope (open action): verify each concrete subclass gates its external write surface.

`GeoFeatureRegistry`, `AgentRelationship`, `RelationshipTypeRegistry`, `AgentRelationshipPredicates`, `SkillDefinitionRegistry`, `OntologyTermRegistry` — digest math sound; remaining items Low/Info. Every external mutator gates on a direct `msg.sender` identity check; no signature-replay surface.

**Coverage note:** `content/ContentCorpusRegistry.sol` + `content/ValidationAttestationRegistry.sol` referenced in earlier scoping do not exist in the repo. All 42 present `.sol` files are covered.

---

## Test / verification gaps

- **ATT-1** — ~~no property test asserts issuer-signature binding completeness~~ → added in PR #274 (cross-stack typehash + Foundry).
- **CA-F1** — ~~no test asserts the CREATE2 address commits to mode/trustees/timelockOverrides~~ → added (5 property tests, `AgentAccountFactoryMode.t.sol`).
- **AN-1-ONCHAIN** — ~~no test asserts on-chain label charset enforcement~~ → added in PR #275 (11 Foundry cases).
- **CP-1/CP-2** — invariant suites cover the mutator paths but not the install path's threshold/recovery-approval flooring.
- **DM-1/EN-22** — no invariant asserts cumulative-spend semantics (no cumulative enforcer ships); add one once a budget enforcer ships, or a test documenting the per-call ceiling.

Existing posture remains strong: 61 Foundry test files, dedicated invariant suites (custody/delegation/paymaster), Halmos symbolic proofs, Echidna + Medusa with committed configs.

---

## Prioritized remediation roadmap

### P0 — block mainnet
- **CA-F1** — ✅ FIXED (ADR-0035; salt commits to custody config + property tests). Requires the factory redeploy.
- **AN-1-ONCHAIN** — ✅ FIXED (PR #275; `[a-z0-9-]` on-chain charset + tests).
- **ATT-1** — ✅ FIXED (PR #274; canonical issuer typed digest + binding-completeness tests).

### P1 — production-blocking
- **CP-1 / CP-2** — floor + hard-revert unconfigured high tiers and validate `recoveryApprovals` in `onInstall`.
- **PM-1** — remove the governance read from `_validatePaymasterUserOp` (own-storage pause).
- **PM-2** — bind paymaster deposit authority to the governance timelock + deploy preflight.
- **WA-1 / WA-2** — enforce low-s; thread `requireUv` for custody/recovery tiers.
- **CA-1** — wire or remove the upgrade-timelock surface.
- **GOV-1** — allow the timelock to rotate/revoke the guardian.
- **ATT-2** — salt-independent revocation (key on `(issuer, credentialHash)`). *(AGR-1 withdrawn — transition digests are chain/contract/nullifier-bound.)*

### P2 — hardening / post-audit
- **DM-1 / DM-2 / EN-11 / EN-13 / EN-22** — ship a stateful budget/nonce enforcer; add `threshold==0` guard; document per-call semantics.
- **CA-2 / CA-3 / DM-3 / DM-5** — domain-bind the 1271 surface; 6492 decode try/catch; EOA-delegator `code.length` guard; pause fail-closed.
- **SUB-1 / SUB-2 / AN-2 / RES-1** — commit-reveal + fee/allowlist for any production subregistry; resolve or remove decorative expiry; document forward-resolution owner fallback.
- **LIB-1 / LIB-3 / LIB-4 / CA-5 / CA-6 / CA-I1 / CP-3 / CP-4 / CP-5 / PM-3 / PM-4 / GOV-2 / GOV-3 / GOV-4 / WA-3 / EN-9 / EN-12 / EN-14 / CaveatEnforcerBase** — low/info hardening + dead-code cleanup.
- **Expand Halmos proofs + invariant tests for the highest-impact properties** — formalize the invariants the remediated findings now rely on: CA-F1 (the CREATE2 address is an injective function of the full custody config — differing config ⇒ differing address), the ATT-1/SC-1/SC-2 issuer/consent digest-binding completeness, the DM leaf `delegate == msg.sender` / authority-chain closure, and the CP install-path threshold/recovery flooring once CP-1/CP-2 land. Symbolic + bounded-fuzz coverage on these turns "fixed + has a unit test" into "fixed + proven."

---

Findings are evidence-based (file + line per finding). No code was patched as part of this audit; severity corrections vs the first pass are called out in §0 and inline. Remediation status is tracked in [`findings.yaml`](findings.yaml).
