# agenticprimitives — Claude Code guide

This is a pnpm-workspace monorepo packaging seven standalone capabilities extracted from `smart-agent` (branch `003-intent-marketplace-proposal`, at `/home/barb/smart-agent`). Package boundaries are earned from competitive-landscape research, not chosen by convenience.

## Repo principles

- **Each package is a product boundary.** A consumer should be able to `pnpm add @agenticprimitives/<one>` and get value without pulling the others. Cross-package deps are explicit and one-directional.
- **Specs precede code.** Every package's contract lives at `specs/200-205-*.md`; per-package `spec.md` is a pointer. Behaviour changes update the spec in the same PR.
- **TypeScript-first.** All packages TS, ESM, target Node ≥ 20.
- **`tool-policy` and `types` stay transport-agnostic.** Importing MCP / A2A / LangChain / Vercel from those packages is a doctrine violation.
- **No fork of smart-agent.** Pull patterns, not code. Cross-reference smart-agent at `/home/barb/smart-agent` while implementing; don't depend on its layout.
- **Always check smart-agent first.** Before designing or implementing any non-trivial capability here, look at the corresponding code/spec in smart-agent (branch `003-intent-marketplace-proposal`, upstream `https://github.com/agentictrustlabs/smart-agent/tree/003-intent-marketplace-proposal`, local `/home/barb/smart-agent`). The reference has likely solved the same problem already — adapt its patterns to agenticprimitives' package boundaries rather than reinventing. New `specs/*` docs MUST include a "Reference: smart-agent patterns to port" section that names the source files we are mirroring. If we deliberately diverge from smart-agent, the spec must say why.

## Dependency direction (strict)

```
types ← identity-auth ← agent-account ← delegation ← mcp-runtime
                            ↑              ↑              ↑
                       key-custody ────────┘              │
                                                  tool-policy ─┘
```

No back-edges. CI enforcement via `scripts/check-package-boundaries.ts` (stub now; implements with first real code).

## Where to start

1. `specs/000-product-overview.md` — product story
2. `docs/architecture/capability-index.md` — routing table for all 7 packages (auto-generated; re-run `pnpm generate:capability-index` after manifest edits)
3. `specs/100-package-boundary-doctrine.md` — boundary principles + competitive signals
4. `specs/101-v0-package-proposal.md` — per-package justifications
5. When narrowed to a package: `packages/<name>/CLAUDE.md` + `capability.manifest.json` + `src/index.ts`

## Per-package context budget

Each `CLAUDE.md` ≤ 900 words, `README.md` ≤ 1800, `docs/architecture.md` ≤ 3000 (when it exists). If you're tempted to bloat a CLAUDE.md, fix the package shape instead — a Claude session should reach meaningful work in any one package within ~3-5k tokens of context overhead.

## Implementation status

Pre-alpha. Public APIs are declared in `src/index.ts` of each package; **no implementations are written yet**. The first implementation pass typically follows: `delegation` (the keystone) → `key-custody` + `identity-auth` + `agent-account` (parallel) → `tool-policy` → `mcp-runtime`.

## Modeled after

- **Capability-boundary doctrine:** MetaMask Delegation Toolkit (bundle smart-account with delegation when account-specific, split when account-agnostic), Alchemy Account Kit / ZeroDev / Pimlico (signer-decoupled-from-account universal pattern), Lit Protocol / Turnkey / Privy (session lifecycle lives with authority, not with KMS).
- **Per-package agent-context model:** smart-agent's `capability.manifest.json` + `CLAUDE.md` pattern, slimmed for our smaller package set.
- **One-job-per-package philosophy:** [1clawAI](https://github.com/1clawAI) — clearly named, narrow-scoped, separately publishable units.
