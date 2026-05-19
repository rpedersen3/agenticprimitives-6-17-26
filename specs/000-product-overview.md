# agenticprimitives — Product Overview & Architecture

**Status:** v0 draft · 2026-05-19 (rev 2: post-competitive-research package restructure)
**Source of capabilities:** `smart-agent` monorepo, branch `003-intent-marketplace-proposal` (extracted, not forked).

> **Rev 2 note:** The original 4-package cut (auth / delegation / kms / mcp-resources) was restructured into 6 capability + 1 shared = 7 packages, justified by competitive-landscape research. See [`100-package-boundary-doctrine.md`](./100-package-boundary-doctrine.md) for principles and [`101-v0-package-proposal.md`](./101-v0-package-proposal.md) for per-package justification. The original four specs are preserved at [`_archive/00X-*.md`](./_archive/).

---

## 1. Product thesis

Modern agentic web apps repeatedly re-implement the same scaffolding around four capability areas: **authenticate a user and bind them to a programmable account**, **delegate scoped authority** from that account to one or more agents/tools, **manage cryptographic keys** for those agents safely, and **enforce delegation at MCP resource boundaries**.

`smart-agent` has built mature, production-grade versions of all four — but they're embedded inside one application monorepo. `agenticprimitives` re-shapes them into 7 independently consumable npm packages that any agentic web app can adopt without inheriting smart-agent's product surface.

Each package is a **product boundary**: a separately publishable, independently consumable unit with its own `CLAUDE.md` and `capability.manifest.json` so Claude (and other agents) can route work efficiently to one or two packages instead of one giant repo context.

---

## 2. The seven packages

| # | Package | Capability area | Spec |
| --- | --- | --- | --- |
| 1 | [`@agenticprimitives/identity-auth`](../packages/identity-auth) | Auth + smart account (1 of 2) | [`200`](./200-identity-auth.md) |
| 2 | [`@agenticprimitives/agent-account`](../packages/agent-account) | Auth + smart account (2 of 2) | [`201`](./201-agent-account.md) |
| 3 | [`@agenticprimitives/delegation`](../packages/delegation) | Delegation + session lifecycle | [`202`](./202-delegation.md) |
| 4 | [`@agenticprimitives/key-custody`](../packages/key-custody) | KMS abstraction (narrower than v1) | [`203`](./203-key-custody.md) |
| 5 | [`@agenticprimitives/tool-policy`](../packages/tool-policy) | Classification + risk-tier + exact-call (protocol-agnostic) | [`204`](./204-tool-policy.md) |
| 6 | [`@agenticprimitives/mcp-runtime`](../packages/mcp-runtime) | MCP delegation-aware middleware | [`205`](./205-mcp-runtime.md) |
| 7 | [`@agenticprimitives/types`](../packages/types) | Cross-cutting branded types | n/a (in 101) |

---

## 3. Runtime composition

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          BROWSER (web app)                              │
│                                                                         │
│   identity-auth                                                         │
│   ─ user signs in (passkey / SIWE / Google) → JWT session               │
│   ─ exposes Signer (passkey/EOA/KMS)                                    │
│                                                                         │
│   agent-account                                                         │
│   ─ deterministic smart-account address; lazy deploy on first action    │
│                                                                         │
│   delegation                                                            │
│   ─ user signs EIP-712 Delegation { delegator, delegate=sessionKey,     │
│       caveats: [TimeWindow, McpToolScope, DataScope, …] }               │
│                                                                         │
└────────────────────────────────┬────────────────────────────────────────┘
                                 │  POST /session/init + /session/package
                                 ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                          A2A AGENT (node)                               │
│                                                                         │
│   key-custody                                                           │
│   ─ raw envelope encryption + signing primitives (AWS/GCP/local-AES)    │
│                                                                         │
│   delegation                                                            │
│   ─ SessionManager: encrypts {sessionPrivateKey, delegation} via        │
│       key-custody, persists via SessionStore                            │
│   ─ on tool call: decrypts session, mints DelegationToken               │
│                                                                         │
│   tool-policy (consulted at issue time for risk-tier TTL clamps)        │
│                                                                         │
└────────────────────────────────┬────────────────────────────────────────┘
                                 │  HMAC-signed envelope (key-custody/mac) + token
                                 ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                          MCP SERVER (node)                              │
│                                                                         │
│   mcp-runtime                                                           │
│   ─ withDelegation() wraps each tool handler:                           │
│       HMAC verify → session-sig → EIP-712 hash → on-chain isRevoked     │
│       → ERC-1271 → caveat eval (fail-closed) → JTI replay               │
│       → tool-policy.evaluatePolicy → run handler                        │
│                                                                         │
│   delegation, tool-policy (consumed by mcp-runtime)                     │
│   @modelcontextprotocol/sdk (peer dep — transports, registration)       │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Dependency direction (strict, no cycles)

```
types        (leaf; no @ap/* deps)
  ↑
identity-auth (uses types)
  ↑
agent-account (uses identity-auth, types)
  ↑
key-custody   (uses identity-auth, types) ──┐
                                            │
delegation    (uses agent-account, key-custody, identity-auth, types)
  ↑
tool-policy   (uses types only; protocol-agnostic)
  ↑
mcp-runtime   (uses delegation, key-custody, tool-policy, types; peer-dep @modelcontextprotocol/sdk)
```

Hard rules:
- No back-edges. CI guards via `scripts/check-package-boundaries.ts` (stub now; implements alongside first real code).
- `tool-policy` MUST stay transport-free (no MCP SDK, no LangChain) so it remains consumable by any future runtime.
- `apps/*` never appears under `packages/`.

---

## 5. Non-goals (v0)

- **No A2A runtime.** `a2aproject/a2a-js` exists; add adapters when content earns it.
- **No framework adapters yet** (LangChain / Vercel AI / Anthropic Computer Use). Strong Coinbase precedent for separate `adapter-*` packages — defer until consumer demand surfaces.
- **No fork of smart-agent contracts.** Contracts referenced by address; ABIs ride with smart-agent until a `@agenticprimitives/contracts-abis` package earns its existence.
- **No multi-language SDKs.** TypeScript only. Go/Python later if needed.
- **No UI components.** Logic + types + hooks; consumers bring their design system.
- **No domain packages.** Treasury, wallet-actions, agentic-payments etc. are smart-agent's product surface, not agenticprimitives'.
- **No `@agenticprimitives/sdk` facade.** Wait until ≥3 consumers ask for one.

---

## 6. Repository layout

```
agenticprimitives/
├── packages/
│   ├── identity-auth/         (Privy-style auth + Signer interfaces)
│   ├── agent-account/         (ERC-4337 substrate)
│   ├── delegation/            (delegations + session lifecycle)
│   ├── key-custody/           (KMS primitives, narrower)
│   ├── tool-policy/           (protocol-agnostic policy)
│   ├── mcp-runtime/           (MCP middleware)
│   └── types/                 (cross-cutting branded types)
├── specs/
│   ├── 000-product-overview.md            (this file)
│   ├── 100-package-boundary-doctrine.md   (principles)
│   ├── 101-v0-package-proposal.md         (per-package justifications)
│   ├── 102-manifest-and-claude-md-template.md   (agent-context contract)
│   ├── 103-spec-reorganization-map.md     (current → new mapping)
│   ├── 200-identity-auth.md
│   ├── 201-agent-account.md
│   ├── 202-delegation.md
│   ├── 203-key-custody.md
│   ├── 204-tool-policy.md
│   ├── 205-mcp-runtime.md
│   └── _archive/              (preserved v1 specs 001-004)
├── docs/                      (usage guides, ADRs — empty in v0)
├── scripts/                   (CI guardrail stubs)
├── package.json
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── CLAUDE.md
└── README.md
```

---

## 7. Provenance traceability

Every per-package spec carries a smart-agent file index with line ranges (`apps/web/src/lib/auth/native-session.ts:29-78`). These pointers reflect smart-agent at branch `003-intent-marketplace-proposal` as of 2026-05-19. They decay over time; treat them as snapshot citations.

---

## 8. How Claude routes work

A Claude session starting in this repo loads, in order:

1. Root `CLAUDE.md` (≤ 600 words) — repo principles, dependency direction, where to find specs.
2. `specs/000-product-overview.md` — this file.
3. (Generated, post-CI-script-implementation) `docs/architecture/capability-index.md` — package name → path → one-line summary.
4. When narrowed to a package: that package's `CLAUDE.md` + `capability.manifest.json` + `src/index.ts`.

Total context overhead before meaningful work in a single package: **~3-5k tokens.** This is the explicit product goal — each package is a sized agent-loadable unit, not a slice of a larger maze.

If a task requires reading >3 implementation files in a single package to understand its scope, treat that as a doctrine violation and refactor the package shape, not the docs.
