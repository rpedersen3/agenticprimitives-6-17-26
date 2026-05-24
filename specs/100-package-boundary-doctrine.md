# Spec 100 — Package Boundary Doctrine

**Status:** v0 draft · 2026-05-19 (amended 2026-05-24)
**Purpose:** principles for sizing, naming, and bounding `@agenticprimitives/*` packages, derived from competitive landscape analysis (MetaMask DTK, 1claw, Coinbase AgentKit, Alchemy Account Kit, ZeroDev, Pimlico, Safe, Turnkey, Lit Protocol, Privy, MCP SDK, A2A SDK) and the smart-agent capability-package plan.

This document is the answer to "how do we decide what goes in one package vs. two."

**Identity doctrine (load-bearing):** [ADR-0010](../docs/architecture/decisions/0010-smart-agent-canonical-identifier.md) (canonical Smart Agent identifier), [ADR-0011](../docs/architecture/decisions/0011-credential-recovery-and-re-association.md) (credentials rotate; identity persists), [spec 220](./220-agent-identity-bootstrap.md) (bootstrap sequence).

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

## 3. Canonical Smart Agent identity model

Every person, org, service, treasury, or role agent has **one** canonical identifier: its ERC-4337 Smart Agent address, expressed on the wire as CAIP-10 `eip155:<chainId>:<smartAgentAddress>`. Everything else is a **facet** that points AT that address.

| Layer | Package(s) | Role |
| --- | --- | --- |
| **Anchor** | `agent-account` | Owns deployment, address derivation, UserOps, ERC-1271. The SA address is the identity. |
| **Facet registries** | `agent-naming`, `agent-identity` | Parallel downstream registries: human-readable names and typed off-chain profiles. Neither is the identity. |
| **Connection / bootstrap** | `identity-auth` | Passkey / SIWE / OAuth ceremonies, JWT sessions, `Signer` interfaces. Resolves **credential → canonical SA**; does not own the SA or mutate custodian sets. |
| **Credential lifecycle** | `custody` (+ on-chain `CustodyPolicy`) | Enroll, rotate, recover control credentials on the **same** SA ([ADR-0011](../docs/architecture/decisions/0011-credential-recovery-and-re-association.md)). Not `identity-auth`, not `delegation`. |
| **Shared wire types** | `types` | `Address`, `NameContext` (display-only injection). Canonical-identity shapes (`CanonicalAgentIdentity`, facet records) belong here when ≥2 packages need them ([ADR-0010](../docs/architecture/decisions/0010-smart-agent-canonical-identifier.md)). |

**Vocabulary firewall (do not conflate):**

- **`identity-auth`** = authentication and signing interfaces. Despite the name, it is **not** the canonical identity owner.
- **`agent-identity`** = profile / AgentCard facet registry (HCS-11-aligned JSON + endpoint verification). Not login, not naming.
- **`agent-naming`** = `.agent` name facet registry (ENS-v2-style resolution). Not the root identifier.
- **Cross-package APIs** key off `Address` or `canonicalAgentId` (CAIP-10), never a bare `.agent` name ([ADR-0006](../docs/architecture/decisions/0006-agent-naming-as-resolution-layer.md)).

**Bootstrap** (spec 220) is composed at the **app** layer: deploy SA → register naming facet → enroll custodians → optional profile facet → optional external facets. No single package owns the full orchestration.

**CREATE2 salt** derives from auth methods + stable user scope only — **never** from a chosen `.agent` name or profile label. `identity-auth`'s `deriveSaltFromLabel` is a user-scope input, not a name registration.

---

## 4. Dependency direction (strict, no cycles)

Implementation layering (signer interfaces, cycle avoidance) is **not** the same as semantic identity ownership:

```
┌──────────────────────────────────────────────────────────────┐
│ types              (leaf; Address, NameContext, future        │
│                     canonical-identity shapes)               │
│      ↑                                                       │
│ identity-auth      (no other @ap/* deps; auth + Signer IFs;  │
│                     resolves credential → SA at app layer)   │
│      ↑                                                       │
│ agent-account      (canonical SA owner; consumes Signer)     │
│      ↑                                                       │
│ ┌────┴────┐  custody (credential set on SA; forbidden from   │
│ │         │  importing facet registries)                     │
│ agent-naming   agent-identity   (sibling facet packages;     │
│ (names)        (profiles)        must not import each other) │
│      ↑                                                       │
│ key-custody        (pure crypto; no @ap/* deps)              │
│      ↑                                                       │
│ delegation         (agent → agent authority; principals = SA)│
│      ↑                                                       │
│ tool-policy        (protocol-agnostic policy engine)          │
│      ↑                                                       │
│ mcp-runtime        (MCP transport + delegation glue)         │
└──────────────────────────────────────────────────────────────┘
```

Hard rules (CI-enforced):

- No back-edges. If `delegation` needs something from `mcp-runtime`, raise the shared type into `delegation` or into `@agenticprimitives/types`.
- No deep imports across packages. Only public entry points (`./` and declared subpaths) may be imported.
- `agent-naming` and `agent-identity` are **siblings** — neither imports the other. Apps compose name → address → profile.
- `delegation`, `mcp-runtime`, `tool-policy`, `audit`, `custody` MUST NOT import `agent-naming` or `agent-identity`. Optional human-readable context is injected via `NameContext` from `types` ([ADR-0006](../docs/architecture/decisions/0006-agent-naming-as-resolution-layer.md)).
- `tool-policy` and `key-custody` MUST stay protocol-agnostic.
- Domain vocabulary (vertical-specific) does NOT live in agenticprimitives v0 unless it earns a dedicated package.

---

## 5. Subpath export vs separate package decision

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

## 6. Naming conventions

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

## 7. What stays in apps, not in packages

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

## 8. Package consumer documentation standard

Reference implementation: [`packages/agent-naming/`](../packages/agent-naming/). Identity-stack packages (`agent-account`, `agent-identity`, `identity-auth`) follow the same shape.

Every capability package ships:

| Artifact | Purpose |
| --- | --- |
| `README.md` | ≤ 1800 words. Use / do-not-use, install, 60-second quickstart, main concepts (link out), common recipes, subpaths, security summary, **documentation map**, validation commands. |
| `docs/concepts.md` | Vocabulary, mental model, how this package relates to canonical SA vs facets. |
| `docs/api.md` | Human-readable guide synced with `capability.manifest.json` `publicExports`. |
| `docs/security.md` | Invariants, trust boundaries, what this package does **not** prove. |
| `docs/troubleshooting.md` | Common errors and mis-wiring (especially facet vs identity confusion). |
| `docs/migration.md` | Version notes and migration from ad-hoc patterns. |
| `CLAUDE.md` | ≤ 60 lines agent routing, drift triggers, link to documentation map. |
| `AUDIT.md` | ≤ 150 lines security audit notes. |
| `capability.manifest.json` | Machine-readable boundary. |
| `spec.md` | Pointer to `specs/2XX-*.md`. |

**README must state explicitly** for identity-adjacent packages:

- Whether the package owns the canonical identifier, a facet registry, or credential connection.
- That cross-package identifiers are `Address` / CAIP-10, not names.
- Which sibling package to use instead for out-of-scope work.

---

## 9. Claude routing as a product feature

Every package must be a self-contained agent-loadable unit:

- `CLAUDE.md` ≤ 60 lines: what the package owns, facet vs canonical role, read-first files, drift triggers, validate commands, link to `docs/`.
- `capability.manifest.json`: machine-readable ownership, dependencies, forbidden imports.
- `spec.md` (or pointer to root `specs/`): the contract.
- `README.md` + `docs/*`: consumer-facing depth (see §8).

A Claude session starting in a package directory should do meaningful work within ~5k tokens of context overhead. If `CLAUDE.md` bloats, move prose to `docs/concepts.md` — do not weaken boundaries.

---

## 10. What changes from my initial 4-package scaffold

Comparing my original scaffold against this doctrine:

| Original | Issue | Fix |
| --- | --- | --- |
| `auth` bundled smart-account + identity | Violates S1 (signer pluggable) and S2 (account-agnostic delegation) | Split into `identity-auth` + `agent-account` |
| `kms` bundled session lifecycle, HMAC providers, envelope encryption | Violates S4 (sessions ≠ KMS) | Narrow to envelope+signers; session moves to `delegation`; HMAC stays as subpath |
| `mcp-resources` bundled MCP middleware + policy taxonomy | Mixes protocol-specific with protocol-agnostic | Split into `mcp-runtime` (MCP-specific) + `tool-policy` (protocol-agnostic) |
| 4 total | Too coarse for product-facing primitives library | 6 total at v0 |

Net effect: same four capability areas (per user constraint), but each area's internal boundary is now earned by competitive evidence rather than chosen for convenience.
