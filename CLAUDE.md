# agenticprimitives — Claude guide

pnpm-workspace monorepo: 7 publishable packages + Foundry contracts + demo apps. Patterns mirror `smart-agent` (branch `003-intent-marketplace-proposal`, local `/home/barb/smart-agent`); we don't fork.

## Where to look (by intent)

| You're working on | Read first |
| --- | --- |
| Contract code | `apps/contracts/src/AgentAccount.sol` (thin core) + `src/modules/ThresholdValidator.sol` (admin) + `specs/209-erc7579-module-taxonomy.md` |
| A specific package | `packages/<name>/CLAUDE.md` only — it routes to the spec + key files |
| Multi-sig / threshold / recovery | `specs/207` (product) + `specs/209` (impl) + `apps/demo-web-pro/docs/multi-sig/guide.md` |
| Audit / forensics | `specs/206` + `apps/demo-mcp/docs/audit/guide.md` |
| Cross-cutting capability (multi-pkg) | `docs/architecture/cross-cutting-capabilities.md` |
| Deploy / live wiring | `apps/contracts/script/Deploy.s.sol` + `apps/contracts/deployments-base-sepolia.json` |
| Demo flows | `apps/demo-web-pro/CLAUDE.md` + `apps/demo-web/`, `apps/demo-a2a/`, `apps/demo-mcp/` |

## Hard rules

- **Specs precede non-trivial code.** New `specs/2XX-*.md` before architecture changes; the spec is the architect-of-record.
- **Always check smart-agent first.** Before designing any non-trivial capability look at the analog in `/home/barb/smart-agent`. New specs MUST include a "Reference: smart-agent patterns to port" section. Deliberate divergence must say why.
- **Package boundaries** are one-directional: `types ← identity-auth ← agent-account ← delegation ← mcp-runtime`, plus `key-custody → delegation` and `tool-policy → mcp-runtime`. No back-edges. `tool-policy` and `types` are transport-agnostic (no MCP/A2A/LangChain/Vercel imports).
- **`AgentAccount.sol` is a thin ERC-7579 modular core.** Threshold / guardians / spend / sessions are modules, not inlined. See `specs/209` + memory `feedback_erc7579_module_architecture`.
- **No third-party multi-sig.** We ship our own; port patterns from Safe (signature packing) but no runtime deps.
- **Per-package context budget:** `CLAUDE.md` ≤ 60 lines, `AUDIT.md` ≤ 150 lines, `README.md` ≤ 1800 words. If you're tempted to bloat one, fix the package shape.

## Conventions

- TypeScript strict, ESM, Node ≥ 20.
- Solidity 0.8.28, optimizer 200 runs, via-IR ON.
- Generated/build content (`out/`, `cache/`, `dist/`, `node_modules/`, `.next/`) is in `.claudeignore` — searches skip it.

## Status (2026-05-20)

Phase 6c.5-d.1 landed: AgentAccount is under EIP-170 (15.2 KB runtime, was 27.1 KB). ThresholdValidator module owns the admin surface. 152 Forge tests + workspace tests passing. Next: phase 6c.5-d.1.c (factory rewires to install validator) → phase 6c.5-c (live deploy resume). See task list.
