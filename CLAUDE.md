# agenticprimitives — Claude guide

pnpm-workspace monorepo: publishable capability packages + Foundry contracts + demo apps. Patterns mirror `smart-agent` (branch `003-intent-marketplace-proposal`, local `/home/barb/smart-agent`); we port patterns, not layout.

## Where to look (by intent)

| You're working on                    | Read first                                                                            |
| ------------------------------------ | ------------------------------------------------------------------------------------- |
| Which package do I import for X      | `docs/architecture/package-consumer-map.md`                                           |
| Unsure which package owns it         | `docs/architecture/task-routing.md`                                                   |
| Contract code                        | Relevant `specs/2XX-*.md` + `apps/contracts/src/`                                     |
| A specific package                   | `packages/<name>/CLAUDE.md` only — it routes to the spec + key files                  |
| Multi-sig / custody / recovery       | `specs/207` (product) + `specs/209` (impl) + `specs/213` (package split) + `specs/221` (credential recovery process) |
| Audit / forensics                    | `specs/206` + `apps/demo-mcp/docs/audit/guide.md`                                     |
| Cross-cutting capability (multi-pkg) | `docs/architecture/cross-cutting-capabilities.md`                                     |
| Deploy / live wiring                 | `apps/contracts/script/Deploy.s.sol` + `apps/contracts/deployments-base-sepolia.json` |
| Demo flows                           | `apps/demo-web-pro/CLAUDE.md` + `apps/demo-web/`, `apps/demo-a2a/`, `apps/demo-mcp/`  |

## Hard rules

- **Smart Agent address is the canonical identifier.** Every person, org, service agent, and treasury IS its ERC-4337 SA address. Names, profiles, ERC-8004 entries, ANS handles, HCS topics — all facets pointing AT the canonical address. Cross-package APIs take `Address`, not names. See [ADR-0010](docs/architecture/decisions/0010-smart-agent-canonical-identifier.md) + [spec 220](specs/220-agent-identity-bootstrap.md) for the bootstrap process (deploy → forced-unique name → custody → optional facets).
- **Canonical identity persists; credentials rotate.** Passkeys, SIWE EOAs, hardware wallets are control credential facets — replaceable, not the identity. Credential add / replace / remove is a custody-policy-governed operation (trustee quorum, guardian quorum, multi-credential self-recovery, or multi-sig), NEVER a delegation. The SA address NEVER changes during credential recovery. Delegations issued by the SA remain valid after rotation. See [ADR-0011](docs/architecture/decisions/0011-credential-recovery-and-re-association.md) + [spec 221](specs/221-credential-recovery.md).
- **Specs precede non-trivial code.** New `specs/2XX-*.md` before architecture changes; the spec is the architect-of-record.
- **Always check smart-agent first.** Before designing any non-trivial capability look at the analog in `/home/barb/smart-agent`. New specs MUST include a "Reference: smart-agent patterns to port" section. Deliberate divergence must say why.
- **Package boundaries** are one-directional: `types ← identity-auth ← agent-account ← delegation ← mcp-runtime`, plus `key-custody → delegation`, `tool-policy → mcp-runtime`, and the custody-layer fork `types ← custody` (depended on by `agent-account` and `delegation`; see [spec 213](specs/213-custody-layer-carve-out.md) for the firewall). No back-edges. `tool-policy` and `types` are transport-agnostic (no MCP/A2A/LangChain/Vercel imports).
- **`AgentAccount.sol` is a thin ERC-7579 modular core.** Threshold / guardians / spend / sessions are modules, not inlined. See `specs/209` + memory `feedback_erc7579_module_architecture`.
- **No third-party multi-sig.** We ship our own; port patterns from Safe (signature packing) but no runtime deps.
- **Per-package context budget:** `CLAUDE.md` ≤ 60 lines, `AUDIT.md` ≤ 150 lines, `README.md` ≤ 1800 words. If you're tempted to bloat one, fix the package shape.
- **No `eth_getLogs` in product read paths.** Package and app hot paths use `readContract` only; chain history and human-readable reverse strings come from on-chain storage, an explicit indexer, or app cache — never inline log scans ([ADR-0012](docs/architecture/decisions/0012-no-eth-getlogs-in-product-read-paths.md)). No exceptions: the last walker (`agent-naming` `reverseResolve` log fallback) was removed once spec/222 `reverseResolveString` landed.
- **No silent fallbacks.** A read/auth path has exactly ONE mechanism. If the canonical path has no answer it returns `null`/empty or throws — it does NOT escalate to a second, different, more expensive mechanism (`try fast catch slow`, empty-result → log walk, strong-check → weak-check). Empty is an answer, not a trigger. Bounded retries of the *same* call and cache-first reads (cache holds the canonical answer) are fine; switching mechanism is not ([ADR-0013](docs/architecture/decisions/0013-no-silent-fallbacks.md)).
- **Packages are GENERIC trust building blocks; white-label / vertical / deployment code lives in apps.** `packages/*` are reusable + vertical-agnostic. They MUST NOT contain (a) **branding / vertical content** — faith vocabulary (church, ministry, congregation, discipleship, parish, denomination, gospel, scripture), white-label/product names, marketing copy, themes; (b) **vertical-specific flows** — faith onboarding steps, impact-portal features; (c) **deployment specifics** — concrete hostnames (`impact-agent.me`/`.io`), the `demo.agent` subregistry, hosting providers (`*.pages.dev`/`*.workers.dev`/`vercel`), host/subdomain parsing. All of that is the **app** layer's job, supplied as an **app-level white-label config object** (spec 234) the generic core consumes. The `.agent` TLD itself is the naming protocol (owned by `agent-naming`) and is allowed. Enforced by `pnpm check:no-domain-in-packages` (hostnames + `demo.agent` + faith vocab) + `check:forbidden-terms`; the rest is doctrine ([ADR-0021](docs/architecture/decisions/0021-generic-packages-vs-white-label-apps.md)). Each app centralizes its domain/white-label literals in one module (e.g. `src/lib/domain.ts`), never scattered.

## Conventions

- TypeScript strict, ESM, Node ≥ 20.
- Solidity 0.8.28, optimizer 200 runs, via-IR ON.
- Generated/build content (`out/`, `cache/`, `dist/`, `node_modules/`, `.next/`) is in `.claudeignore` — searches skip it.

## Validation shortcuts

Prefer the narrowest script before broad checks:

- `pnpm check:<package-name>` for package work, e.g. `pnpm check:agent-naming`
- `pnpm check:demo-web-pro` / `pnpm check:demo-a2a` for app work
- `pnpm check:cross-cutting-capabilities` after routing-index edits
- `pnpm check:all` before broad PRs

## Status

Pre-alpha. Specs remain the source of truth; package `CLAUDE.md` files are the fastest entry point for implementation work.
