# `ValueEnforcer` — Security & Architecture Audit

**Status:** shipped
**Last refreshed:** 2026-05-21
**Owners:** delegation package CODEOWNERS
**Registry entry:** [`docs/architecture/enforcer-registry/enforcers.json`](../../../../docs/architecture/enforcer-registry/enforcers.json) (entry: `ValueEnforcer`)
**Live address (Base Sepolia):** `0x49F0B31bf5228B1964dED8DC0F357f104cA74523`

## 1. Charter

Caps the native-token (`msg.value`) sent in a redemption to at most `maxValue` wei. Per-call, not cumulative. The redeemer cannot exceed — enforcer reverts.

Does NOT do: cumulative-across-redemptions value caps (DTK splits this into a separate enforcer; we don't have it yet — phase 8). Does not cover ERC-20 token amounts (those live in calldata; phase 6c.6 `ArgumentRuleEnforcer` covers them).

## 2. Security invariants

- `maxValue` is set at delegation creation, immutable.
- The redemption's `value` parameter is checked exactly: `require(value <= maxValue)`.
- `maxValue = 0` is permitted (no native-token transfers allowed via this delegation).
- The check has no slack / decimal logic — bare wei comparison.

## 3. Threat model

| Threat | Likelihood | Impact | Mitigation | Status |
| --- | --- | --- | --- | --- |
| Multiple redemptions add up to a value exceeding intent | High by design | High | Per-call only; the delegator MUST add a usage-counter caveat (planned RateLimitEnforcer) for cumulative caps | **Open: VE-1** — cumulative variant tracked as gap |
| Native-token forwarding from target to other recipients | Low | Medium | Out-of-scope here — the enforcer doesn't trace where the target sends the value. Use `AllowedTargetsEnforcer` to restrict who receives. | By design |
| `maxValue` set very high accidentally | Low | High | SDK lint should warn above 1 ETH; AgentAccount's `t3HighValueCeiling` provides a second backstop | **Open: VE-2** — lint pending |

## 4. DTK / smart-agent parity

**DTK:** `ValueLteEnforcer` + `NativeTokenLimitEnforcer` split. Our single `ValueEnforcer` matches `ValueLteEnforcer` semantically. We lack the cumulative variant — phase 8.

**smart-agent:** `ValueEnforcer.sol` — same shape.

## 5. Test posture

Forge tests: `packages/contracts/test/Enforcers.t.sol` covers value=maxValue / value<maxValue / value>maxValue / value=0 cases (4 tests).

## 6. Open findings

| ID | Severity | Finding | Status |
| --- | --- | --- | --- |
| VE-1 | P2 | No cumulative-value enforcer yet; intent leakage if delegator doesn't pair with RateLimitEnforcer. | Open (phase 8) |
| VE-2 | P3 | SDK lint warning for high `maxValue` (> 1 ETH) absent. | Open |

## 7. Cross-references

- [Registry entry](../../../../docs/architecture/enforcer-registry/enforcers.json)
- Spec 207 § 6 — T3 high-value gate that informs how T3 (value) delegations should always carry a ValueEnforcer.
- Phase 8 follow-up: cumulative-value variant.
