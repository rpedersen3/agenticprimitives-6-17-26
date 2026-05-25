# Spec 101 — v0 Package Proposal

**Status:** v0 draft · 2026-05-19
**Depends on:** [`100-package-boundary-doctrine.md`](./100-package-boundary-doctrine.md)
**Replaces:** the package list embedded in [`000-product-overview.md`](./000-product-overview.md). When this proposal lands, that overview is updated and the original four-package scaffold (`auth`, `delegation`, `kms`, `mcp-resources`) is restructured per [`103-spec-reorganization-map.md`](./103-spec-reorganization-map.md).

---

## 1. v0 package set: six capability + one shared = seven packages

The user's four capability areas (user auth + smart account, delegation, KMS, MCP resources) become six packages once the boundary doctrine is applied. One small shared package handles cross-cutting types.

| # | Package | Area | Status |
| --- | --- | --- | --- |
| 1 | `@agenticprimitives/connect-auth` | Auth + smart account (1 of 2) | v0 |
| 2 | `@agenticprimitives/agent-account` | Auth + smart account (2 of 2) | v0 |
| 3 | `@agenticprimitives/delegation` | Delegation | v0 |
| 4 | `@agenticprimitives/key-custody` | KMS | v0 (narrower than my original scope) |
| 5 | `@agenticprimitives/tool-policy` | MCP resources (1 of 2) | v0 |
| 6 | `@agenticprimitives/mcp-runtime` | MCP resources (2 of 2) | v0 |
| 7 | `@agenticprimitives/types` | Cross-cutting | v0 |

**Deferred to v0.1+** (intentionally NOT in v0):

- `@agenticprimitives/a2a-runtime` (A2A protocol adapters; depend on `a2aproject/a2a-js` SDK)
- `@agenticprimitives/adapter-langchain`, `adapter-vercel-ai`, `adapter-mcp-transport-stdio` (framework adapters)
- `@agenticprimitives/contracts-abis`, `contracts-deployments` (when we publish our own contracts; we currently reference smart-agent's)
- `@agenticprimitives/credential-proof` (VCs, AnonCreds; not part of the original four areas)
- `@agenticprimitives/agent-naming` (ENS-style names; not part of the original four areas)
- Domain-specific packages (`treasury-controls`, `wallet-actions`, etc.) — these are smart-agent's product surface, not ours

---

## 2. Per-package detail

For each package: name, scope, what it owns, what it does NOT own, smart-agent provenance, competitive precedent, public API outline, dependencies.

---

### Package 1 — `@agenticprimitives/connect-auth`

**One-line:** Authenticate a user (passkey + SIWE + Google OAuth), mint sessions, expose pluggable signer interfaces.

**Owns:**
- Auth method modules: `./passkey`, `./siwe`, `./google` (tree-shakable subpaths).
- JWT session: mint, verify, key rotation. Cookie shape.
- CSRF helpers (origin allowlist, exact-match URL parsing).
- **Signer interfaces** (`PasskeySigner`, `EOASigner`, `KMSSigner`) — abstract surfaces that `agent-account` and `delegation` consume.
- Auth claim types (`JwtClaims`, `AuthenticatedUser`, `AuthMethod`).
- Salt-derivation utilities for deterministic account addressing (passkey label → salt, email → salt).

**Does NOT own:**
- HTTP route wiring (Next.js handlers stay in apps).
- Cookie I/O (just produces the value; consumer writes the header).
- The smart account itself (that's `agent-account`).
- Concrete KMS-backed signers (those live in `key-custody`; this package only defines the `KMSSigner` interface).
- OAuth client secrets and redirect URIs (consumer-supplied env).

**Smart-agent provenance:**
- `apps/web/src/lib/auth/native-session.ts:1-79`, `apps/web/src/lib/auth/jwt.ts`
- `apps/web/src/lib/auth/csrf.ts`
- `apps/web/src/app/api/auth/{passkey-signup,siwe-verify,google-callback}/route.ts`

**Competitive precedent for the split:**
- All four AA toolkits decouple signer from account (S1). Alchemy's `@account-kit/signer` is the closest direct precedent.
- Turnkey's stampers (`@turnkey/api-key-stamper`, `@turnkey/webauthn-stamper`) — credentials as a distinct package layer.
- Privy bundles these into one product, but Privy is a SaaS, not a primitives library. The signal we take from Privy is the UX bundling, not the SDK shape.

**Public API outline:**
```ts
// Session
export function mintSession(claims): string
export function verifySession(cookie): JwtClaims | null
export const SESSION_COOKIE; SESSION_TTL_SECONDS

// CSRF
export function csrfTokenFor(origin); verifyCsrf(token, allowed)

// Signer interfaces (consumed by agent-account, delegation)
export interface Signer { address: Address; signMessage; signTypedData }
export interface PasskeySigner extends Signer { credentialId; assert(challenge) }
export interface EOASigner extends Signer { /* viem-compatible */ }
export interface KMSSigner extends Signer { keyId; provider: string }

// Auth method subpaths
import * as passkey from '@agenticprimitives/connect-auth/passkey'
import * as siwe from '@agenticprimitives/connect-auth/siwe'
import * as google from '@agenticprimitives/connect-auth/google'

// Types
export type JwtClaims, AuthenticatedUser, AuthMethod
```

**Dependencies (within agenticprimitives):** none.

---

### Package 2 — `@agenticprimitives/agent-account`

**One-line:** ERC-4337 smart-account substrate: deterministic addressing, factory deployment, ERC-1271 signing, UserOp building.

**Owns:**
- `AgentAccountClient` — `.getAddress()`, `.createAccount()`, `.isDeployed()`, `.isOwner()`.
- UserOp building/signing helpers (delegates to a signer from `identity-auth`).
- ERC-1271 signature verification utilities (`isValidSignature()` round-trip).
- EntryPoint v0.8 client.
- Factory client (CREATE2 address derivation per salt).
- A2A bootstrap flow utilities (auth-bootstrap relayer signer pattern).

**Does NOT own:**
- The delegation primitive (that's `delegation`).
- Smart contract source (those live in smart-agent or future `@agenticprimitives/contracts`).
- Auth/identity flows (`identity-auth`).
- KMS/signing backends (consumers pass a `Signer` from `identity-auth`).
- Paymaster policy ("which paymaster to use when" — defer until needed).

**Smart-agent provenance:**
- `packages/sdk/src/account.ts:1-88`
- `packages/contracts/src/{AgentAccount,AgentAccountFactory,SmartAgentPaymaster}.sol` (referenced by address, not vendored)
- `apps/web/src/app/api/a2a/bootstrap/*` (the auth-bootstrap pattern)

**Competitive precedent for the split:**
- MetaMask DTK bundles smart-account WITH delegation, but their delegation only works with DeleGator. Our delegation is account-agnostic (ERC-1271-based), so the bundling logic doesn't apply.
- Alchemy: `@account-kit/smart-contracts` ships accounts as one package; signer is separate.
- ZeroDev: `@zerodev/sdk` is the account; permissions and validators are separate packages.
- Pimlico `permissionless/accounts`: per-implementation account factories, signer-agnostic.

**Public API outline:**
```ts
export class AgentAccountClient {
  constructor(opts: { rpcUrl; chainId; entryPoint; factory });
  getAddress(owner, salt): Promise<Address>;
  createAccount(params, signer): Promise<Address>;
  isOwner(account, address): Promise<boolean>;
  isDeployed(account): Promise<boolean>;
  signWithErc1271(account, hash, signer): Promise<Hex>;
  buildUserOp(account, calls, opts): Promise<UserOp>;
}
export function deriveSaltFromLabel(label: string): bigint;
export function deriveSaltFromEmail(email: string, rotation: number): bigint;
```

**Dependencies (within agenticprimitives):** `identity-auth` (for `Signer` interface).

---

### Package 3 — `@agenticprimitives/delegation`

**One-line:** EIP-712 smart-account delegations spanning web app → agent → MCP; issuance, mint, verify, redeem, revoke. **Now also owns session-key lifecycle** (per the KMS landscape signal).

**Owns:**
- `Delegation` struct, `Caveat` types, `DataScopeGrant`.
- Caveat builders (on-chain enforcers + off-chain sentinels).
- EIP-712 hashing (`hashDelegation`, `hashCaveats`).
- Caveat evaluator (fail-closed dispatcher).
- `DelegationClient` (browser-side issuance via signer from `identity-auth`).
- `mintDelegationToken` / `verifyDelegationToken` (node-side).
- `verifyCrossDelegation` (the on-behalf-of pattern).
- **Session lifecycle** (was in `kms`): create session (signer + delegation pair), persist encrypted, expire, revoke. The encryption layer is delegated to `key-custody`.
- On-chain revocation (`isRevoked`, `revokeDelegation`).
- `JtiStore` and `DelegationStore` interfaces (adapters live in consumer code or in `mcp-runtime`).

**Does NOT own:**
- Smart-account internals (that's `agent-account`).
- Envelope encryption mechanics or KMS backends (`key-custody`).
- HMAC inter-service auth (`key-custody/mac` subpath).
- MCP-specific transport or auth middleware (`mcp-runtime`).
- Policy taxonomy / risk tiers (`tool-policy`).
- Contract addresses (consumer-supplied via `EnforcerAddressMap`).

**Smart-agent provenance:**
- `packages/sdk/src/{delegation,delegation-token}.ts`
- `packages/sdk/src/policy/caveat-evaluator.ts`
- `apps/a2a-agent/src/routes/{session-init,session,delegation,onchain-redeem}.ts`
- `apps/person-mcp/src/auth/verify-delegation.ts:81-493`
- `apps/a2a-agent/src/db/schema.ts:35-86` (session row shape)

**Competitive precedent:**
- MetaMask DTK: `@metamask/delegation-core` (encoding/hashing primitives) — proves a separate delegation package is the norm.
- ZeroDev `@zerodev/permissions`, Rhinestone SmartSessions: session-as-delegation as its own package, account-agnostic.
- KMS landscape (Lit/Turnkey/Privy/CDP): unanimous that session lifecycle lives with the authority layer, not the KMS layer.

**Public API outline:**
```ts
// Caveat builders + hashing
export const ROOT_AUTHORITY
export function buildCaveat, encodeTimestampTerms, encodeValueTerms,
              encodeAllowedTargetsTerms, encodeAllowedMethodsTerms,
              buildMcpToolScopeCaveat, buildDataScopeCaveat,
              buildDelegateBindingCaveat
export function hashDelegation, hashCaveats, evaluateCaveats

// Issuance (browser)
export class DelegationClient { issueDelegation(params): Promise<Delegation> }

// Token mint + verify (node)
export function mintDelegationToken(claims, signMessage)
export function verifyDelegationToken(token, opts)
export function verifyCrossDelegation(d, callerPrincipal, targetServer, opts)

// Session lifecycle (NEW — absorbed from former kms scope)
export class SessionManager {
  constructor(opts: { keyCustody: KeyCustodyProvider; store: SessionStore });
  init(accountAddress, chainId): Promise<{ sessionId; sessionKeyAddress }>;
  package(sessionId, delegation): Promise<void>;
  resolve(sessionId): Promise<{ signer; delegation; meta }>;
  revoke(sessionId): Promise<void>;
}
export interface SessionStore { /* save, get, list, revoke */ }

// On-chain revocation
export function isRevoked(hash, opts)
export function revokeDelegation(hash, ctx)

// Types
export type Delegation, Caveat, DataScopeGrant, DelegationTokenClaims,
           EnforcerAddressMap, JtiStore
```

**Dependencies (within agenticprimitives):** `agent-account` (for `Signer` types, ERC-1271 verification), `key-custody` (for session encryption).

---

### Package 4 — `@agenticprimitives/key-custody`

**One-line:** Pluggable envelope encryption + signers (local-AES dev / AWS KMS / GCP KMS). **Now narrower:** no session lifecycle (moved to `delegation`).

**Owns:**
- `A2AKeyProvider` interface: `generateSessionDataKey`, `decryptSessionDataKey`, `signA2AAction`, `generateMac` (all optional).
- Built-in providers: `LocalAesProvider`, `AwsKmsProvider`, `GcpKmsProvider`, signer variants of each.
- Per-tool executor signers (`buildToolExecutorBackend(toolId, ...)`) — K5 pattern.
- AAD/canonical-context helpers (`buildSessionAAD`, `canonicalContextBytes`).
- viem adapter (`createKmsAccount(backend) → LocalAccount`).
- Relay-only signer (`getRelayOnlySigner` for Phase-B master-key safety).
- **HMAC inter-service auth** as a subpath: `@agenticprimitives/key-custody/mac` — `buildMacProvider(audience, opts)`. This stays in the package because the underlying backends are the same KMS, but lives behind a subpath because the threat model and consumer (transport layer) are different.

**Does NOT own:**
- Session lifecycle (delegated to `@agenticprimitives/delegation`).
- AAD shape decisions (caller provides `meta`; this package just enforces binding).
- Authority/policy decisions (those live in `delegation` + `tool-policy`).
- Production guardrails specific to a consumer's deployment (we expose env-driven guards; consumers wire them).

**Smart-agent provenance:**
- `packages/sdk/src/key-custody/{types,local-aes-provider,aws-kms-provider,gcp-kms-provider,*-signer,tool-executor-signer}.ts`
- `apps/a2a-agent/src/auth/{key-provider,a2a-signer,encryption,mac-provider}.ts`

**Competitive precedent for the narrower scope:**
- Lit Protocol splits `@lit-protocol/crypto`, `encryption`, `auth-helpers`, `pkp-*` — multiple packages around what we're keeping as one.
- Turnkey splits stampers (auth) from signers (chain) from core (KMS) — but session lives in core.
- Our consolidation rule: keep KMS-ops-with-same-backends in ONE package (subpath split for different threat models), move session lifecycle OUT (to `delegation`).

**Public API outline:**
```ts
// Provider interface
export interface A2AKeyProvider {
  keyVersion: string;
  generateSessionDataKey(input);
  decryptSessionDataKey(input);
  signA2AAction?(input);
  generateMac?(input);
}

// Backend factories
export function buildKeyProvider(opts: BuildOpts): A2AKeyProvider
export function buildSignerBackend(opts): KmsAccountBackend
export function buildToolExecutorBackend(toolId, opts): KmsAccountBackend
export function getRelayOnlySigner(opts): KmsAccountBackend

// Built-in providers (also via subpaths)
export { LocalAesProvider } from '@agenticprimitives/key-custody/local'
export { AwsKmsProvider } from '@agenticprimitives/key-custody/aws'
export { GcpKmsProvider } from '@agenticprimitives/key-custody/gcp'

// viem adapter
export async function createKmsAccount(backend, opts?): Promise<LocalAccountLike>

// AAD helpers
export function buildSessionAAD(meta): Record<string, string>
export function canonicalContextBytes(ctx)

// MAC providers (subpath: @agenticprimitives/key-custody/mac)
export function buildMacProvider(audience, opts): A2AKeyProvider
```

**Dependencies (within agenticprimitives):** none. (Pure crypto ops package — this maximizes reusability.)

---

### Package 5 — `@agenticprimitives/tool-policy`

**One-line:** Protocol-agnostic classification, risk tiers, and exact-call policy primitives. Consumable by MCP, A2A, and framework-tool runtimes.

**Owns:**
- Risk-tier taxonomy: `low | medium | high | critical`.
- Classification tags: `@sa-tool`, `@sa-auth`, `@sa-validation`, `@sa-risk-tier`, `@sa-owner`, `@sa-rate-limit`, `@sa-prod-gate`.
- `declareTool(definition, classification)` runtime metadata attachment.
- Policy decision engine: given `(tool, classification, delegation, caveat-context)` → `allow | deny | requires-consent`.
- Exact-call policy DSL: target / method / calldata-hash matching for high-risk operations.
- Audit-checkpoint metadata types.
- Lint helper (`lintClassification({ srcDir, requiredTags })`) reused from smart-agent's `scripts/check-person-mcp-classification.ts`.

**Does NOT own:**
- Protocol transport (MCP / A2A / LangChain — those are runtime packages).
- Delegation/caveat mechanics (`delegation`).
- Storage (consumer-supplied).
- Risk-tier enforcement specifics — this package decides; consumer enforces.

**Smart-agent provenance:**
- `scripts/check-route-classification.ts`, `scripts/check-person-mcp-classification.ts`
- `scripts/lib/person-mcp-classification-parser.ts`
- Risk-tier logic from `apps/web/src/lib/auth/session-grant-defaults.ts` (the `maxRisk` field).

**Competitive precedent:**
- Agent protocol SDKs report: **Strong signal to split tool-policy from mcp-runtime**, because tool-policy is consumable by A2A, LangGraph, Vercel AI. Widens adoption.
- MCP spec defines tool annotations (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`) as **non-enforced hints**. Our value-add: a stronger taxonomy with actual enforcement, consumable by any tool runtime.
- ERC-7715 permissions, Turnkey Policy Engine, Fireblocks TAP: every mature system has a separate policy concern from the credential/signing concern.

**Public API outline:**
```ts
export type RiskTier = 'low' | 'medium' | 'high' | 'critical'

export interface ToolClassification {
  '@sa-tool': 'delegation-verified' | 'service-only' | 'bootstrap' | 'dev-only'
  '@sa-auth': 'session-token' | 'service-hmac' | 'none' | 'none-with-csrf'
  '@sa-validation'?: 'shape-check' | 'json-schema' | 'none-no-body' | ...
  '@sa-risk-tier'?: RiskTier
  '@sa-owner'?: string
  '@sa-rate-limit'?: string
  '@sa-prod-gate'?: 'enabled' | 'disabled'
}

export function declareTool<T>(def: T, classification: ToolClassification): T & { _classification }

export interface PolicyContext {
  toolName: string
  classification: ToolClassification
  delegation?: Delegation     // from @agenticprimitives/delegation
  caveatContext?: CaveatContext
  callerKind: 'user-session' | 'agent-session' | 'service'
}

export type PolicyDecision =
  | { decision: 'allow' }
  | { decision: 'deny'; reason: string }
  | { decision: 'requires-consent'; promptId: string }

export function evaluatePolicy(ctx: PolicyContext): PolicyDecision

// Exact-call policy DSL
export function exactCall(target: Address, selector: Hex, calldataHash?: Hex): ExactCallPolicy
export function matchesExactCall(call, policy): boolean

// Lint
export async function lintClassification(opts: {
  srcDir: string
  requiredTags: string[]
}): Promise<LintResult>
```

**Dependencies (within agenticprimitives):** `types` (for shared `Address`, `Hex`). Optionally references `Delegation` from `delegation` as a peer-dep type. (Could be type-only import to avoid runtime dep.)

---

### Package 6 — `@agenticprimitives/mcp-runtime`

**One-line:** Delegation-aware authorization middleware around the official MCP SDK. The decision layer, not the SDK.

**Owns:**
- `withDelegation()` and `withCrossDelegation()` tool-handler wrappers.
- JTI replay protection (`createSqliteJtiStore`, `createPostgresJtiStore`, `createMemoryJtiStore`).
- MCP request envelope validation (HMAC service auth via `key-custody/mac`).
- Bridge: `(delegation result + policy decision)` → MCP tool error responses.
- Resource declaration helpers (`declareResource()` that joins `tool-policy` classification with MCP resource metadata).
- Test harness (`MockDelegationSigner`, `createTestConfig`, `withMockedDelegationContext`).

**Does NOT own:**
- MCP tool/resource/prompt registration (the official `@modelcontextprotocol/sdk` does this).
- Transports (stdio / Streamable HTTP — official SDK).
- OAuth 2.1 / PKCE / RFC-9728 / RFC-8707 plumbing (official SDK, post-2026-03-15 spec).
- The delegation primitive (`delegation`).
- Policy taxonomy (`tool-policy`).
- A2A protocol (deferred to `a2a-runtime` in v0.1).

**Smart-agent provenance:**
- `apps/{person,org,people-group}-mcp/src/auth/{verify-delegation,principal-context}.ts`
- `apps/person-mcp/src/tools/received-delegations.ts`
- The ~65% deduplication target across smart-agent's three mature MCPs is exactly the surface of this package.

**Competitive precedent:**
- Agent protocol SDKs report: the official MCP SDK already covers registration + transports + OAuth 2.1. Our value-add is **decision middleware** (delegation-chain-aware policy, JTI replay, classification enforcement, audit hooks with delegation context).
- FastMCP / FastMCP-TS exist as ergonomics layers but don't tackle delegation-aware auth or replay — that's our wedge.
- Coinbase AgentKit's `@coinbase/agentkit-model-context-protocol`: precedent for "MCP integration is a peer-dep package on the SDK."

**Public API outline:**
```ts
// Configuration
export interface McpResourceVerifyConfig {
  audience: string
  chainId: number
  rpcUrl: string
  delegationManager: Address
  enforcerMap: EnforcerAddressMap
  jtiStore: JtiStore
  acceptLegacyCrossDelegations?: boolean
}

// Tool wrappers
export function withDelegation<A>(config, handler): (args & { token }) => Promise<unknown>
export function withCrossDelegation<A>(config, handler): (args & { token; crossDelegationHash }) => Promise<unknown>

// JTI stores
export function createSqliteJtiStore(db, table?): JtiStore
export function createPostgresJtiStore(pool, table?): JtiStore
export function createMemoryJtiStore(): JtiStore

// Resource declarations (composes with @agenticprimitives/tool-policy)
export function declareResource(def, classification)

// Low-level escape hatches
export async function verifyDelegationForResource(token, config, ctx?)
export async function verifyCrossDelegationForResource(d, caller, targetServer, config)

// Test harness (subpath: @agenticprimitives/mcp-runtime/testing)
export { MockDelegationSigner, createTestConfig, withMockedDelegationContext }

// Classification lint (subpath: @agenticprimitives/mcp-runtime/lint)
export async function lintMcpClassification(opts)  // re-exports tool-policy's helper with MCP-specific defaults
```

**Dependencies (within agenticprimitives):** `delegation`, `tool-policy`, `key-custody` (for the HMAC envelope subpath). Peer dep on `@modelcontextprotocol/sdk`.

---

### Package 7 — `@agenticprimitives/types`

**One-line:** Cross-cutting branded types and chain primitives shared by ≥2 packages. **Minimal by design.**

**Owns:**
- `Address`, `Hex` (branded `0x${string}` types).
- `ChainId` (branded number).
- `BrandedId<T>` helper for opaque IDs.
- Generic result envelopes if a stable shape emerges (defer until two packages need the same envelope shape).

**Does NOT own:**
- Domain vocabulary.
- Anything used by only one package (those stay in that package).
- Runtime code (this is types-only; no side effects).

**Smart-agent provenance:** `packages/types/src/index.ts` (smart-agent has this; we keep it minimal).

**Why a separate package** (per the boundary doctrine S3-adjacent principle):
- Types-only packages have a different release cadence (rarely change).
- Putting `Address` in any one capability package would either force back-edges or duplicate the type.
- Smart-agent has the same package for the same reason.

**Public API:**
```ts
export type Address = `0x${string}`
export type Hex = `0x${string}`
export type ChainId = number & { readonly __chainId: unique symbol }
export type BrandedId<T extends string> = string & { readonly __brand: T }
```

**Dependencies:** none.

---

## 3. Dependency graph (final)

```
identity-auth      types              key-custody
      ↑              ↑                       ↑
agent-account ◄──────┼───────────────────────┤
      ↑              │                       │
delegation ──────────┼───────────────────────┘
      ↑              │
tool-policy ─────────┘
      ↑
mcp-runtime
```

`types` is a leaf consumed by most others. No cycles. Each arrow represents "imports from."

---

## 4. Naming check against the doctrine

| Package | Discoverable from name? | Doctrine violation? |
| --- | --- | --- |
| `identity-auth` | ✓ (auth + identity) | None |
| `agent-account` | ✓ (the agent's account) | None |
| `delegation` | ✓ | None |
| `key-custody` | ✓ (keys custodied by KMS) | None |
| `tool-policy` | ✓ (policy applied to tools) | None |
| `mcp-runtime` | ✓ (runtime layer for MCP servers) | None |
| `types` | weak (generic) — but smart-agent uses it, and convention is strong | Acceptable |

All names are nouns of capability, kebab-case, scoped. No `core`/`common`/`utils`/`shared`.

---

## 5. What this proposal explicitly defers

Deferring is a feature, not a gap. Each of these has been considered and consciously postponed:

- **A2A runtime** — `a2aproject/a2a-js` exists; defer until we have a clear adapter need.
- **Framework adapters** (LangChain / Vercel AI / Anthropic Computer Use) — strong Coinbase signal but not core; add once consumer demand surfaces.
- **Static-artifact packages** (`*-abis`, `*-deployments`) — we currently reference smart-agent's contract addresses; add when we publish our own.
- **Domain packages** (treasury, wallet-actions, agentic-payments, etc.) — smart-agent's surface, not agenticprimitives'. We are a primitives library.
- **`@agenticprimitives/sdk` facade** — wait until ≥3 consumers ask for it.
- **Ontology / GraphDB packages** — smart-agent's product layer, out of scope here.

---

## 6. Approval checklist

Before scaffolding, the reader should answer:

1. Do the 6 capability packages cleanly map to the original four areas? **(Yes:** auth+account → 2 packages; delegation → 1; KMS → 1 narrower; MCP resources → 2 (mcp-runtime + tool-policy).)
2. Is any package likely to merge with another in the first 6 months? (If yes, defer the split.)
3. Is any package missing a clear "what it does NOT own" boundary? (Per doctrine §2, all three questions for splitting should be "yes.")
4. Does the dependency graph have any cycles or back-edges? (No.)
5. Will Claude be able to load any one package's `CLAUDE.md` + `capability.manifest.json` and do useful work without reading the others? (Per doctrine §7, yes by design.)

If any answer is uncertain, raise it before the rescaffold.
