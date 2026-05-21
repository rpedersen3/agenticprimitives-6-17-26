# `AllowedMethodsEnforcer` — Security & Architecture Audit

**Status:** shipped
**Last refreshed:** 2026-05-21
**Owners:** delegation package CODEOWNERS
**Registry entry:** [`docs/architecture/enforcer-registry/enforcers.json`](../../../../docs/architecture/enforcer-registry/enforcers.json) (entry: `AllowedMethodsEnforcer`)
**Live address (Base Sepolia):** `0xdE873dEa2EdC4288FEB32Ade7fDdA798983289c0`

## 1. Charter

Constrains the redemption to a function-selector allowlist (`bytes4`). The selector is the first 4 bytes of the redemption's `data` parameter (calldata). The redeemer cannot escape — the enforcer reverts if the selector is not in the list.

Does NOT do: target-address scoping (`AllowedTargetsEnforcer`), per-argument scoping (`ArgumentRuleEnforcer`, phase 6c.6).

## 2. Security invariants

- The allowlist is fixed in `terms` at delegation creation.
- Selectors are 4 bytes; the enforcer reads `data[0:4]` exactly. Calldata shorter than 4 bytes is rejected.
- Empty allowlist is rejected at validation time.
- The enforcer DOES NOT check that the selector corresponds to a real function on the target. A delegator allowlisting selector `0xdeadbeef` for target `T` would grant that call regardless of whether `T` implements anything at that selector — `T` would simply revert at call time. This is correct behavior; the enforcer's job is bounding, not validating.

## 3. Threat model

| Threat | Likelihood | Impact | Mitigation | Status |
| --- | --- | --- | --- | --- |
| Selector collision (two different ABIs share a selector) | Medium | Medium | Selectors are 4-byte truncations of keccak; collisions are possible. Spec 208 doc recommends pairing with `ArgumentRuleEnforcer` for value-moving calls so the FULL signature is bound. | Documented |
| Allowlist-bypass via fallback functions | Medium | High | Selector check is on calldata, not on what the target's fallback does. Pair with `AllowedTargetsEnforcer` so the target is a known contract. | Documented |
| Gas DoS from large allowlist | Low | Low | SDK lint warns above 16 entries. | **Open: AM-1** |

## 4. DTK / smart-agent parity

**DTK:** `AllowedMethodsEnforcer` — byte-identical shape.

**smart-agent:** `AllowedMethodsEnforcer.sol` — same.

## 5. Test posture

Forge tests: `apps/contracts/test/Enforcers.t.sol` covers single-selector / multi / empty / short-calldata cases (4 tests).

## 6. Open findings

| ID | Severity | Finding | Status |
| --- | --- | --- | --- |
| AM-1 | P3 | Add SDK lint warning above 16 selectors. | Open |
| AM-2 | P2 | Document the "pair with `AllowedTargetsEnforcer`" pattern as a hard recommendation; consider linting against AllowedMethodsEnforcer used alone. | Open |

## 7. Cross-references

- [Registry entry](../../../../docs/architecture/enforcer-registry/enforcers.json)
- Companion: [`AllowedTargetsEnforcer.AUDIT.md`](./AllowedTargetsEnforcer.AUDIT.md)
- Subsumes-in-future: [`specs/208-argument-level-caveats.md`](../../../../specs/208-argument-level-caveats.md) — ArgumentRuleEnforcer's per-rule `selector` field overlaps with this enforcer's allowlist. Both stay shipped; ArgumentRule is for cases needing per-arg gates.
