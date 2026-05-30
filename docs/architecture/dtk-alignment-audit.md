# MetaMask DTK alignment audit + caveat parity

**Status:** initial audit · 2026-05-21 (phase 6b)
**Owner:** delegation package CODEOWNERS
**Scope:** `@agenticprimitives/delegation` + `packages/contracts/src/{DelegationManager,enforcers}/`
**Compared against:** MetaMask Delegation Toolkit (DTK), ERC-7710, ERC-7715

## 1. Why this doc exists

agenticprimitives' delegation package is documented (`specs/202`) as "**ERC-7710-aligned but NOT the MetaMask Delegation Framework verbatim**." That hedge has been load-bearing for a year without a concrete inventory. This audit closes the gap:

- Which shapes are byte-identical with DTK (so DTK-shaped tooling can sign for our accounts)?
- Which shapes deliberately diverge + why?
- Which DTK caveats do we have an equivalent enforcer for, and which are gaps?
- What's the right migration path when adding a new caveat — port DTK's source, write fresh, or both?

If a future reviewer asks "are you compatible with MetaMask delegations?" the honest answer must come from this document.

## 2. Architectural alignment

### 2.1 Delegation struct

| Field | DTK | agenticprimitives | Match |
| --- | --- | --- | --- |
| `delegator` | `address` | `address` | ✓ |
| `delegate` | `address` | `address` | ✓ |
| `authority` | `bytes32` (parent hash; `0x0…ff…` = ROOT) | `bytes32` (parent hash; `ROOT_AUTHORITY` constant) | ✓ shape; sentinel constant differs |
| `caveats` | `Caveat[]` | `Caveat[]` | ✓ |
| `salt` | `uint256` | `uint256` | ✓ |
| `signature` | `bytes` | `bytes` | ✓ |

**Match: byte-identical.** A DTK delegation struct ABI-encodes the same way as ours. Off-chain tooling that constructs DTK delegations can target our `DelegationManager` if the `delegationManager` field in their EIP-712 domain matches our deployed address.

### 2.2 Caveat struct

| Field | DTK | agenticprimitives |
| --- | --- | --- |
| `enforcer` | `address` | `address` |
| `terms` | `bytes` (set at delegation creation) | `bytes` (set at delegation creation) |
| `args` | `bytes` (provided by redeemer at redemption time) | `bytes` (provided by redeemer at redemption time) |

**Match: byte-identical.** The terms/args split is the DTK pattern + we follow it for forwards-compatibility with their tooling.

### 2.3 EIP-712 hash

| | DTK | agenticprimitives |
| --- | --- | --- |
| Domain name | `"DelegationManager"` | `"agenticprimitives.DelegationManager"` |
| Domain version | `"1"` | `"1"` |
| `Delegation` typehash | `keccak256("Delegation(address delegator,address delegate,bytes32 authority,Caveat[] caveats,uint256 salt)Caveat(address enforcer,bytes terms,bytes args)")` | Same shape, our domain name |
| `Caveat` typehash | Same | Same |

**Divergence point**: our `name` field differs. A wallet signing a DTK-shape delegation against our DM will produce a sig that won't verify because the domain separator differs. Either:
- a wallet/tooling user explicitly sets `name = "agenticprimitives.DelegationManager"` when signing for our DM (manageable; the domain is just metadata)
- OR we ship an `IDelegationManager.legacyDtkHashDelegation(...)` helper that returns the hash with DTK's domain so wallets stuck on DTK defaults still work (NOT shipped; no consumer asking)

### 2.4 Redemption surface

| Function | DTK | agenticprimitives |
| --- | --- | --- |
| `redeemDelegations(bytes[] delegations, bytes32[] modes, bytes[] executionCallDatas)` (ERC-7710 opaque) | Yes | **NOT YET** — see § 5.1 |
| `redeemDelegation(Delegation[], target, value, data)` (typed; one execution) | Yes | Yes ✓ |
| `revokeDelegation(bytes32)` permissionless | Yes | Yes ✓ |
| `revokeDelegationByOwner(Delegation)` authenticated (phase A.5) | NO | Yes — our addition |
| `isRevoked(bytes32)` | Yes | Yes ✓ |

We ship the typed redeem; we don't ship the ERC-7710 opaque shape yet. Gap is low-priority for our demo because the SDK builds the typed form. **§ 5.1 documents the path to add it.**

## 3. Caveat enforcer parity

The single biggest divergence between agenticprimitives + DTK is caveat breadth. DTK ships ~15 enforcer contracts in their `delegation-framework` repo; we ship 5. The columns:

- **DTK** — name from `metamask/delegation-framework/contracts/enforcers/`.
- **us-contract** — corresponding Solidity enforcer at `packages/contracts/src/enforcers/`, or `—` if we don't have it.
- **us-sdk** — SDK builder at `packages/delegation/src/caveats.ts`, or `—` if we don't have it.
- **parity** — `match` / `partial` / `gap` / `divergent`.

| DTK enforcer | us-contract | us-sdk | Parity | Notes |
| --- | --- | --- | --- | --- |
| `AllowedTargetsEnforcer` | `AllowedTargetsEnforcer.sol` | `encodeAllowedTargetsTerms` | **match** | ERC-7710 standard. Bytecode is independent ports of the spec, not the DTK source. |
| `AllowedMethodsEnforcer` | `AllowedMethodsEnforcer.sol` | `encodeAllowedMethodsTerms` | **match** | Selector allowlist. |
| `AllowedCalldataEnforcer` | — | — | **gap** | DTK lets the delegator pin EXACT calldata. Argument-level caveats land in [spec 208](../../specs/208-argument-level-caveats.md). |
| `BlockNumberEnforcer` | — | — | gap | Mirror of TimestampEnforcer for block-number windows. Low priority — block.timestamp + clock-skew tolerance covers most use cases. |
| `TimestampEnforcer` | `TimestampEnforcer.sol` | `encodeTimestampTerms` | **match** | validAfter / validUntil window. |
| `ValueLteEnforcer` / `NativeTokenLimitEnforcer` | `ValueEnforcer.sol` | `encodeValueTerms` | **match** | Max wei per call. DTK splits into LTE-per-call vs cumulative; ours is per-call only. Cumulative is a follow-up (queued in spec 208). |
| `ERC20TransferAmountEnforcer` | — | — | gap | Per-call value gate for ERC-20 transfers. Argument-level (decodes call data). Spec 208 covers. |
| `ERC20BalanceChangeEnforcer` | — | — | gap | Post-call balance-delta check. Cross-call state — harder. Spec 208 v2 / phase 7+. |
| `ERC721BalanceChangeEnforcer` | — | — | gap | Same shape, NFTs. |
| `LimitedCallsEnforcer` | — | — | **gap (smart-agent has it)** | "N total calls" counter. smart-agent has `RateLimitEnforcer` we could port — see § 4. |
| `DeployedEnforcer` | — | — | gap | "Target must / must-not be deployed" check. Low priority. |
| `IdEnforcer` | — | — | gap | Single-use delegation via per-id flag. We use `salt` + `isRevoked` instead — equivalent in practice; the bookkeeping differs. |
| `ArgsEqualityCheckEnforcer` | — | — | gap | Redeemer's args must match what delegator committed. Niche; useful for replayable delegations with frozen params. |
| `ExactExecutionEnforcer` | — | — | gap | Locks the entire (target, value, data) tuple at delegation time. Equivalent to chaining Allowed* with calldata equality. Spec 208 territory. |
| — | `QuorumEnforcer.sol` | `buildQuorumCaveat` | **agenticprimitives-only** | n-of-m signature aggregation caveat. Shipped phase 6c.1. DTK has no equivalent — multi-sig is account-shape not delegation-shape in their framing. **This is a deliberate divergence**: spec 207 frames multi-sig as caveat-bearable so threshold-policy threads through delegations cleanly. |
| — | — | `DELEGATE_BINDING_ENFORCER` (sentinel) | **agenticprimitives-only**, SDK-only | Cross-delegation delegate binding. Sentinel address — no contract yet (legacy from smart-agent extraction). Enforcer contract pending phase H5. |
| — | — | `MCP_TOOL_SCOPE_ENFORCER` (sentinel) | smart-agent has contract; we don't | Restrict redemption to specific MCP tool calls. Enforcer in smart-agent: `McpToolScopeEnforcer.sol`. Not ported because spec 204 owns the MCP-tool classification surface SDK-side. |
| — | — | `DATA_SCOPE_ENFORCER` (sentinel) | smart-agent has contract; we don't | Data-scope gate (read/write classes). Enforcer in smart-agent: `DataScopeEnforcer.sol`. |

**Tally:**
- Match: 4 of ~14 DTK enforcers
- Gap (DTK has, we don't): 10
- agenticprimitives-only: QuorumEnforcer (+ 3 SDK sentinels with no on-chain enforcer yet)

## 4. Cross-reference with smart-agent

Per the [[mirror smart-agent patterns]] doctrine, gaps should be filled by porting from smart-agent first when possible. `/home/barb/smart-agent/packages/contracts/src/enforcers/` has these we don't:

| smart-agent enforcer | What it does | Migrate to agenticprimitives? |
| --- | --- | --- |
| `RateLimitEnforcer.sol` | N calls per time window | **Yes, phase 7** — clear use case (delegation + spending-cap pattern) |
| `AllocationLimitEnforcer.sol` | Multi-recipient cumulative cap | Niche; defer |
| `CallDataHashEnforcer.sol` | Pin calldata hash at delegation time | **Yes, spec 208** — covers DTK's `ExactExecutionEnforcer` use case with a simpler shape |
| `DataScopeEnforcer.sol` | Read/write data-scope class gate | Port if any consumer asks; not blocking |
| `McpToolScopeEnforcer.sol` | MCP tool allowlist | Tied to spec 204; port when first agent actually redeems via MCP path |
| `MembershipProofEnforcer.sol` | Merkle membership proof in caveat args | Spec 208 v2 |
| `NameScopeEnforcer.sol` | ENS/name-system scope | Defer; chain-specific |
| `PoolMandateEnforcer.sol` | Pool-specific mandate for spec 002 intent marketplace | NOT relevant to agenticprimitives' product scope |
| `QuorumEnforcer.sol` | n-of-m sig aggregation | **already ported** (6c.1) |
| `RecoveryEnforcer.sol` | Recovery-action gate | Conceptually overlaps spec 207 T6; defer to phase 7 recovery work |
| `RoundDecisionWindowEnforcer.sol` | Time-windowed decision rounds | Niche; defer |
| `StewardEligibilityEnforcer.sol` | Steward-role membership check | Spec 207 § 3 mentions stewards as a future signer role; defer to phase 7 |
| `TaskBindingEnforcer.sol` | Bind redemption to a specific task ID | Niche; spec 003 marketplace-specific |
| `TimestampEnforcer.sol` | Same as ours | already ported |
| `ValueEnforcer.sol` | Same as ours | already ported |

**Pragmatic backlog**:
1. **`CallDataHashEnforcer`** (smart-agent) + DTK-equivalent argument-level work → spec 208
2. **`RateLimitEnforcer`** (smart-agent) → phase 7
3. **`ERC20TransferAmountEnforcer`** (DTK pattern, no smart-agent equivalent) → spec 208
4. ERC-7710 opaque redemption surface → § 5.1
5. Domain-name alignment toggle → § 5.2 if any consumer asks

## 5. Specific divergence points + decisions

### 5.1 ERC-7710 opaque redemption — gap

DTK exposes:
```solidity
function redeemDelegations(
  bytes[] calldata delegations,    // each = abi.encode(Delegation)
  bytes32[] calldata modes,        // execution mode bitmap
  bytes[] calldata executionCallDatas
) external;
```

Standard for tooling that doesn't want to depend on the typed Delegation struct. We currently only expose the typed `redeemDelegation(Delegation[], target, value, data)`.

**Migration path**: thin wrapper on `DelegationManager`:
```solidity
function redeemDelegations(bytes[] calldata d, bytes32[] calldata modes, bytes[] calldata calls) external {
  // for now: only mode = CALLTYPE_SINGLE + EXECTYPE_DEFAULT supported
  require(d.length == calls.length && modes.length == 1, "unsupported mode");
  // decode each delegation chain + call typed redeem
  ...
}
```

~40 lines + tests. Low priority (no consumer asking) but cheap. Track as task #108 if anyone wants it.

### 5.2 EIP-712 domain name divergence — intentional

We use `name = "agenticprimitives.DelegationManager"` instead of DTK's `"DelegationManager"`. This means a wallet's "Sign delegation" prompt shows our name. Trade-off:

- ✗ DTK-shaped tooling expecting `"DelegationManager"` produces sigs that won't verify against us (they'd need to override the domain or set ours explicitly).
- ✓ User sees a clearly-branded source. Less confusion ("you're signing a delegation for THIS specific product").

**Decision**: keep the divergence. The vendor-namespaced domain is the right product posture. Any DTK-tooling consumer is on us to set `name` correctly when signing.

### 5.3 `revokeDelegationByOwner` — agenticprimitives addition

Phase A.5 added an authenticated-revoke path (caller must be delegator or delegate; sig-checked first). DTK's permissionless `revokeDelegation(bytes32)` is exposed too. The addition is purely a hardening — it doesn't break tooling that only knows DTK's surface.

### 5.4 `QuorumEnforcer` — agenticprimitives invention

DTK frames multi-sig as account-shape (gnosis-safe-style). We chose to additionally make it caveat-shape so the same delegation primitive carries threshold-policy ([spec 207 § 5](../../specs/207-smart-account-threshold-policy.md)). This is the [[multi-sig is integrated, not bolted-on]] doctrine. Deliberate divergence.

### 5.5 Sentinel-only SDK enforcers

`MCP_TOOL_SCOPE_ENFORCER`, `DATA_SCOPE_ENFORCER`, `DELEGATE_BINDING_ENFORCER` are sentinel addresses (`sentinelAddress('urn:smart-agent:…')`) — the SDK can build delegations referencing them but no on-chain contract exists at those addresses. Currently a **demo footgun**: redemption would call into a non-existent contract and revert. Either:
- ship the corresponding enforcer contracts (port from smart-agent)
- OR remove the sentinels until needed

**Decision**: remove from SDK exports as part of phase 7 cleanup. They confuse the surface ("why is this declared if I can't use it?"). When the corresponding contracts ship, re-add via real deployed addresses, not sentinels.

## 6. Wallet / tooling interop checklist

For a delegation issued through DTK tooling to verify on our DelegationManager:

| Check | What to set |
| --- | --- |
| Domain `name` | `"agenticprimitives.DelegationManager"` (not DTK's default) |
| Domain `version` | `"1"` |
| Domain `chainId` | Match the chain the DM is deployed on |
| Domain `verifyingContract` | Our DM address from `deployments-<network>.json` |
| Caveats reference enforcer addresses | Use the addresses in `deployments-<network>.json` (`{timestamp,allowedTargets,allowedMethods,value,quorum}Enforcer`); DTK-shipped enforcer addresses won't be deployed on our DM's chain |
| Sentinel sentinels (MCP/data-scope/delegate-binding) | Don't use — they'll revert at redemption |

The shape is fully compatible; only the metadata + address fields require deployer-aware substitution.

## 7. Open items + roadmap

| # | Item | Phase | Notes |
| --- | --- | --- | --- |
| 1 | Spec 208 — argument-level caveats | next | Covers DTK's `AllowedCalldataEnforcer`, `ArgsEqualityCheckEnforcer`, `ExactExecutionEnforcer`, `ERC20TransferAmountEnforcer` patterns at once. Biconomy-style predicate framework. |
| 2 | ERC-7710 opaque redemption surface | 7 | ~40 lines. No consumer asking; add when one does. |
| 3 | Strip sentinel-only SDK enforcers | 7 | Confusing surface. Don't ship sentinels — ship real addresses or nothing. |
| 4 | `RateLimitEnforcer` port from smart-agent | 7 | Common-enough use case. |
| 5 | `ERC20TransferAmountEnforcer` (DTK pattern) | 8 | Argument-level. Likely lands inside spec 208 framework rather than as its own enforcer. |
| 6 | DTK domain-name alignment toggle (legacy hash helper) | on-demand | Only if a consumer brings a wallet stuck on DTK defaults. |

## 8. Test posture

Currently no integration test in this repo exercises "DTK-shape delegation signed externally, redeemed against our DM." The 23 tests in `packages/delegation/test/` are all self-consistent (we issue + redeem). Phase 7 should add at least one wire-format fixture (a delegation produced by DTK tooling, hex-encoded, with our addresses substituted) that we successfully redeem — proves the shape is truly compatible.

## 9. Memories that intersect

- [[mirror smart-agent patterns]] — informs § 4 backlog ordering
- [[multi-sig is integrated, not bolted-on]] — explains the QuorumEnforcer divergence (§ 5.4)
- [[no third-party multi-sig]] — explains why we PORT DTK patterns rather than depend on their contracts
- [[ERC-7579 module architecture]] — DTK doesn't (yet) align with 7579; we do. Future tooling overlap will follow 7579 conventions, not DTK-specific ones.
