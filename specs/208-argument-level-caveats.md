# Spec 208 — Argument-level caveat policies

**Status:** draft · 2026-05-21
**Closes:** the largest cluster of caveat gaps named in [`docs/architecture/dtk-alignment-audit.md`](../docs/architecture/dtk-alignment-audit.md) § 3 (DTK's `AllowedCalldataEnforcer`, `ArgsEqualityCheckEnforcer`, `ExactExecutionEnforcer`, `ERC20TransferAmountEnforcer` — all argument-level).
**Builds on:** spec 202 (`delegation` core), spec 204 (`tool-policy` risk tiers), spec 207 (threshold-policy product surface).
**Reference: smart-agent patterns to port:**
- `packages/contracts/src/enforcers/CallDataHashEnforcer.sol` — the simplest precursor (whole-calldata hash equality; no per-arg decoding). Direct port to agenticprimitives is the v0 cut.
- `packages/contracts/src/enforcers/PoolMandateEnforcer.sol` — has rule-list iteration patterns we can mirror for the multi-rule shape, but the pool-specific semantics are NOT relevant; port the iteration shape only.
- Smart-agent does NOT have a Biconomy-style per-argument predicate system; this spec is a deliberate extension.
**Reference: external patterns to port:** Biconomy V2 Modular Permissions (per-arg operators + per-call usage limits), MetaMask DTK's `AllowedCalldataEnforcer` (calldata equality), MetaMask DTK's `ERC20TransferAmountEnforcer` (decode-and-check).

> **Doctrine: "Allow agent to call X" is not enough — production needs "Allow agent to call USDC.transfer to allowlist, ≤ 100 USDC per call."** Caveats today operate at the call boundary (target + selector). For any value-moving delegation to be safe, caveats must reach into the calldata. This spec is the framework that makes that possible without ad-hoc enforcers per contract.

---

## 1. Goal

Define a deterministic, on-chain-enforceable mechanism for **per-argument predicates** in caveats. The result is a single new enforcer contract — `ArgumentRuleEnforcer` — whose `terms` blob encodes a rule set, where each rule pins:

- target address
- function selector
- per-argument predicates (operator + comparator)
- optional per-rule usage budget (calls remaining)

When the delegator says "agent can call `0xUSDC.transfer(recipient, amount)` where `recipient ∈ allowlist` and `amount ≤ 100e6`," that intent becomes one `ArgumentRule` inside one caveat. No new contract per rule — the enforcer is general.

Non-goals for v0:
- Cross-call state (e.g. "total spent over 24h" — needs the rate-limit family; phase 7).
- Predicates over storage reads (e.g. "only if my balance > X" — phase 7+).
- ERC-20 balance-delta enforcement (DTK's `ERC20BalanceChangeEnforcer` — phase 8).

---

## 2. Domain model

```text
ArgumentRule {
  target:       address                    // contract being called
  selector:     bytes4                     // first 4 bytes of calldata
  argRules:     ArgumentPredicate[]        // per-positional-arg predicates
  maxUses:      uint256                    // 0 = unlimited; 1+ = remaining budget
}

ArgumentPredicate {
  argIndex:     uint8                      // 0-indexed position in the call's args
  argType:      ArgType                    // ADDRESS, UINT256, BOOL, BYTES32, BYTES_HASH
  op:           Op                         // EQ, NEQ, LT, LTE, GT, GTE, IN
  value:        bytes                      // ABI-encoded comparator (depends on op + type)
}

Op:  EQ | NEQ | LT | LTE | GT | GTE | IN

ArgType:
  ADDRESS     — single 32-byte word, low 20 bytes (uses Op.EQ, NEQ, IN)
  UINT256     — single 32-byte word (uses Op.EQ, NEQ, LT, LTE, GT, GTE)
  BOOL        — single byte (uses Op.EQ, NEQ)
  BYTES32     — exact 32-byte value (uses Op.EQ, NEQ)
  BYTES_HASH  — keccak256(arg) compared against value (for dynamic types
                like bytes / string; uses Op.EQ, NEQ)
```

A `RuleSet` is `ArgumentRule[]` — the caveat's `terms`. **First-match-wins**: when a redemption arrives, the enforcer scans rules in order; the first whose (target, selector) matches must pass its argRules. If no rule matches, the call is denied.

This is intentionally restrictive. Disjunction over different (target, selector) pairs is built in (the rule list); disjunction across DIFFERENT predicates for the same call is NOT. If you want "amount ≤ 100 OR recipient = treasury," issue two delegations with different rules. Auditability wins over flexibility.

---

## 3. Encoding

`Caveat.terms` for `ArgumentRuleEnforcer`:

```solidity
abi.encode(ArgumentRule[]) where ArgumentRule struct above
```

Solidity:

```solidity
struct ArgumentPredicate {
    uint8 argIndex;
    uint8 argType;        // ArgType as uint8 (0=ADDRESS, 1=UINT256, …)
    uint8 op;             // Op as uint8 (0=EQ, …)
    bytes value;          // length-prefixed; meaning depends on (argType, op)
}

struct ArgumentRule {
    address target;
    bytes4 selector;
    ArgumentPredicate[] argRules;
    uint256 maxUses;      // 0 = unlimited
}
```

`Caveat.args` is empty for v0 (`hex"00"`). Future versions could use it to pass per-redemption witnesses (e.g. "the actual recipient address" if the rule wants to check it against a Merkle root).

### 3.1 Op-specific `value` shapes

| Op | argType | value bytes | Meaning |
| --- | --- | --- | --- |
| EQ / NEQ | ADDRESS | 20 bytes | exact match |
| EQ / NEQ | UINT256 | 32 bytes | exact match |
| EQ / NEQ | BOOL | 1 byte | exact match |
| EQ / NEQ | BYTES32 | 32 bytes | exact match |
| EQ / NEQ | BYTES_HASH | 32 bytes | keccak256(arg) == value |
| LT / LTE / GT / GTE | UINT256 | 32 bytes | numerical comparison |
| IN | ADDRESS | `abi.encode(address[])` | allowlist (sorted-ascending preferred for binary search) |
| IN | UINT256 | `abi.encode(uint256[])` | allowlist |
| IN | BYTES32 | `abi.encode(bytes32[])` | allowlist |

`IN` is the most expensive predicate — linear scan over the array. Cap at 64 entries per rule for v0 (gas-bound) + revert if exceeded.

---

## 4. Enforcer contract

```solidity
contract ArgumentRuleEnforcer is CaveatEnforcerBase {
    // Per-(delegation, rule) usage counter.
    mapping(bytes32 => mapping(uint256 => uint256)) public used;

    error NoMatchingRule(address target, bytes4 selector);
    error PredicateFailed(uint256 ruleIndex, uint8 argIndex, uint8 op);
    error UsageExhausted(uint256 ruleIndex);
    error InvalidEncoding();

    function beforeHook(
        bytes calldata terms,
        bytes calldata args,            // unused in v0
        bytes32 delegationHash,
        bytes calldata calldataPayload, // (target, value, data) abi-encoded
        address /* redeemer */,
        address /* delegator */
    ) external override {
        (address target, , bytes memory data) =
            abi.decode(calldataPayload, (address, uint256, bytes));
        if (data.length < 4) revert InvalidEncoding();
        bytes4 selector = bytes4(data[0:4]);

        ArgumentRule[] memory rules = abi.decode(terms, (ArgumentRule[]));
        for (uint256 i; i < rules.length; i++) {
            if (rules[i].target != target) continue;
            if (rules[i].selector != selector) continue;
            // First match wins. Validate this rule; if it passes, increment
            // usage + return. If it fails, REVERT (don't fall through to
            // a later rule — first-match-wins is the audit story).
            _checkPredicates(rules[i], data, i);
            if (rules[i].maxUses > 0) {
                uint256 prior = used[delegationHash][i];
                if (prior >= rules[i].maxUses) revert UsageExhausted(i);
                used[delegationHash][i] = prior + 1;
            }
            return;
        }
        revert NoMatchingRule(target, selector);
    }

    function _checkPredicates(ArgumentRule memory r, bytes memory data, uint256 ri) internal pure {
        // data layout: [selector (4)] [arg0 (32)] [arg1 (32)] ... [dynamic tails]
        for (uint256 j; j < r.argRules.length; j++) {
            ArgumentPredicate memory p = r.argRules[j];
            bytes32 word = _wordAt(data, 4 + uint256(p.argIndex) * 32);
            if (!_check(p, word, data)) revert PredicateFailed(ri, p.argIndex, p.op);
        }
    }

    function _check(ArgumentPredicate memory p, bytes32 word, bytes memory data) internal pure returns (bool) {
        // Op switch on argType.
        if (p.argType == 0 /* ADDRESS */) return _checkAddress(p, address(uint160(uint256(word))));
        if (p.argType == 1 /* UINT256 */) return _checkUint(p, uint256(word));
        if (p.argType == 2 /* BOOL */)    return _checkBool(p, uint256(word) != 0);
        if (p.argType == 3 /* BYTES32 */) return _checkBytes32(p, word);
        if (p.argType == 4 /* BYTES_HASH */) return _checkBytesHash(p, word, data);
        return false;
    }
    // ... per-type checkers
}
```

Code-size budget: ~3 KB. Well under EIP-170. The first-match-wins loop is O(R) where R = rules.length; predicates are O(A) per rule. For typical use (1-3 rules, 1-3 args each), ~10k gas total.

---

## 5. Worked examples

### 5.1 USDC.transfer with allowlist + cap

Delegator authorizes: "Agent can send USDC to {treasury, payroll} up to 100 USDC per call, max 50 calls."

```ts
const usdc      = '0x...';
const treasury  = '0x...';
const payroll   = '0x...';
const maxAmount = 100_000000n; // 100 USDC (6 decimals)

const rule: ArgumentRule = {
  target:   usdc,
  selector: '0xa9059cbb', // transfer(address,uint256)
  argRules: [
    {
      argIndex: 0, argType: ADDRESS, op: IN,
      value: encodeAbiParameters([{ type: 'address[]' }], [[treasury, payroll]]),
    },
    {
      argIndex: 1, argType: UINT256, op: LTE,
      value: encodeAbiParameters([{ type: 'uint256' }], [maxAmount]),
    },
  ],
  maxUses: 50n,
};

const caveat = buildCaveat(
  ARGUMENT_RULE_ENFORCER, // deployed address
  encodeAbiParameters([{ type: 'tuple[]', components: [...] }], [[rule]]),
);
```

The agent attempting `USDC.transfer(attacker, 1_000_000000)` reverts: first rule's selector matches, predicates check, recipient NOT IN allowlist → `PredicateFailed(0, 0, IN)`.

### 5.2 Multi-call delegation

"Agent can call USDC.transfer to treasury (rule A) AND can call USDC.approve to a specific spender (rule B)."

```ts
const rules: ArgumentRule[] = [
  { target: usdc, selector: TRANSFER_SELECTOR, argRules: [...], maxUses: 0n },
  { target: usdc, selector: APPROVE_SELECTOR,  argRules: [...], maxUses: 5n },
];
const caveat = buildCaveat(ARGUMENT_RULE_ENFORCER, abi.encode(rules));
```

A call to `transfer` matches rule[0]; a call to `approve` matches rule[1]; anything else reverts `NoMatchingRule`.

### 5.3 Replacement for DTK's `AllowedCalldataEnforcer`

DTK's enforcer says "exact calldata required." This spec's equivalent:

```ts
const rule: ArgumentRule = {
  target: someContract,
  selector: someSelector,
  argRules: [
    { argIndex: 0, argType: BYTES_HASH, op: EQ, value: expectedArg0Hash },
    // ... for each arg
  ],
  maxUses: 0n,
};
```

OR, if the call is fully static, use `EQ` on each typed arg. Either way the result is "this specific call shape, nothing else."

### 5.4 Replacement for DTK's `ERC20TransferAmountEnforcer`

DTK ships a specific enforcer for ERC-20 amount checks. This spec subsumes it with one general enforcer + the rule from § 5.1.

---

## 6. SDK surface (additions to `packages/delegation`)

```ts
// In packages/delegation/src/caveats.ts
export const ARGUMENT_RULE_ENFORCER: Address = ...; // from deployments JSON

export type ArgType = 'address' | 'uint256' | 'bool' | 'bytes32' | 'bytes-hash';
export type Op = 'eq' | 'neq' | 'lt' | 'lte' | 'gt' | 'gte' | 'in';

export interface ArgumentPredicate {
  argIndex: number;
  argType: ArgType;
  op: Op;
  value: Hex;
}

export interface ArgumentRule {
  target: Address;
  selector: Hex;
  argRules: ArgumentPredicate[];
  maxUses: bigint;
}

export function buildArgumentRuleCaveat(rules: ArgumentRule[]): Caveat;

// Higher-level helpers for the common patterns:
export function ruleErc20Transfer(opts: {
  token: Address;
  recipients: Address[];      // empty = no allowlist
  maxAmount?: bigint;         // omit for no cap
  maxUses?: bigint;
}): ArgumentRule;

export function ruleErc20Approve(opts: {
  token: Address;
  spenders: Address[];
  maxAllowance?: bigint;
  maxUses?: bigint;
}): ArgumentRule;
```

`buildArgumentRuleCaveat` encodes the array; the typed helpers (`ruleErc20Transfer`, `ruleErc20Approve`) are pure-TS sugar over the raw rule shape so callers don't compute selectors + ABI-encode by hand.

---

## 7. Threat model + invariants

| Threat | Mitigation |
| --- | --- |
| Calldata tail can be padded with attacker bytes after the args | Enforcer reads only the documented arg slots (`4 + i*32`). Tail data is ignored — same as DTK. |
| Dynamic arg passed by reference (offset/length) | v0 supports `BYTES_HASH` for hash equality. Real dynamic decoding (per-byte arg checks) is phase 8 — needs a proper ABI decoder library and more gas. |
| Rule order matters; admin sets misordered rules | Documented: first-match-wins. SDK enforces sorted (target, selector) by lint warning. |
| Usage counter under-decremented by failed tx | Counter increments only AFTER predicates pass. Failed predicate reverts before increment. |
| Re-entrancy through enforcer → target → enforcer | Enforcer state is per-(delegation, rule); a re-entrant call lands on a DIFFERENT delegationHash. No state cross-contamination. |
| `maxUses` overflow | uint256 wrap is impossible in practice; explicit overflow check not added (Solidity ≥0.8). |
| Allowlist size attack (large `IN` array) | Hard cap 64 entries; revert above. SDK lints. |
| Stuck delegation (usage exhausted) | Documented behavior: re-issue a fresh delegation with the same rule + new salt. |

---

## 8. Phase plan

| Phase | What lands | Status |
| --- | --- | --- |
| **6c.6** (or 7a) | `ArgumentRuleEnforcer.sol` + Forge tests (10-15) + SDK builders (`buildArgumentRuleCaveat`, `ruleErc20Transfer`, `ruleErc20Approve`) + deploy script update | pending |
| 7b | demo-web-pro flow: "Permission card preview" — user enters a target + selector + per-arg rules and sees the resulting delegation rendered as a permission card | pending |
| 7c | demo-mcp integration: `withDelegation` consults this enforcer at redeem | pending — needs the on-chain redeem path lit up |
| 8a | Dynamic argument decoding (full ABI awareness) | post-v0 |
| 8b | Cross-call state caveats (cumulative spend, rate limits) | post-v0 |

---

## 9. Open questions

- **`IN` operator scale.** 64 entries hard cap for v0 is conservative; gas cost is `~3000 + 200*N`. Should we add a Merkle-root variant (`IN_MERKLE`) for larger allowlists? Probably yes; phase 8.
- **Predicate composition within a rule.** Today rules are AND-only across argRules. Do we need OR within a rule? (Probably no — if you need "amount ≤ 100 OR recipient = treasury," that's two rules in the rule set; first-match-wins still gives the right semantics.)
- **Calldata signature collisions.** Two different ABIs can share a selector. Should the rule additionally pin the ABI signature hash? (Trade-off: pin = safer; not-pin = caveat smaller. Default v0: don't pin. Note the risk; consumers can additionally bind via BYTES_HASH on a known-deterministic arg encoding.)
- **Storage cost.** `used[delegationHash][ruleIdx]` SSTOREs cost gas. For high-usage delegations the SLOAD becomes the bottleneck. Acceptable for v0; phase 8 might add a SSTORE2-backed batched approach.

---

## 10. Resolved decisions

- Operator set: `EQ, NEQ, LT, LTE, GT, GTE, IN` (no `OUT_OF`, derive as `NEQ` or `NOT IN`-via-multi-rule).
- argType set: `ADDRESS, UINT256, BOOL, BYTES32, BYTES_HASH` — covers ~90% of ERC-20 / ERC-721 / agent-tool ABI surfaces.
- Rule selection: **first-match-wins**. Auditable: a permission card can show "this delegation permits exactly these N call shapes, in this order."
- Single enforcer (NOT a contract per rule type). Spec 207 § 12 doctrine: "we ship our own primitives" — but generality wins over enforcer proliferation when the gas + audit cost is reasonable.
- `Caveat.args` empty in v0 — keeps the redemption path tight. Reserved for future witness-passing.

---

## 11. Cross-references

- [`docs/architecture/dtk-alignment-audit.md`](../docs/architecture/dtk-alignment-audit.md) § 3 + § 7 — names the DTK enforcers this spec subsumes.
- [`specs/202-delegation.md`](./202-delegation.md) — core delegation lifecycle this enforcer plugs into.
- [`specs/204-tool-policy.md`](./204-tool-policy.md) — risk tiers. T3 (Value) actions almost always want argument-level caveats. The SDK should require `ArgumentRuleEnforcer` caveats on any delegation classified T3 or higher (linted, not enforced).
- [`specs/207-smart-account-threshold-policy.md`](./207-smart-account-threshold-policy.md) § 5 — risk-tier table that informs WHICH delegations should carry argument-level rules.
- Memories: [[multisig-is-safety-and-recovery]] (permission UX as security — argument rules are the security layer behind that UX), [[mirror smart-agent patterns]] (port `CallDataHashEnforcer` shape, not contents).
