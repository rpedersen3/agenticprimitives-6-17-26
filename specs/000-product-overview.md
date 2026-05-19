# agenticprimitives — Product Overview & Architecture

**Status:** v0 draft · 2026-05-19
**Source of capabilities:** `smart-agent` monorepo, branch `003-intent-marketplace-proposal` (extracted, not forked).

---

## 1. Product thesis

Modern agentic web apps repeatedly re-implement the same four scaffolding capabilities:

1. **Authenticate a user**, then bind them to a programmable on-chain account.
2. **Issue delegations** from that account to one or more agents/tools, with bounded scope.
3. **Manage cryptographic keys** for those agents safely (no plaintext private keys lying around).
4. **Enforce delegation at MCP resource boundaries**, so an agent can only do what it was actually authorized to do.

`smart-agent` has built mature, production-grade versions of all four — but they're embedded inside a single application monorepo. `agenticprimitives` re-shapes them into four independently consumable npm packages that any agentic web app can adopt without inheriting smart-agent's product surface.

The product model mirrors **[1clawAI](https://github.com/1clawAI)**: each capability is its own clearly-named package, usable on its own, with consistent naming and one job per package. We deliver as a **monorepo** (pnpm workspaces) rather than polyrepo because the four packages co-evolve.

---

## 2. The four packages

| # | Package | Capability | Spec |
| --- | --- | --- | --- |
| 1 | `@agenticprimitives/auth` | User auth (passkey + SIWE + OAuth) → JWT session → deterministic ERC-4337 smart account | [`001-auth.md`](./001-auth.md) |
| 2 | `@agenticprimitives/delegation` | EIP-712 delegations with caveats; web→agent→MCP token flow; on-chain validation via DelegationManager | [`002-delegation.md`](./002-delegation.md) |
| 3 | `@agenticprimitives/kms` | Pluggable envelope-encryption + signer abstraction (local-AES / AWS KMS / GCP KMS); session-key lifecycle bound to a delegation | [`003-kms.md`](./003-kms.md) |
| 4 | `@agenticprimitives/mcp-resources` | Reusable `withDelegation()` wrapper, caveat→resource-scope mapping, classification metadata, JTI replay protection for MCP servers | [`004-mcp-resources.md`](./004-mcp-resources.md) |

---

## 3. The runtime story (how the four packages compose)

```
┌────────────────────────────────────────────────────────────────────────┐
│                          BROWSER (web app)                             │
│                                                                        │
│   @agenticprimitives/auth                                              │
│   ─ user signs in (passkey / SIWE / Google)                            │
│   ─ JWT session minted; deterministic smart account address resolved   │
│                                                                        │
│   @agenticprimitives/delegation                                        │
│   ─ user signs an EIP-712 Delegation { delegator, delegate=sessionKey, │
│       caveats: [TimeWindow, McpToolScope, DataScope, …] }              │
│                                                                        │
└───────────────────────────────┬────────────────────────────────────────┘
                                │  POST /session/init + /session/package
                                ▼
┌────────────────────────────────────────────────────────────────────────┐
│                          A2A AGENT (node)                              │
│                                                                        │
│   @agenticprimitives/kms                                               │
│   ─ generates session keypair                                          │
│   ─ envelope-encrypts {sessionPrivateKey, delegation} via KMS provider │
│   ─ stores ciphertext in DB; plaintext never persisted                 │
│                                                                        │
│   @agenticprimitives/delegation                                        │
│   ─ on tool call: decrypts session, mints DelegationToken              │
│       { iss:a2a, aud:urn:mcp:server:person, sessionKey-signed }        │
│                                                                        │
└───────────────────────────────┬────────────────────────────────────────┘
                                │  HMAC-signed envelope + token
                                ▼
┌────────────────────────────────────────────────────────────────────────┐
│                          MCP SERVER (node)                             │
│                                                                        │
│   @agenticprimitives/mcp-resources                                     │
│   ─ withDelegation() wraps tool handler                                │
│   ─ verifies token: session-sig → EIP-712 hash → on-chain isRevoked    │
│       → ERC-1271 isValidSignature → caveat eval (fail-closed) → JTI    │
│   ─ exposes verified principal + DataScopeGrant[] to handler           │
│                                                                        │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Dependency direction

Strictly one-way. No cycles. Cross-package contracts live in each package's exported types — there is no shared `types` package in v0 (avoid premature abstraction).

```
auth          (no @agenticprimitives/* deps)
   ↑ types only
delegation    (no runtime dep on auth; consumes addresses + signers from caller)
   ↑
kms           (depends on delegation for the SessionPackage shape; otherwise standalone)
   ↑
mcp-resources (depends on delegation; optional dep on kms only if MCP is also a KMS consumer)
```

A consumer adopting just `@agenticprimitives/auth` should not pull `delegation`, `kms`, or `mcp-resources`. This shapes how we organize exports — each package has a small public API surface and no transitive bloat.

---

## 5. Non-goals (v0)

- **No fork of smart-agent.** We pull patterns, not the codebase. Smart-agent stays the application; we are the libraries.
- **No multi-language SDKs yet.** TypeScript only. Go/Python SDKs can come later, modeled after `1claw-go-sdk` / `1claw-langchain-demo`.
- **No on-chain contract authoring.** Contracts (`AgentAccount`, `DelegationManager`, enforcers) are referenced by address; we publish ABIs only when needed. Contract source stays in smart-agent.
- **No UI components.** Each package ships logic + types + hooks where applicable, not styled components. A consumer brings their own design system.
- **No CLI.** v0 is library-only. If a CLI emerges, it's a fifth package (`@agenticprimitives/cli`), modeled after `1claw-cli`.

---

## 6. Versioning and release

- All packages versioned independently (semver).
- Breaking changes to one package bump that package only; consumers can upgrade in isolation.
- A repo-level `CHANGELOG.md` summarizes per-release groupings.
- Pre-1.0: liberal breaking changes are fine; bump minor on break, patch on additive.

---

## 7. Repository layout

```
agenticprimitives/
├── packages/
│   ├── auth/
│   │   ├── src/
│   │   ├── spec.md       → mirrors specs/001-auth.md
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── README.md
│   ├── delegation/
│   ├── kms/
│   └── mcp-resources/
├── specs/
│   ├── 000-product-overview.md   (this file)
│   ├── 001-auth.md
│   ├── 002-delegation.md
│   ├── 003-kms.md
│   └── 004-mcp-resources.md
├── docs/                          (usage guides, ADRs)
├── scripts/                       (repo tooling)
├── package.json
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── CLAUDE.md                      (Claude Code working-with-this-repo guide)
└── README.md
```

---

## 8. Provenance traceability

Every spec section that maps to existing smart-agent code cites the source file with a line range (`apps/web/src/lib/auth/native-session.ts:29-78`). This lets implementers cross-reference the reference implementation when porting. Citations decay over time as smart-agent evolves; treat them as "as of the 003-intent-marketplace-proposal branch on 2026-05-19" pointers, not live links.
