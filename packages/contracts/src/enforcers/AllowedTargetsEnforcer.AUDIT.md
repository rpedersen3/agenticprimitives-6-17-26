# `AllowedTargetsEnforcer` — Security & Architecture Audit

**Status:** shipped
**Last refreshed:** 2026-05-21
**Owners:** delegation package CODEOWNERS
**Registry entry:** [`docs/architecture/enforcer-registry/enforcers.json`](../../../../docs/architecture/enforcer-registry/enforcers.json) (entry: `AllowedTargetsEnforcer`)
**Live address (Base Sepolia):** `0x4D00295D51962a9E81Dada0b90FeA49567863dC5`

## 1. Charter

Constrains the redemption `target` address to an allowlist set at delegation creation. The redeemer cannot escape — the enforcer reverts if `target` is not in the list.

Does NOT do: per-method scoping (use `AllowedMethodsEnforcer` for that), per-arg scoping (phase 6c.6 ships `ArgumentRuleEnforcer` for argument-level checks).

## 2. Security invariants

- The allowlist is encoded in `terms` at delegation creation. Redeemer cannot widen it via `args`.
- The check is an exact `==` per entry. No CREATE2 prediction, no factory pattern, no proxy unwrap — the deployed address at redeem time IS the address checked.
- Empty allowlist is rejected at validation time (would be a useless delegation).
- The allowlist is a `bytes` blob decoded as `address[]`; on-chain we walk it linearly.

## 3. Threat model

| Threat | Likelihood | Impact | Mitigation | Status |
| --- | --- | --- | --- | --- |
| Allowlist-bypass via proxy or fallback to forwarder | Medium | High | Out-of-scope here — the redemption target is a STATIC address; if the target itself is a proxy, the delegator must understand what they're allowlisting | By design (documented) |
| Allowlist size DoS (gas exhaustion) | Low | Low | Linear scan; SDK lint warns above 32 entries; on-chain enforces no hard cap (gas naturally limits it) | **Open: AT-1** — formal cap recommendation pending |
| Address checksum mistakes in terms | Low (caught off-chain) | High (wrong allowlist) | viem auto-checksums; SDK validates each entry as a valid 20-byte address | Covered |

## 4. DTK / smart-agent parity

**DTK:** `AllowedTargetsEnforcer` — byte-identical shape. Independent port.

**smart-agent:** `AllowedTargetsEnforcer.sol` — same.

## 5. Test posture

Forge tests: `packages/contracts/test/Enforcers.t.sol` — single-target / multi-target / empty / mismatch cases (4 tests).

## 6. Open findings

| ID | Severity | Finding | Status |
| --- | --- | --- | --- |
| AT-1 | P3 | Add a soft cap (32 entries) + lint warning at the SDK layer; on-chain enforces no hard cap. | Open |

## 7. Cross-references

- [Registry entry](../../../../docs/architecture/enforcer-registry/enforcers.json)
- Companion enforcer: [`AllowedMethodsEnforcer.AUDIT.md`](./AllowedMethodsEnforcer.AUDIT.md) — typical pairing for "target T, method M only."
