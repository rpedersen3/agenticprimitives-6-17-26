# Spec 238 — Package Design v2: AI-Composability + Deterministic Substrate

**Status:** v0 draft · 2026-06-01
**Drivers:** AI-agent-centric composition, post-human-fatigue
developer model, on-chain auditability + determinism, type-discipline
parity, manifest-driven CI verification.
**Companion specs:** [spec 100 — Package Boundary Doctrine](./100-package-boundary-doctrine.md)
(foundation this extends), [spec 237 — Audit Evidence Layer](./237-audit-evidence-layer.md)
(declarative authority that this spec's manifests sharpen).
**Companion ADRs:** [ADR-0022 — Authority MUST be declarative](../docs/architecture/decisions/0022-authority-must-be-declarative.md)
(this spec's manifests become the proof surface).
**Reference:** smart-agent's package shape + relationships /
discovery / ZK patterns we plan to port.

---

## 1. The thesis

> We are building for the **post-human developer era**. The library
> must be **hyper-composable** for AI agents (Claude, Cursor, vibe
> programmers) while remaining **strictly auditable and deterministic**
> on-chain.

The two pressures pull in opposite directions if handled naïvely:

| Surface | What AI agents need | What auditors / on-chain need |
|---|---|---|
| Composition | Many small, narrowly-scoped packages with rigid manifests | Few well-bounded packages with clear authority surface |
| Runtime behavior | Pluggable hooks, declarative composition, event emitters | Statically analyzable; no runtime registration that scanners can't see |
| Types | Specialized types per capability so agents pick the right one | Stable core primitives without surprise dependencies |
| Test surface | Generated tests per composed workflow | Reproducible per-package invariants the substrate locks |

Spec 238 commits to the answer **both**, not either. The principles
below resolve each conflict explicitly.

## 2. The five core principles

### P1. Hyper-Composability with Strict Loose Coupling

15-17 focused packages. AI agents and vibe programmers thrive on
this; humans use the optional facade packages.

All advanced agentic-trust features (relationships, trust, zk,
identity) are **true opt-ins** with **zero impact on core packages**
unless explicitly registered. A consumer that doesn't need
relationships must not pay for the relationships substrate in
bundle size, audit surface, type-inference cost, or trust-graph
complexity.

**What this commits us to (concrete):**

- Core packages forbid imports from agentic-trust packages
  (one-way dependency arrow; CI-enforced — extends the existing
  `check:package-boundaries`).
- Optional packages declare their dependency on core as a **peer
  dependency**, not a runtime import edge — so a tree-shaken bundle
  excluding the optional package excludes its substrate entirely.
- The convenience layer (`engagement`, `agentic-trust`) is **pure
  re-exports**, never required. Deleting it must not break any
  consumer who didn't choose to depend on it.

### P2. Capability Manifests as First-Class Semantic Graph

Every package must ship a **rigid, machine-readable**
`capability.manifest.json` using **JSON Schema + OpenAI-style
function signatures**. This enables:

- Deterministic AI composition (Claude / Cursor / vibe-programming
  tools resolve "what package implements X" by reading manifests,
  not by inferring from prose).
- Test synthesis (CI auto-generates targeted Foundry invariant
  tests for specific compositions — see P5 / §6).
- Dependency-graph reasoning (the manifest IS the graph; no
  separate document drifts).

**What this commits us to (concrete):**

- A v2 manifest schema replacing today's loosely-shaped JSON.
  Required keys: `capability` (string id), `requiresContext`
  (peer-package list), `provides` (capability ids), `mutations`
  (`onChainState` / `ephemeralStorage` / `local` / `none`),
  `interoperability` (extends/via/hookType triple),
  `aiComposition` (inputSchema / outputSchema in JSON Schema form).
- JSON Schema validator wired into `check:capability-manifests`.
- Drift between manifest claims and `src/index.ts` exports fails CI.

### P3. Deterministic Contracts Layer (the critical fix)

**No dynamic runtime registration on-chain.** Hooks and plugins stay
in the TypeScript layer only. On-chain MUST remain statically
analyzable by Slither, Halmos, Echidna, and the R9-wave invariant
suites.

For relationship / trust features that touch contracts:

- Use **immutable registries** (a separate, deployed-once contract
  the core can query via a fixed address slot).
- Or **compile-time module attachment** (the optional contract is
  linked at construction time; once deployed, the surface is fixed).
- **Never** a `registerHook(address newHook)` mutator-pattern on
  core contracts. That would defeat every invariant suite the
  R9 wave built.

**What this commits us to (concrete):**

- New ADR — "Dynamic-Registration Forbidden in Contracts" — to land
  alongside the next contracts wave (see §7 phasing).
- Per-contract documentation of every external dependency address +
  whether it's immutable / governance-mutable / forbidden-from-mutation.
- Halmos symbolic proof that a hypothetical
  `registerRelationship(addr)` mutator would NOT pass static
  analysis (proof by construction — we don't add such a function).

### P4. Types Discipline (Avoid Central Bottleneck)

`@agenticprimitives/types` contains **only core primitives** —
EIP-712 domains, UserOp, AgentAccountConfig, basic policy types.

Advanced types live **strictly inside their own packages** —
`@agenticprimitives/relationships`, `@agenticprimitives/zk`, etc.
The types package must remain a true leaf in the dependency graph:
its bundle size, audit surface, and compilation cost must stay
bounded.

**What this commits us to (concrete):**

- `types` capability manifest declares an empty `provides` for
  agentic-trust capabilities (only core).
- An audit gate fails if a non-core type lands in `types`.
- Each agentic-trust package re-exports its types as part of its
  own public surface; consumers import them per-package, not via
  `types`.

### P5. Auditability & Security Parity

Core packages must remain fully verifiable **without** any optional
layers. The R9 wave's invariants, Halmos proofs, Echidna corpora,
and Medusa harnesses run against the core in isolation; the
agentic-trust layer adds its own invariants on top.

**What this commits us to (concrete):**

- CI matrix runs the core test suite WITH and WITHOUT optional
  packages installed. A test passing with-optionals but failing
  without-optionals is a P1 closure violation.
- Manifest-driven test synthesis (P2) generates the per-composition
  invariants automatically; the core baseline is the floor.

## 3. Refined package topology (15 packages, 3 layers)

### Core Layer (always safe to depend on)

| Package | Purpose | Maps to today |
|---|---|---|
| `@agenticprimitives/connect` | Auth + sessions + SSO broker primitives | merger of today's `connect-auth` + `connect` |
| `@agenticprimitives/agent-account` | ERC-4337 + ERC-7579 substrate | unchanged |
| `@agenticprimitives/key-custody` | KMS (LocalAes / AWS / GCP) + per-subject derivation | unchanged |
| `@agenticprimitives/delegation` | EIP-712 delegations + caveats + sessions | unchanged |
| `@agenticprimitives/tool-policy` | Classification + risk tiers + threshold policy | unchanged |
| `@agenticprimitives/mcp-runtime` | `withDelegation` + JTI + service-mac — **with optional MCP adapter subpath** (see §5 below) | unchanged + new subpath |
| `@agenticprimitives/audit` | Event schema + sinks | unchanged |
| `@agenticprimitives/types` | **Only core primitives** (P4) | unchanged (extracts only) |
| `@agenticprimitives/contracts` | Solidity + ABIs + per-network deploys | unchanged |

### Agentic Trust Layer (true opt-ins; peer-dep on core)

| Package | Purpose | Maps to today |
|---|---|---|
| `@agenticprimitives/identity` | Naming + profile + ontology as **subpaths** in one package | **merger** of today's `agent-naming` + `agent-profile` + `ontology` + `identity-directory` + `identity-directory-adapters` |
| `@agenticprimitives/relationships` | Verifiable relationship graph (ported from smart-agent) | extension of today's `agent-relationships` |
| `@agenticprimitives/trust` | EIP-8004-style scoring, reputation | **new** |
| `@agenticprimitives/zk` | Private proofs, circuits | **new** |

### Convenience Layer (pure re-exports, never required)

| Package | Purpose |
|---|---|
| `@agenticprimitives/engagement` | Common engagement patterns (relying-app onboarding flows, etc.) |
| `@agenticprimitives/agentic-trust` | Meta-composition for common agentic setups (re-exports identity + relationships + trust + zk in vetted combinations) |

### Net delta from today (17 → 15)

- **Consolidations:** `connect-auth` + `connect` → `connect`. `agent-naming` + `agent-profile` + `ontology` + `identity-directory` + `identity-directory-adapters` (5 packages today) → `identity` (1 package with 5 subpaths).
- **New:** `trust`, `zk`, `engagement`, `agentic-trust` (4 new packages).
- **Net:** 17 - 6 consolidations + 4 new = 15.

These are renames + carve-outs, not rewrites. The substrate stays
the same; the topology gets sharper.

## 4. The five concrete fixes addressing earlier critique

### F1. Runtime Plugin Trap → Fixed (P3 above)

**TypeScript layer:** Allowed to use `registerWithDelegation()`,
event emitters, hooks, declarative composition.

**Contracts layer:** No dynamic hooks. Use immutable registries
(e.g., `RelationshipRegistry` is a separate optional contract that
core `DelegationManager` can query via a fixed address slot fixed
at deploy time) or pre-deploy configuration.

This preserves full static analysis and invariant proofs. The R9
wave's substrate continues to hold.

### F2. Types Bottleneck → Fixed (P4 above)

Core types package stays small and stable. Relationship, trust, and
ZK types live only in their respective packages and are imported
explicitly when those features are used. A consumer who never
imports `@agenticprimitives/relationships` never compiles a single
relationship-typed value.

### F3. Capability Manifests → Upgraded

New rigid schema (example for `@agenticprimitives/relationships`):

```jsonc
{
  "name": "@agenticprimitives/relationships",
  "capability": "agentic-trust:relationship-registry",
  "requiresContext": [
    "@agenticprimitives/delegation",
    "@agenticprimitives/agent-account"
  ],
  "provides": [
    "verifiableRelationships",
    "trustGraph",
    "zkProofs"
  ],
  "mutations": ["onChainState", "ephemeralStorage"],
  "interoperability": {
    "extends": "@agenticprimitives/delegation",
    "via": "verifyRelationshipRequirements",
    "hookType": "compileTime"
  },
  "aiComposition": {
    "inputSchema": { /* JSON Schema */ },
    "outputSchema": { /* JSON Schema */ }
  }
}
```

CI will validate all manifests against this schema. Drift between
the manifest's `provides` and `src/index.ts`'s public exports fails
the build. The current `check:capability-manifests` script extends
to enforce the new fields incrementally.

This schema explicitly enables the **Audit Evidence Layer** (spec 237)
— every `provides` entry becomes a row in the trust-graph that
`pnpm audit:evidence` collects.

### F4. MCP-Runtime → Adapter pattern

`@agenticprimitives/mcp-runtime` exports:

- **Core runtime** (always available): `withDelegation`, JTI
  stores, service-mac, the classification bridge to `tool-policy`.
- **Optional MCP adapter** at `./mcp` subpath: the bindings to
  Anthropic's `@modelcontextprotocol/sdk`.

Consumers who don't use Anthropic MCP can still use the base runtime
or plug in Lilypad / Akash / custom protocols via their own adapter.
The package's "MCP" identity becomes a **shipped reference adapter**,
not a hard requirement on the runtime.

### F5. AI-Generated Test Verification (new CI feature)

Add a CI step that parses **composed** capability manifests
(per-PR: "this PR added a new composition (connect + delegation +
relationships)") and **auto-generates** targeted Foundry invariant
tests for the specific combination.

The generator reads each manifest's `aiComposition.inputSchema` and
`provides`, builds a stateful harness against the composition's
state-mutation surface, and emits a per-composition invariant suite.

This is the "manifest-driven test synthesis" piece — the load-bearing
CI feature that makes hyper-composability safe to ship.

## 5. What this preserves (the substrate)

Everything the R9 wave locked. The 15-package topology + the v2
manifest schema + the deterministic-contracts rule are coordination
artifacts; they do not change the underlying invariants. Specifically:

- The 15 Foundry invariants from R9.1+R9.2 still apply to the same
  contracts.
- The 7 Halmos symbolic proofs from R9.3+R9.3.x still apply.
- The Echidna nightly + Medusa weekend continue running on the
  same harnesses.
- The Solhint security gate + Slither + Aderyn + CodeQL +
  pnpm-audit + gitleaks + SBOM all continue.

The manifest schema change is **additive**; existing manifests
remain valid during the migration window (a `manifestVersion: 1` flag
identifies pre-v2 manifests; the CI gate ramps to `v2-required` over
the migration window per §7).

## 6. What this enables (the strategic bet)

- **AI-first composition.** Claude / Cursor / vibe-programming tools
  can answer "what package do I use to do X" by querying the
  manifest graph — no prose interpretation, no convention guessing,
  no boilerplate inference.
- **Test synthesis at composition time.** A consumer that wires up
  connect + delegation + relationships gets a generated invariant
  suite for THAT exact composition; the test surface scales with
  the consumer's actual surface, not with the cartesian product of
  all possible compositions.
- **The trust-graph IS the substrate.** Spec 237's `trust-model`
  package becomes a read model over the manifest graph + the
  on-chain delegation registry; the manifest graph is the authority
  declaration, the on-chain registry is the authority enforcement,
  and the audit-evidence generator is the witness.
- **Deterministic on-chain regardless of TypeScript flexibility.**
  The runtime-plugin trap is closed by construction; the contracts
  layer's static analyzability is preserved regardless of how
  flexible the TypeScript composition layer becomes.

## 7. Phasing

| Wave | Slice | Deliverables |
|---|---|---|
| **W0** (this PR) | Spec + principles + topology | This doc; doc-only |
| **W1** | v2 manifest schema | JSON Schema + validator + drift check; existing 17 manifests continue under `manifestVersion: 1`; new manifests REQUIRED to be v2 |
| **W2** | New manifest fields in three exemplars | `delegation` + `agent-account` + `key-custody` adopt v2 (mirror the spec 237 W2 set) |
| **W3** | Consolidations begin | `connect-auth` + `connect` → `connect`; `agent-naming` + `agent-profile` + `ontology` + `identity-directory`-* → `identity` (subpath structure preserves consumer ergonomics) |
| **W4** | New packages — skeletons | `trust`, `zk`, `engagement`, `agentic-trust` (empty packages with v2 manifests + stubbed `provides`) |
| **W5** | Port from smart-agent | `relationships` extended with verifiable-relationship logic from smart-agent; `trust` adopts EIP-8004-style scoring; `zk` adopts circuit primitives |
| **W6** | Manifest-driven test synthesis | CI feature that auto-generates Foundry invariant suites per composition; the load-bearing P5 deliverable |
| **W7** | MCP adapter carve-out | `mcp-runtime` exports core + optional `./mcp` subpath; existing consumers migrate via a `compat` re-export window |
| **W8** | Deterministic-contracts gate | ADR + per-contract dependency-declaration; Halmos proof scaffold for "no dynamic registration" |
| **W9** | Convenience layer | `engagement` + `agentic-trust` meta-packages ship as pure re-exports |

W0 is **this PR** — no code, no schema enforcement, no migration.
The doc anchors the direction so the audit + the AI-agent / vibe-
programmer community have a clear north star to engage on.

## 8. Risks + rebuttals

**R1. "Consolidations break consumers."**
The subpath model preserves consumer ergonomics. A consumer using
`@agenticprimitives/agent-naming` migrates to
`@agenticprimitives/identity/naming` — the import path is the only
change. A `compat` re-export package can hold the old import paths
for one minor-version window.

**R2. "15 packages still too many."**
We tested with 17 and the existing consumers (demo-web, demo-org,
demo-sso, demo-sso-next, demo-mcp, demo-a2a) tolerate the
package-count without complaint. 15 is a slight tightening, not a
rewrite. The trend is downward as redundant identity-related
packages collapse into `identity`'s subpath structure.

**R3. "Adding `trust` + `zk` without consumers is premature."**
Both packages will be **empty** at W4 (manifest + stubs only). They
exist as **commitments to a public API surface** that the
manifest-driven test synthesis can target. Real implementation
lands in W5 when the smart-agent port happens.

**R4. "Manifest schema will leak product details into a config file."**
The v2 schema keys (`capability`, `requiresContext`, `provides`,
`mutations`, `interoperability`, `aiComposition`) are **purely
structural**. Domain-specific content stays in spec files. The
manifest is the typed-data view of the spec; the spec is the prose.

**R5. "We are changing direction mid-stream."**
This spec **extends** spec 100 (which is two months old) +
spec 237 (which is one day old). It is the **next coordinated step**
in the direction those specs established. It does not reverse any
prior commitment; every R9 invariant, every spec 237 capability,
every ADR-0022 manifest entry continues to apply.

## 9. References

- ADR-0022 — Authority MUST be declarative (this spec's manifests
  are the proof surface)
- Spec 100 — Package Boundary Doctrine (the foundation v2 extends)
- Spec 207 — Smart Account Threshold Policy (custody primitives)
- Spec 226 — Ontology (the type system manifests reference)
- Spec 237 — Audit Evidence Layer (the AEL `trust-model` is a read
  view over this spec's manifest graph)
- smart-agent repository — source of relationships / discovery / ZK
  patterns the agentic-trust layer ports
- `docs/architecture/package-consumer-map.md` — package-to-consumer
  mapping (updates after W3/W4 land)
