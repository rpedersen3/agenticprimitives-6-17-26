# Spec 100 — Package Boundary Doctrine

**Status:** v0 draft · 2026-05-19
**Purpose:** principles for sizing, naming, and bounding `@agenticprimitives/*` packages, derived from competitive landscape analysis (MetaMask DTK, 1claw, Coinbase AgentKit, Alchemy Account Kit, ZeroDev, Pimlico, Safe, Turnkey, Lit Protocol, Privy, MCP SDK, A2A SDK) and the smart-agent capability-package plan.

This document is the answer to "how do we decide what goes in one package vs. two."

---

## 1. The five cross-cutting signals from competitive research

Patterns that EVERY mature toolkit in our space follows. Departing from these requires explicit justification.

### S1. Signer is a pluggable peer of the smart account, not embedded
- MetaMask DTK: `WalletSignerConfig` / `WebAuthnSignerConfig` accepted by `toMetaMaskSmartAccount`. No signer package; signer is an interface the account consumes.
- Pimlico, Safe, ZeroDev: take a viem `LocalAccount`; ship no signer themselves.
- Alchemy: `@account-kit/signer` is its own package separate from accounts.
- Turnkey: stampers (`@turnkey/api-key-stamper`, `@turnkey/webauthn-stamper`) are distinct from `@turnkey/core` and from chain signers.

**Doctrine:** Auth/credential layer goes in its own package, not bundled with account.

### S2. Account implementation and delegation primitive go together when the delegation is account-specific; apart when the delegation is account-agnostic
- MetaMask DTK: DeleGator account + delegation primitive are inseparable → one package (`@metamask/smart-accounts-kit`).
- ZeroDev: Kernel account in `@zerodev/sdk`, but permissions/session-keys in **`@zerodev/permissions`** (separate).
- Pimlico + Rhinestone: accounts in `permissionless/accounts`; session keys in `@rhinestone/module-sdk` — fully account-agnostic.
- Safe: relies on Rhinestone for session keys.

**Doctrine:** If our delegation works across multiple smart-account implementations (ours + any ERC-1271 account), it gets its own package. If it only works with our specific account, it bundles. Smart-agent's delegation is ERC-1271-based and account-agnostic → **split**.

### S3. Static artifacts go in tiny dedicated packages
- MetaMask: `@metamask/delegation-abis` (ABIs only), `@metamask/delegation-deployments` (addresses only), `@metamask/delegation-core` (pure encoding).
- 1claw: `@1claw/openapi-spec` — two files, one job, every other SDK depends on it.

**Doctrine:** Anything that's "static contract" (ABIs, addresses, schemas, encoding-only functions) deserves its own micro-package because it has a different release cadence and zero runtime deps. We defer this for v0 (no contracts yet shipped from agenticprimitives), but plan a `@agenticprimitives/contracts-abis` package when we do.

### S4. Session lifecycle lives with delegation/authority, not with KMS
- Lit Protocol: SessionSigs in `@lit-protocol/auth-helpers`, not in `pkp-*` signing packages.
- Turnkey: UserSession in `@turnkey/core`, tightly coupled to stampers (credential layer), not to chain signers.
- Privy: server sessions tied to the authorization key (credential layer).
- Coinbase CDP: "delegated signing" is the session abstraction; lives with policy APIs.

**Doctrine:** "What can this session do and when does it expire" is an authority question. It belongs in the package that owns authority (delegation), not in the package that owns key material (KMS).

### S5. Framework adapters are tiny peer-dep packages, never bundled
- Coinbase AgentKit: `@coinbase/agentkit-langchain`, `@coinbase/agentkit-vercel-ai-sdk`, `@coinbase/agentkit-model-context-protocol` — each a separate package, all peer-dep on core.
- 1claw: `1claw-langchain-demo` is a separate repo.
- Turnkey: `@turnkey/ethers`, `@turnkey/viem`, `@turnkey/solana` — one per integration target.

**Doctrine:** When we ship integrations with LangChain / Vercel AI / Anthropic Computer Use / MCP transport adapters, each goes in its own `@agenticprimitives/adapter-*` package with the framework as a peer dep. Defer for v0; plan for v0.1.

---

## 2. Boundary decision rule

For each candidate boundary, ask three questions in order. **All three must be "yes" to justify a separate package.**

1. **Independent consumer:** Can a real developer adopt this package without adopting the others? (e.g., "I want your delegation primitive but I'll bring my own smart account.")
2. **Independent release cadence:** Will this package's breaking changes ever land independent of its neighbor's? (Static-artifact packages always pass; tightly-coupled clients often fail.)
3. **Threat model or runtime distinction:** Is there a security boundary, a runtime split (browser vs node), or a transitive-dependency cost that makes co-location harmful?

If two of the three are "yes" but one is "marginal," prefer a **subpath export** over a separate package (e.g., `@agenticprimitives/key-custody/mac`). Subpath exports can be promoted to separate packages later without breaking imports if the original package re-exports them.

---

## 3. Dependency direction (strict, no cycles)

```
┌──────────────────────────────────────────────────────────────┐
│ identity-auth      (no @agenticprimitives/* deps; the user-  │
│                     identity layer is the base)              │
│      ↑                                                       │
│ agent-account      (consumes identity-auth's signer types)   │
│      ↑                                                       │
│ key-custody        (no deps on other @ap/*; pure crypto ops) │
│      ↑                                                       │
│ delegation         (consumes account types; uses key-custody │
│                     for signing session tokens)              │
│      ↑                                                       │
│ tool-policy        (no deps on other @ap/*; pure taxonomy +  │
│                     decision engine, protocol-agnostic)      │
│      ↑                                                       │
│ mcp-runtime        (consumes delegation + tool-policy)       │
└──────────────────────────────────────────────────────────────┘
```

Hard rules (CI-enforced when scripts land):

- No back-edges. If `delegation` needs something from `mcp-runtime`, raise the shared type into `delegation` or into a future `@agenticprimitives/types`.
- No deep imports across packages. Only public entry points (`./` and declared subpaths) may be imported.
- `tool-policy` and `key-custody` MUST stay protocol-agnostic so they can be consumed by future `a2a-runtime`, LangGraph adapters, etc.
- Domain vocabulary (anything specific to a vertical — payments, identity, governance, etc.) does NOT live in agenticprimitives v0. Add it as a separate `@agenticprimitives/domain-*` or `@agenticprimitives/<capability>` package when content earns it.

---

## 4. Subpath export vs separate package decision

A subpath (e.g., `@agenticprimitives/key-custody/aws`) is correct when:

- The submodule shares a release cadence with the parent (a fix to envelope encryption ships at the same time as a fix to the AWS provider).
- It has the same threat-model owner.
- It's optional (consumers paying tree-shaking cost for unused providers is fine; subpath exports + side-effect-free modules let the bundler eliminate them).

A separate package is correct when:

- The submodule has its own audit boundary (e.g., per-tool executor signers in production have separate IAM scopes).
- The submodule's deps would bloat the parent for consumers who don't use it (e.g., AWS SDK pulled into the local-dev path).
- The submodule has an independently meaningful publish (e.g., framework adapters where consumers pin different framework versions).

For v0, prefer subpath exports unless the dep-bloat case is clear.

---

## 5. Naming conventions

| Convention | Choice | Why |
| --- | --- | --- |
| Scope | `@agenticprimitives/*` | npm-scoped, capability-named. Aligns with smart-agent's `@smart-agent/*` style. |
| Repo dirs | `packages/<name>/` (no `@scope/` prefix in path) | Matches pnpm-workspace convention. |
| Package names | **Noun-of-capability**, kebab-case: `agent-account`, `identity-auth`, `delegation`, `key-custody`, `tool-policy`, `mcp-runtime` | Discoverable from name alone — the 1claw test. |
| Adapter packages | `adapter-<framework>`: `adapter-langchain`, `adapter-vercel-ai`, `adapter-mcp-transport-stdio` | Coinbase pattern; clarifies "this is glue, not core." |
| Static-artifact packages | `<thing>-abis`, `<thing>-deployments`, `<thing>-spec` | MetaMask + 1claw pattern. |
| Experimental | Behind `./experimental` subpath in the owning package, never a top-level export | MetaMask DTK pattern. |

**Names we deliberately avoid:**
- `core`, `common`, `utils`, `shared` (low-information dumping grounds)
- Domain words like `church`, `ministry`, `health`, `travel` (these belong in a separate domain layer)
- `sdk` as a top-level package name (reserve for an optional facade once consumers ask for one, à la smart-agent's `@smart-agent/sdk`)

---

## 6. What stays in apps, not in packages

Drawing from MetaMask DTK's pattern of "no auth, no agent runtime in the toolkit":

- HTTP route wiring (Next.js / Hono / Express handlers)
- Cookie reading/writing specifics
- Database schemas (consumers bring their own)
- OAuth provider client IDs/secrets
- UI components (`AuthGate`, `LoginButton`, etc.)
- Post-login redirect logic
- App-specific environment parsing (each app's `.env` shape)

A primitives library exposes the algorithms and types; the consumer app wires them to HTTP and UI.

---

## 7. Claude routing as a product feature

Every package must be a self-contained agent-loadable unit:

- `CLAUDE.md` ≤ 900 words: what the package owns, what it doesn't, which files to read first, security invariants, validate-commands.
- `capability.manifest.json`: machine-readable ownership, dependencies, forbidden imports, ignored generated files.
- `spec.md` (or pointer to root `specs/`): the contract.
- `README.md` ≤ 1800 words: consumer-facing quickstart.

A Claude session starting in a package directory should be able to do meaningful work in that package within ~5k tokens of context overhead. If a package's CLAUDE.md is bloating or its boundaries are unclear, treat that as a doctrine violation — fix the package shape, don't add more docs.

---

## 8. What changes from my initial 4-package scaffold

Comparing my original scaffold against this doctrine:

| Original | Issue | Fix |
| --- | --- | --- |
| `auth` bundled smart-account + identity | Violates S1 (signer pluggable) and S2 (account-agnostic delegation) | Split into `identity-auth` + `agent-account` |
| `kms` bundled session lifecycle, HMAC providers, envelope encryption | Violates S4 (sessions ≠ KMS) | Narrow to envelope+signers; session moves to `delegation`; HMAC stays as subpath |
| `mcp-resources` bundled MCP middleware + policy taxonomy | Mixes protocol-specific with protocol-agnostic | Split into `mcp-runtime` (MCP-specific) + `tool-policy` (protocol-agnostic) |
| 4 total | Too coarse for product-facing primitives library | 6 total at v0 |

Net effect: same four capability areas (per user constraint), but each area's internal boundary is now earned by competitive evidence rather than chosen for convenience.
