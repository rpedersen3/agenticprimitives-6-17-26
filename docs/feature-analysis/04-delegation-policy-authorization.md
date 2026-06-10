# 04 — Delegation, policy & fine-grained authorization

**Focus area:** who-can-do-what under which policy — spanning web2 authorization engines (Zanzibar/policy-as-code) and web3 delegation/session-key systems.
**AP packages in scope:** `delegation`, `tool-policy`, `contracts` (`DelegationManager.sol`, caveat enforcers, `QuorumEnforcer`).
**AP capability today:** ERC-7710-style EIP-712 delegation chains; caveat enforcers (value, allowed-methods, allowed-targets, timestamp, calldata-hash, quorum); leaf-delegate binding; JTI replay protection on session tokens; ERC-1271 verification; on-chain redemption through `DelegationManager`.
**Known gaps (from contract audits):** caveat caps are per-call not cumulative (no stateful budget enforcer); quorum/approved-hash signatures lack a nonce (identical-call replay); session-delegation binding is optional in some verifiers (the P0 mandatory-binding gap).

> Gap layers: `[Contracts]` Solidity surface · `[SDK]` TS packages/backends · `[UX]` product surface (**deferred**). See [index](index.md#gap-layers-every-gap-is-classified-into-exactly-one).

---

## Category verdict at a glance

| Product | Type | Tags | Verdict |
| --- | --- | --- | --- |
| MetaMask Advanced Permissions / ERC-7715 | Ecosystem standard | DELEG POLICY AA | **Partner / interop** (see also 02) |
| Safe Roles / Zodiac | OSS | POLICY DELEG TREASURY | Adopt patterns (call-level constraints) |
| Lit Auth / Lit Actions permissions | Open network | POLICY DELEG CUSTODY | Integrate (code-hash-bound signing; see 03) |
| OpenFGA | OSS/commercial | POLICY DIR | **Integrate** (relationship policy adapter) |
| Authzed / SpiceDB | OSS/commercial | POLICY DIR | Adopt patterns / integrate option |
| Cerbos | OSS/commercial | POLICY AUDIT | **Adopt patterns** (policy-as-code, decision logs) |
| Oso | Commercial/libs | POLICY | Adopt patterns (app-layer modeling) |
| Permit.io | Commercial | POLICY AUDIT | Adopt patterns (no-code policy admin) |
| AWS Verified Permissions / Cedar | Commercial / OSS lang | POLICY AUDIT | Adopt patterns (formal policy language) |

---

## Deep dives — primary overlap products

### MetaMask Advanced Permissions / ERC-7715 — partner / interop

- **Feature inventory:** standardized permission-request protocol — a dapp requests a scoped capability (spend X/day, call contract Y) and the wallet grants a delegation the dapp later redeems. Pairs with ERC-7710 redemption.
- **Overlap with AP:** AP's delegation + caveat model is the same shape; AP enforcers ≈ 7715 permission scopes.
- **AP lacks:**
  - `[Contracts]` 7715-compatible permission/scope encoding so third-party contracts recognize AP grants.
  - `[SDK]` the permission-*request* half of the protocol (request builder/parser, standard permission vocabulary).
  - `[UX]` (deferred) wallet-rendered consent screens.
- **They lack:**
  - `[Contracts]` custody tiers.
  - `[SDK]` delegation that extends to MCP/A2A tool calls and off-chain resources; audit evidence.
- **Verdict:** interop is the highest-leverage move (mirrors FG-STD-1). Make AP grants expressible as 7715 requests and AP enforcers map to 7715 scopes.

### Cerbos — adopt patterns (policy-as-code + decision logs)

- **Feature inventory:** stateless policy decision point; policies as version-controlled YAML; RBAC + ABAC; per-decision audit logs; policy testing harness; policy playground/simulation.
- **Overlap with AP:** `tool-policy` is conceptually a policy engine; caveat enforcers are policy predicates.
- **AP lacks:**
  - `[SDK]` **policy simulation + testable policy bundles** (run a policy against scenarios before deploy); structured decision logs ("granted/denied because rule R"); a policy-authoring format separate from Solidity enforcers / TS builders.
- **Cerbos lacks:**
  - `[Contracts]` on-chain enforcement, cryptographic delegation, agent identity.
- **Verdict:** adopt the policy-as-code + decision-log + simulation patterns for `tool-policy`. Pairs with custody policy simulation (FG-SEC-5).

### OpenFGA — integrate (relationship-based access)

- **Feature inventory:** Google-Zanzibar-style relationship tuples (`user:alice is editor of doc:1`), authorization API, consistency model, schema language.
- **Overlap with AP:** `identity-directory` org permissions; `agent-relationships` edges ≈ relationship tuples.
- **AP lacks:**
  - `[SDK]` a scalable off-chain relationship/permission graph for org directories and resource sharing — AP relationships are on-chain edges, not a queryable ReBAC engine.
- **OpenFGA lacks:**
  - `[Contracts]` cryptographic authority (tuples are DB rows, not signed grants); on-chain enforcement; agent identity.
- **Verdict:** integrate an OpenFGA-compatible adapter for off-chain directory/org permissions, with on-chain delegation remaining the authority for value-bearing actions. Clean split: ReBAC for "can read," delegation for "can spend/sign."

### Authzed/SpiceDB, Oso, Permit.io, AWS Verified Permissions/Cedar — adopt patterns

- **Collective inventory:** scalable permission graphs (SpiceDB), app-authorization modeling (Oso), no-code policy admin + approval workflows + audit (Permit.io), formal policy language with validation (Cedar).
- **Overlap with AP:** `tool-policy` modeling + admin.
- **AP lacks:**
  - `[SDK]` formal, validatable policy language with a clear enterprise mental model (Cedar); consistency guarantees for large permission graphs (SpiceDB).
  - `[UX]` (deferred) no-code policy admin UI + permission-review tooling (Permit.io).
- **Verdict:** adopt patterns. Cedar is the reference for a formal AP policy language; Permit.io for the admin UX; SpiceDB for graph semantics if AP's ReBAC adapter needs to scale.

---

## Focus-area gap rollup — by layer

### `[Contracts]` gaps — active

| Gap | Evidence | Roadmap ID | Priority |
| --- | --- | --- | --- |
| Stateful/cumulative budget enforcer (spend caps across redemptions, not per-call) | Turnkey policies, Safe Roles | FG-DELEG-1 | P1 |
| Nonce/expiry in quorum + approved-hash signatures (kill identical-call replay) | (internal audit DM-2/EN-13) | FG-SEC-9 | P1 |
| 7715-compatible permission/scope encoding | MetaMask Advanced Permissions | FG-CON-STD-1 | P1 |

### `[SDK]` / package gaps — active

| Gap | Evidence | Roadmap ID | Priority |
| --- | --- | --- | --- |
| Mandatory production session-delegation binding (non-optional in every verifier) + remint-attack tests | (internal audit; ERC-7710 doctrine) | FG-SEC-8 | **P0** |
| Policy-as-code: simulation + testable bundles + decision logs | Cerbos, Cedar, Permit.io | FG-POL-1 | P1 |
| ERC-7715 permission-request builder/parser | MetaMask Advanced Permissions | FG-STD-1 | P1 |
| Off-chain ReBAC adapter for org/directory permissions | OpenFGA, SpiceDB | FG-POL-2 | P2 |
| Formal policy language (Cedar-style) for tool-policy | Cedar | FG-POL-4 | P2 |

### `[UX]` gaps — **deferred (recorded, not current focus)**

| Gap | Evidence |
| --- | --- |
| No-code policy admin UI + permission review | Permit.io |
| Wallet-rendered consent screens for permission requests | MetaMask |

**Substrate advantages to preserve:** delegation as signed, redeemable EIP-712 data spanning app → MCP/A2A → on-chain (no policy engine here does all three); caveat composition; leaf-delegate binding; quorum enforcer with execution-context binding + sorted-ascending dedup.
