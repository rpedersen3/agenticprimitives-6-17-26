# `TimestampEnforcer` — Security & Architecture Audit

**Status:** shipped
**Last refreshed:** 2026-05-21
**Owners:** delegation package CODEOWNERS
**Registry entry:** [`docs/architecture/enforcer-registry/enforcers.json`](../../../../docs/architecture/enforcer-registry/enforcers.json) (entry: `TimestampEnforcer`)
**Live address (Base Sepolia):** `0x81AB5167ccEfD6a2cD7C95baFE27a120A94F37f0`

## 1. Charter

`TimestampEnforcer` constrains a delegation to a `[validAfter, validUntil]` window using `block.timestamp` at the redemption call. Both bounds are inclusive; either can be `0` (meaning "no bound on this side"). A delegation with both bounds 0 has no time constraint.

Does NOT do: block-number windows (DTK has a separate `BlockNumberEnforcer`; we don't), wall-clock reasoning, time-of-day patterns. All time questions resolve to "what does `block.timestamp` say at redeem time."

## 2. Security invariants

- The redeemer cannot widen the window. `terms` is set at delegation creation; `args` is ignored.
- `block.timestamp` clock skew across nodes is bounded to ~15s on most L1/L2; the enforcer applies no slack — callers should NOT issue delegations with tightly-bounded windows < 1 minute apart.
- `validAfter == 0` is permitted (the delegation is valid immediately on creation).
- `validUntil == 0` is permitted (the delegation has no expiry — useful for never-expiring roles, dangerous if accidental).

## 3. Threat model

| Threat | Likelihood | Impact | Mitigation | Status |
| --- | --- | --- | --- | --- |
| Block timestamp manipulation by miner | Low (L2 sequencer-controlled) | Low (~1-15s drift) | Spec doc warns against sub-minute windows | Documented |
| Delegation issued with `validUntil = 0` by accident | Medium | High (never-expires) | SDK lint should warn on `0` validUntil | **Open: TE-1** — lint not yet implemented |
| Multi-redemption inside the window | High by design | None (this is the design) | The TimestampEnforcer alone doesn't limit count; pair with a usage-counting enforcer if needed | By design |

## 4. DTK / smart-agent parity

**DTK:** `TimestampEnforcer` — same name, same semantics. Independent port of the ERC-7710 spec, not the DTK source. Wire-format compatible — a DTK-tooled delegation with this caveat verifies against our enforcer at our deployed address.

**smart-agent:** `TimestampEnforcer.sol` — same. agenticprimitives ports the contract directly.

## 5. Test posture

Forge tests: `apps/contracts/test/Enforcers.t.sol` covers the validAfter / validUntil / 0-bound / equal-bound cases (4 tests). No property tests yet.

## 6. Open findings

| ID | Severity | Finding | Status |
| --- | --- | --- | --- |
| TE-1 | P3 | SDK lint should warn on `validUntil = 0` (never-expires) when not paired with a revocable-by-owner flag. | Open |

## 7. Cross-references

- [Registry entry](../../../../docs/architecture/enforcer-registry/enforcers.json) (search: `TimestampEnforcer`)
- [`packages/delegation/AUDIT.md`](../../../../packages/delegation/AUDIT.md) — consumer of this enforcer.
- [`docs/architecture/dtk-alignment-audit.md`](../../../../docs/architecture/dtk-alignment-audit.md) § 3 — parity verdict.
