# Spec 102 — Manifest + CLAUDE.md Template

**Status:** v0 draft · 2026-05-19
**Depends on:** [`100-package-boundary-doctrine.md`](./100-package-boundary-doctrine.md)
**Purpose:** define the per-package agent-context contract — what every `packages/*/` ships so Claude (and other coding agents) can route work efficiently. Slimmed from the smart-agent capability-package manifest, fitted to agenticprimitives.

---

## 1. Per-package required files

Every package under `packages/*/` ships at minimum:

```
packages/<name>/
├── package.json
├── capability.manifest.json   ← machine-readable boundary
├── CLAUDE.md                  ← agent routing + invariants (≤ 900 words)
├── README.md                  ← human consumer quickstart (≤ 1800 words)
├── spec.md                    ← pointer to specs/00X
├── tsconfig.json
└── src/
    └── index.ts
```

Optional files when the package owns them:

```
├── docs/
│   ├── architecture.md        (≤ 3000 words)
│   ├── security.md
│   └── migration.md           (only when migration is in flight)
└── test/
    ├── unit/
    └── integration/
```

We deliberately do NOT require: `contracts/`, `ontology/`, `mcp/`, `graphdb/` directories (those exist in smart-agent's plan but are out of scope for agenticprimitives v0).

---

## 2. `capability.manifest.json` schema

Slimmed from smart-agent's. Required fields for every agenticprimitives package:

```json
{
  "$schema": "../../scripts/schemas/capability.manifest.schema.json",
  "name": "@agenticprimitives/<package-name>",
  "kind": "capability",
  "stability": "experimental | beta | stable",
  "agentEntry": "CLAUDE.md",
  "publicEntry": "src/index.ts",
  "specEntry": "../../specs/00X-<name>.md",
  "summary": "One-sentence purpose. Same line as README opening.",

  "owns": {
    "source": ["src/**"],
    "tests": ["test/**"]
  },

  "imports": [
    "@agenticprimitives/types"
  ],

  "allowedImports": [
    "@agenticprimitives/types",
    "viem",
    "@noble/curves",
    "@noble/hashes"
  ],

  "forbiddenImports": [
    "apps/*",
    "@agenticprimitives/mcp-runtime"
  ],

  "publicExports": [
    "DelegationClient",
    "mintDelegationToken",
    "verifyDelegationToken"
  ],

  "ignoreForAgentContext": [
    "dist/**",
    "node_modules/**",
    "coverage/**",
    "*.tsbuildinfo"
  ],

  "contextBudget": {
    "claudeMdMaxWords": 900,
    "readmeMaxWords": 1800,
    "architectureMaxWords": 3000
  }
}
```

### Field semantics

| Field | Required | Notes |
| --- | --- | --- |
| `name` | yes | Full scoped npm name. |
| `kind` | yes | `capability`, `shared`, or `adapter` (for future framework adapters). |
| `stability` | yes | All packages start `experimental` at v0. Promote to `beta` once consumer feedback lands; `stable` after 1.0. |
| `agentEntry` | yes | Always `CLAUDE.md`. |
| `publicEntry` | yes | Path to the entry that defines public API. |
| `specEntry` | yes | Relative path to the canonical spec in `specs/`. Single source of truth. |
| `summary` | yes | One sentence. Must match README's opening line and the `description` field in `package.json`. |
| `owns.source` / `owns.tests` | yes | Globs. Used by CI to enforce ownership. |
| `imports` | yes | Runtime deps within agenticprimitives. Must match the package.json dependency list. |
| `allowedImports` | yes | Whitelist for cross-package + npm. Anything not listed errors in CI. |
| `forbiddenImports` | yes | Explicit "never import from here." Catches accidental cycles. |
| `publicExports` | yes | Symbol names from `publicEntry` that constitute the API surface. Internal symbols not listed. |
| `ignoreForAgentContext` | yes | Files Claude should NOT scan when loading the package. Build artifacts, vendored code, etc. |
| `contextBudget` | yes | Word limits on docs. Enforced by `scripts/check-claude-context-budget.ts`. |

### What we DON'T include (vs smart-agent's schema)

Removed for agenticprimitives because they're not yet needed:

- `contracts: ["contracts/**"]` — we reference contracts by address; no Solidity in v0.
- `ontology: ["ontology/**"]` — no ontology in v0.
- `mcpTools` and `graphdbProjections` — defer to v0.1+.
- `ontologyNamespaces`, `delegationScopes` arrays — useful for smart-agent's coordination; premature for us.
- `forbiddenTerms` (e.g., "church", "ministry") — we don't have domain packages where vocabulary policing matters yet.

Adding any of these back is non-breaking; the schema treats them as optional.

---

## 3. `CLAUDE.md` template (per package)

A single file ≤ 900 words. Sections in this order, no others:

```markdown
# @agenticprimitives/<name> — Claude guide

## What this package owns
[2-4 bullets. Specific, not generic.]

## What this package does NOT own
[2-4 bullets. Pointers to where those things live.]

## Read these first (in order)
1. `capability.manifest.json` — boundary
2. `src/index.ts` — public API
3. `../../specs/00X-<name>.md` — the contract
4. [1-2 specific implementation files only if they're the "spine" of the package]

## Stable public exports
[Comma-separated list, or short table mapping export → one-line purpose. Anything not here is internal and may change.]

## Allowed imports
[From `capability.manifest.json` — restate the top 5-10 for quick reference.]

## Forbidden imports
[Cycles to avoid + the apps/* rule.]

## Security invariants (DO NOT BREAK)
[3-6 invariants specific to this package. Examples:
- "Caveat evaluator MUST be fail-closed: unknown enforcer addresses reject."
- "Session private keys MUST never be logged."
- "JTI tracking MUST be atomic under concurrent writers."]

## Validate the package
```bash
pnpm --filter @agenticprimitives/<name> typecheck
pnpm --filter @agenticprimitives/<name> test
pnpm --filter @agenticprimitives/<name> lint
```

## Common task routing
[3-5 lines mapping likely Claude tasks → which file to start in. Examples:
- "Adding a new caveat type → `src/caveats.ts`, then `test/unit/caveats.test.ts`."
- "Wiring a new KMS backend → `src/providers/<backend>.ts`, conform to `A2AKeyProvider`."]

## Generated files (ignore)
[Globs that match `capability.manifest.json:ignoreForAgentContext` — restated for human readers.]
```

### Why this shape

- **"What this owns / does NOT own"** is the boundary contract. Claude reads it first; if a task doesn't fit, route elsewhere immediately.
- **"Read these first"** is the load order — capping load to ~5 files keeps context overhead low.
- **"Stable public exports"** is the API surface promise. Internal symbols are fair game to refactor; listed symbols aren't.
- **"Security invariants"** are the things that break products if violated. Smart-agent's experience shows these are easy to miss without an explicit list.
- **"Validate the package"** gives Claude a deterministic checkpoint after any change.
- **"Common task routing"** is the "where do I start" cheat sheet — high-leverage for short Claude sessions.

---

## 4. Root context flow (how a session starts)

Claude's load order at the start of any agenticprimitives session:

1. **Root `CLAUDE.md`** (≤ 600 words): repo principles, dependency direction, where to find specs.
2. **`specs/000-product-overview.md`**: the product story.
3. **`docs/architecture/capability-index.md`** (generated): name → path → one-line summary for all packages.
4. **Specific package's `CLAUDE.md` + `capability.manifest.json` + `src/index.ts`**: only when narrowed to that package.

Stop there. A session that has loaded those four artifacts should be able to do most tasks in that package.

If a task requires reading >3 implementation files to understand a single package's scope, that's a doctrine violation — file an issue to refactor the package's shape, not to load more context.

---

## 5. CI guardrails (deferred but planned)

Scripts in `scripts/` that lint the manifest+CLAUDE.md contract. Land alongside the rescaffold:

```json
{
  "check:capability-manifests": "tsx scripts/check-capability-manifests.ts",
  "check:package-docs": "tsx scripts/check-package-docs.ts",
  "check:package-boundaries": "tsx scripts/check-package-boundaries.ts",
  "check:public-exports": "tsx scripts/check-public-exports.ts",
  "check:claude-context-budget": "tsx scripts/check-claude-context-budget.ts",
  "generate:capability-index": "tsx scripts/generate-capability-index.ts"
}
```

Each script's responsibility:

- **check:capability-manifests** — every `packages/*/capability.manifest.json` matches schema; every claimed `publicExports` actually exists in `src/index.ts`.
- **check:package-docs** — required files present; word counts within budget.
- **check:package-boundaries** — no imports outside `allowedImports`; no deep imports across packages.
- **check:public-exports** — `package.json:exports` matches `capability.manifest.json:publicExports` (no accidental private exposure).
- **check:claude-context-budget** — `CLAUDE.md` ≤ 900 words, `README.md` ≤ 1800, `docs/architecture.md` ≤ 3000.
- **generate:capability-index** — produces `docs/architecture/capability-index.md` for Claude's root-context flow.

We do NOT ship these scripts in v0's first commit — they land alongside the rescaffold so all six packages comply from day one.

---

## 6. Example: `@agenticprimitives/delegation` manifest (preview)

What package 3's manifest will look like after the rescaffold:

```json
{
  "name": "@agenticprimitives/delegation",
  "kind": "capability",
  "stability": "experimental",
  "agentEntry": "CLAUDE.md",
  "publicEntry": "src/index.ts",
  "specEntry": "../../specs/002-delegation.md",
  "summary": "EIP-712 smart-account delegations with caveats; web→agent→MCP token flow; session lifecycle.",

  "owns": {
    "source": ["src/**"],
    "tests": ["test/**"]
  },

  "imports": [
    "@agenticprimitives/types",
    "@agenticprimitives/agent-account",
    "@agenticprimitives/key-custody"
  ],

  "allowedImports": [
    "@agenticprimitives/types",
    "@agenticprimitives/agent-account",
    "@agenticprimitives/key-custody",
    "viem",
    "@noble/curves",
    "@noble/hashes"
  ],

  "forbiddenImports": [
    "apps/*",
    "@agenticprimitives/mcp-runtime",
    "@agenticprimitives/tool-policy"
  ],

  "publicExports": [
    "ROOT_AUTHORITY",
    "DelegationClient",
    "SessionManager",
    "buildCaveat",
    "buildMcpToolScopeCaveat",
    "buildDataScopeCaveat",
    "buildDelegateBindingCaveat",
    "encodeTimestampTerms",
    "encodeValueTerms",
    "encodeAllowedTargetsTerms",
    "encodeAllowedMethodsTerms",
    "hashDelegation",
    "hashCaveats",
    "evaluateCaveats",
    "mintDelegationToken",
    "verifyDelegationToken",
    "verifyCrossDelegation",
    "isRevoked",
    "revokeDelegation"
  ],

  "ignoreForAgentContext": [
    "dist/**",
    "node_modules/**",
    "coverage/**",
    "*.tsbuildinfo",
    "test/fixtures/golden/**"
  ],

  "contextBudget": {
    "claudeMdMaxWords": 900,
    "readmeMaxWords": 1800,
    "architectureMaxWords": 3000
  }
}
```

The corresponding `CLAUDE.md` would be 500-700 words: a focused routing doc for the delegation package alone.

---

## 7. What this gives Claude

A Claude session entering `packages/delegation/` reads:

1. `CLAUDE.md` (~700 words) — knows what's in/out, stable exports, security invariants, validate-commands.
2. `capability.manifest.json` — knows which imports are legal.
3. `src/index.ts` — knows the API surface.
4. The relevant spec (`specs/002-delegation.md`) only when planning a non-trivial change.

Total context overhead before doing meaningful work: ~3-5k tokens. That's the explicit product goal: each package is a sized, agent-loadable unit, not a slice of a larger maze.

This is the routing efficiency the user specified.
