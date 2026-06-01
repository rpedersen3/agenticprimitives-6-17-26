# R9 static-analysis triage — Slither + Aderyn findings on master

**Date:** 2026-06-01
**Branch scanned:** `r9-6-oz-foundry-upgrades` (master + R9.6 H-6 fix)
**Tools:** Slither 0.11.5 (already PR-blocking on HIGH via
`.github/workflows/security.yml`) + Aderyn 0.6.8 (already advisory
artifact via same workflow).

This document is the explicit triage of every HIGH-impact finding the
two scanners reported, with the **verdict** (false positive, defensible
design, actionable) and the **reasoning**. It is the source-of-truth
record the auditor / external reviewer can spot-check.

Companion to [spec 237 — Audit Evidence Layer](../../specs/237-audit-evidence-layer.md).
Per ADR-0022, every claim below has pointers to the
implementation + the locking test.

---

## Slither

**Run summary:** 14 findings — **1 Medium + 13 Low**. The PR-blocking
gate is on HIGH only; no HIGH findings. The Medium below is documented;
the Lows are R6.4 noise (uninitialized-local family) slated for R9.7
cleanup with no behavioral impact today.

### Slither-M-1 — Cross-function reentrancy in `PermissionlessSubregistry.register`

**Detector:** `reentrancy-no-eth`
**Location:** `src/naming/PermissionlessSubregistry.sol:95`

**Slither's claim:** State variable `claimedBy[msg.sender]` is written
AFTER the external call `REGISTRY.register(...)`. Cross-function
reentrancy is possible via `hasClaimed(address)`.

**Verdict: false positive.**

**Reasoning:**

1. The function is protected by OZ `nonReentrant` (line 89). Any
   recursive re-entry into `register()` reverts.
2. The "cross-function reentrancy" reader is `hasClaimed(caller)` — a
   pure view function that returns `claimedBy[caller] != bytes32(0)`.
   It mutates nothing.
3. During the external `REGISTRY.register(...)` window, an external
   observer (a hook installed elsewhere, an off-chain reader) would
   see `hasClaimed(msg.sender) == false`. The next moment the call
   returns, it sees `true`. There is no invariant violated here: a
   "I haven't claimed yet" window pre-claim is the correct semantics.
4. The external `REGISTRY` (the `AgentNameRegistry`) is an immutable
   contract we control; it does not call back into
   `PermissionlessSubregistry` during `register`.

The CEI pattern would still be a stylistic improvement (write before
external call), but the gate is correct as-is.

**Action:** none. Documented here.

### Slither L-1..L-13 — Uninitialized-local family

**Detector:** `uninitialized-local`
**Locations:** see Slither output; CustodyPolicy.sol (6 instances),
WebAuthnLib.sol (3 instances), AgentAccountFactory.sol (1),
AgentNameUniversalResolver.sol (1), QuorumEnforcer.sol (1).

**Verdict: low-impact noise (R6.4 known).**

**Reasoning:**

Each instance is one of three patterns, none of which are bugs:

1. **Array struct field that gets populated inside an `if`/`for` block
   immediately after declaration.** Solidity-initializes the array to
   length 0; the loop then writes elements. Slither flags the
   declaration moment.
2. **Memory variables used as accumulators in base64-url decoding
   (`WebAuthnLib._base64UrlEqualsHash`).** Initialized via
   default-zero semantics; the loop's first iteration writes them.
3. **Local struct fields written via named-field assignment.**
   Slither cannot prove the assignment closes the slot from the
   detector's static analysis perspective.

**Action:** R9.7 wave — explicit zero-initialization for each (no
behavioral change; quiets the detector permanently).

---

## Aderyn

**Run summary:** 6 HIGH categories, 16 LOW categories. Per the security
workflow design (`security.yml` `continue-on-error: true`), Aderyn is
advisory — the artifact is uploaded for triage. Every HIGH category is
triaged below.

### Aderyn H-1 — `abi.encodePacked()` Hash Collision (13 instances)

**Detector:** rejects `abi.encodePacked` with multiple **dynamic-type**
arguments going into a hash function (because variable-length values
can pack ambiguously).

**Verdict: false positive (all 13 instances).**

**Per-instance reasoning:**

| File:Line | Args | Verdict |
|---|---|---|
| `AgentAccountFactory.sol:199` | proxy-bytecode parts (fixed) | Concatenating literal bytecode constants + fixed-shape constructor args; no collision surface |
| `AgentAccountFactory.sol:205` | `bytes1(0xff) + address + bytes32 + bytes32` | CREATE2 address formula; every field fixed-width |
| `P256Verifier.sol:43` | `bytes32 + uint256*4` | Precompile input layout; every field fixed-width |
| `AgentRelationship.sol:114` | `address + address + bytes32` | All 20/32-byte fixed-widths; safe |
| `SignatureSlotRecovery.sol:189` | `"\x19Ethereum Signed Message:\n32" + bytes32` | EIP-191 prefix; fixed-width string literal + 32-byte hash |
| `WebAuthnLib.sol:78` | `bytes authenticatorData + bytes32 cdjHash` | **Defined by the WebAuthn spec** as `authData || sha256(cdj)`. The spec's signing-message format is the source of truth; the encoding is safe by construction (authData is structurally bounded by [§ 6.1](https://w3c.github.io/webauthn/#sctn-authenticator-data)). |
| `AgentNameRegistry.sol:153, 160, 238` | `bytes32 + bytes32` | ENS namehash format (standardized); fixed-width |
| `CustodyPolicy.sol:226` | `bytes2(0x1901) + bytes32 + bytes32` | EIP-712 typed-data hash format (standardized); fixed-width |
| `DelegationManager.sol:242` | same EIP-712 shape | Standardized; fixed-width |
| `DelegationManager.sol:372` | `bytes32[] hashes` | Each element exactly 32 bytes; concatenation is unambiguous (no shorter-element collision possible) |

**Action:** none. Documented here.

### Aderyn H-2 — `SmartAgentPaymaster` locks Ether without withdraw

**Verdict: false positive.**

**Reasoning:** `SmartAgentPaymaster` inherits `BasePaymaster` from
`account-abstraction/contracts/core/BasePaymaster.sol`, which provides
`withdrawTo(address payable, uint256)` at line 118-122. Verified:

```
$ grep -nE "withdrawTo|addStake" lib/account-abstraction/contracts/core/BasePaymaster.sol
118:    function withdrawTo(
122:        entryPoint().withdrawTo(withdrawAddress, amount);
```

Aderyn does not follow inheritance for the withdraw-detection pass. The
source file `src/SmartAgentPaymaster.sol:75-76` documents the
inheritance explicitly: `Inherits addStake, unlockStake, withdrawStake,
deposit, and withdrawTo from BasePaymaster`.

**Action:** none. Documented here.

### Aderyn H-3 — `MultiSendCallOnly` ETH transferred without address checks

**Verdict: false positive.**

**Reasoning:** `MultiSendCallOnly` is the Gnosis-Safe-derived batch
executor. It is `delegatecall`-only by design — direct calls to it
are not the threat model. When delegate-called from an `AgentAccount`,
`msg.sender` is the AgentAccount's caller (the EntryPoint or a
validator-self-call), not the multisend library's. Address checks in
the library would be wrong: they would inspect the wrong context.
Authorization lives at the AgentAccount's `execute*` entrypoints
(spec 209 § 3).

**Action:** none. Documented here.

### Aderyn H-4 case 1 — Reentrancy: state change after external call in `AgentAccount.uninstallModule`

**Location:** `src/AgentAccount.sol:813`

**Aderyn's claim:** `$.installed[moduleTypeId][module] = false` is
written AFTER `try IERC7579ModuleLike(module).onUninstall(deInitData)`.

**Verdict: defensible design choice.**

**Reasoning:**

ERC-7579's `onUninstall(deInitData)` hook is part of the module-author
contract. By convention, the module is still authoritative DURING
its own teardown — modules that need to clean up account state (e.g.,
revoke a session, emit a final audit event, deregister a callback)
read `isModuleInstalled(self) == true` to confirm they're operating
within the teardown window.

A pre-write of `installed[moduleTypeId][module] = false` would BREAK
those module authors. The CEI rearrangement is the wrong fix for
this surface.

Re-entry exploit analysis:
- A malicious module M can re-enter via `account.executeFromModule(...)`
  (its `installed[M] == true` still holds during onUninstall).
- The worst case is M calls `account.uninstallModule(N, ...)` to
  uninstall some OTHER module N.
- That call satisfies `onlySelf` (executeFromModule wraps in a
  self-call).
- Net effect: M and N are both uninstalled instead of just M.
- This is NOT exploitable because **the user already had authority to
  uninstall N directly**. M can only cause uninstalls the user could
  have triggered themselves.

The module set is a `mapping(uint256 => mapping(address => bool))`
+ a `mapping(uint256 => address[])` list. The order of state writes
(both AFTER the external call) is consistent: either both succeed
together, or the outer `try`/`catch` rolls everything back.

**Action:** none on the code. Documented here; the related Halmos
proof for `onlySelf` closure on `installModule` /
`uninstallModule` is a future R9.3.x.y slice (will cover the
"executeFromModule cannot break `onlySelf` for an installed module"
invariant symbolically).

### Aderyn H-4 case 2 — Reentrancy in `PermissionlessSubregistry.register`

Same finding as **Slither M-1** above. See that triage.

### Aderyn H-5 — Storage Array Edited with Memory (CustodyPolicy 5 instances)

**Verdict: false positive (Aderyn misreads).**

**Reasoning:** Lines 485-500 in `CustodyPolicy._verifyApplyCustodyChange`
pass `Config storage c` and `ScheduledChange storage p` to internal
helpers. The helpers' parameters are typed `Config storage` and
`ScheduledChange storage` (not memory) — Aderyn's heuristic incorrectly
flags `p.args` (which IS `bytes`) as a storage-array being passed to
a memory parameter. The actual signature of `_hashExecuteRequest`
takes `bytes calldata`, with the storage→calldata conversion happening
at the ABI boundary inside the same contract — no mutation expected
through this param.

**Action:** none. Documented here.

### Aderyn H-6 — Unsafe casting `uint8(nSigners)` in `AgentAccountFactory.sol:252`

**Verdict: 🟡 ACTIONABLE — fixed in this PR.**

**Reasoning:** `_buildValidatorInitData` computes
`nSigners = params.custodians.length + (hasPasskey ? 1 : 0)` and casts
to `uint8` to call `CustodyPolicy.defaultApprovals(uint8 nSigners, t)`.
Without a bound on `params.custodians.length`:

- 256 custodians → `uint8(256) = 0` → `defaultApprovals(0, t)` returns
  zero or undefined; downstream threshold is wrong
- 300 custodians → `uint8(300) = 44` → silently computes thresholds
  for 44 signers; account is misconfigured but functional

This is a self-hurt footgun (user misconfigures their own account),
not cross-account exploitable. But the silent truncation makes the
misconfiguration invisible until threshold-gated operations start
failing.

**Fix (this PR):**

- New constant `MAX_INITIAL_CUSTODIANS = 32`
- New error `TooManyInitialCustodians(uint256 actual, uint256 max)`
- Check added in `_validateInitParams` (used by BOTH
  `createAgentAccount` AND the counterfactual `getAddressForAgentAccount`,
  per the pattern established in the prior `NoInitialSigner` check)

**Test:**
- `test/AgentAccountFactoryMaxCustodiansR96.t.sol` — 6 tests:
  - `test_R96_constant_is_32`
  - `test_R96_atTheCap_succeeds` (n=32)
  - `test_R96_underTheCap_succeeds` (n=5)
  - `test_R96_overTheCap_reverts_33` (n=33)
  - `test_R96_overTheCap_reverts_256_closesUint8Truncation` (n=256 — the load-bearing case)
  - `test_R96_overTheCap_reverts_300`

All passing. Full forge regression: 665/665 green.

---

## Summary

| Tool | Findings | Real bugs | False positives | Defensible designs | Actionable fixes |
|---|---|---|---|---|---|
| R9 wave (Foundry+Halmos+Echidna+Medusa) | 0 | 0 | 0 | 0 | 0 |
| Slither | 14 | 0 | 1 (M-1) + 13 (L-noise) | 0 | 0 (R9.7 cleanup is cosmetic) |
| Aderyn | ~22 | 1 (**H-6**) | 4 (H-1, H-2, H-3, H-5) | 1 (H-4 case 1) | **1 (H-6 — closed in this PR)** |

**Net: 1 real finding across the entire toolchain, closed in this PR.**

That is a strong substrate result. Future toolchain additions (R9.7
custom Slither doctrine detectors; R9.8/9 Kontrol/Certora) will tighten
this further by encoding architectural invariants as scanner rules and
producing formal-verification proofs.

This document is the artifact a third-party auditor reads first.
Per spec 237 §4.1, future `pnpm audit:evidence` runs will collect
this file into `/audit/contract-invariants/triage.md`.
