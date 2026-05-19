# Capability Index

**Generated** by `scripts/generate-capability-index.ts`. Do not edit by hand — re-run the script after manifest changes.

This is the routing index for Claude (and other agents) starting work in this repo. For each package, the table lists the canonical spec, public entry, and immediate `@agenticprimitives/*` dependencies.

## Packages

| Package | Kind | Stability | Spec | Depends on |
| --- | --- | --- | --- | --- |
| `@agenticprimitives/types` | shared | experimental | [101-v0-package-proposal.md](../../specs/101-v0-package-proposal.md) | _none_ |
| `@agenticprimitives/agent-account` | capability | experimental | [201-agent-account.md](../../specs/201-agent-account.md) | `types`, `identity-auth` |
| `@agenticprimitives/delegation` | capability | experimental | [202-delegation.md](../../specs/202-delegation.md) | `types`, `identity-auth`, `agent-account`, `key-custody` |
| `@agenticprimitives/identity-auth` | capability | experimental | [200-identity-auth.md](../../specs/200-identity-auth.md) | `types` |
| `@agenticprimitives/key-custody` | capability | experimental | [203-key-custody.md](../../specs/203-key-custody.md) | `types`, `identity-auth` |
| `@agenticprimitives/mcp-runtime` | capability | experimental | [205-mcp-runtime.md](../../specs/205-mcp-runtime.md) | `types`, `delegation`, `key-custody`, `tool-policy` |
| `@agenticprimitives/tool-policy` | capability | experimental | [204-tool-policy.md](../../specs/204-tool-policy.md) | `types` |

## Per-package summaries

### `@agenticprimitives/types`

Cross-cutting branded types: Address, Hex, ChainId, BrandedId. Types-only; no runtime code.

**Public exports** (4): `Address`, `Hex`, `ChainId`, `BrandedId`

**Read first:** [`CLAUDE.md`](../../packages/types/CLAUDE.md) · [`capability.manifest.json`](../../packages/types/capability.manifest.json) · [`src/index.ts`](../../packages/types/src/index.ts)

### `@agenticprimitives/agent-account`

ERC-4337 smart-account substrate. Deterministic addressing, factory deployment, ERC-1271 signing, UserOp building. Account-agnostic of which signer signs.

**Public exports** (2): `AgentAccountClient`, `UserOperation`

**Read first:** [`CLAUDE.md`](../../packages/agent-account/CLAUDE.md) · [`capability.manifest.json`](../../packages/agent-account/capability.manifest.json) · [`src/index.ts`](../../packages/agent-account/src/index.ts)

### `@agenticprimitives/delegation`

EIP-712 delegations spanning web app → agent → MCP. Caveats, token envelope, validation, session lifecycle.

**Public exports** (32): `ROOT_AUTHORITY`, `DelegationClient`, `SessionManager`, `SessionStore`, `buildCaveat`, `buildMcpToolScopeCaveat`, `buildDataScopeCaveat`, `buildDelegateBindingCaveat`, `encodeTimestampTerms`, `encodeValueTerms`, `encodeAllowedTargetsTerms`, `encodeAllowedMethodsTerms`, `hashDelegation`, `hashCaveats`, `evaluateCaveats`, `mintDelegationToken`, `verifyDelegationToken`, `verifyCrossDelegation`, `isRevoked`, `revokeDelegation`, `Delegation`, `Caveat`, `DataScopeGrant`, `DelegationTokenClaims`, `EnforcerAddressMap`, `JtiStore`, `CaveatContext`, `VerifyOpts`, `VerifyError`, `SessionRow`, `SessionPackage`, `SessionMeta`

**Read first:** [`CLAUDE.md`](../../packages/delegation/CLAUDE.md) · [`capability.manifest.json`](../../packages/delegation/capability.manifest.json) · [`src/index.ts`](../../packages/delegation/src/index.ts)

### `@agenticprimitives/identity-auth`

User auth (passkey + SIWE + Google OAuth), JWT sessions, CSRF, and pluggable Signer interfaces consumed by agent-account and delegation.

**Public exports** (15): `mintSession`, `verifySession`, `SESSION_COOKIE`, `SESSION_TTL_SECONDS`, `csrfTokenFor`, `verifyCsrf`, `deriveSaltFromLabel`, `deriveSaltFromEmail`, `Signer`, `PasskeySigner`, `EOASigner`, `KMSSigner`, `JwtClaims`, `AuthenticatedUser`, `AuthMethod`

**Read first:** [`CLAUDE.md`](../../packages/identity-auth/CLAUDE.md) · [`capability.manifest.json`](../../packages/identity-auth/capability.manifest.json) · [`src/index.ts`](../../packages/identity-auth/src/index.ts)

### `@agenticprimitives/key-custody`

Envelope encryption + signers + HMAC providers. local-AES/AWS-KMS/GCP-KMS backends behind one A2AKeyProvider interface. No session lifecycle (that's delegation's).

**Public exports** (16): `A2AKeyProvider`, `KmsAccountBackend`, `BuildOpts`, `buildKeyProvider`, `buildSignerBackend`, `buildToolExecutorBackend`, `buildMacProvider`, `getRelayOnlySigner`, `createKmsAccount`, `canonicalContextBytes`, `LocalAesProvider`, `LocalSecp256k1Signer`, `AwsKmsProvider`, `AwsKmsSigner`, `GcpKmsProvider`, `GcpKmsSigner`

**Read first:** [`CLAUDE.md`](../../packages/key-custody/CLAUDE.md) · [`capability.manifest.json`](../../packages/key-custody/capability.manifest.json) · [`src/index.ts`](../../packages/key-custody/src/index.ts)

### `@agenticprimitives/mcp-runtime`

Delegation-aware authorization middleware around the official MCP SDK. withDelegation/withCrossDelegation wrappers, JTI replay protection, classification routing.

**Public exports** (14): `withDelegation`, `withCrossDelegation`, `declareResource`, `createSqliteJtiStore`, `createPostgresJtiStore`, `createMemoryJtiStore`, `verifyDelegationForResource`, `verifyCrossDelegationForResource`, `McpResourceVerifyConfig`, `ResourceDefinition`, `MockDelegationSigner`, `createTestConfig`, `withMockedDelegationContext`, `lintMcpClassification`

**Read first:** [`CLAUDE.md`](../../packages/mcp-runtime/CLAUDE.md) · [`capability.manifest.json`](../../packages/mcp-runtime/capability.manifest.json) · [`src/index.ts`](../../packages/mcp-runtime/src/index.ts)

### `@agenticprimitives/tool-policy`

Protocol-agnostic classification taxonomy + risk tiers + exact-call DSL + decision engine. Consumable by any tool runtime.

**Public exports** (12): `RiskTier`, `ToolClassification`, `ExactCallPolicy`, `PolicyContext`, `PolicyDecision`, `declareTool`, `exactCall`, `matchesExactCall`, `evaluatePolicy`, `clampTtlForRiskTier`, `requiredCaveatsForRiskTier`, `lintClassification`

**Read first:** [`CLAUDE.md`](../../packages/tool-policy/CLAUDE.md) · [`capability.manifest.json`](../../packages/tool-policy/capability.manifest.json) · [`src/index.ts`](../../packages/tool-policy/src/index.ts)

## Dependency graph

```
types                (leaf)
agent-account        → types, identity-auth
delegation           → types, identity-auth, agent-account, key-custody
identity-auth        → types
key-custody          → types, identity-auth
mcp-runtime          → types, delegation, key-custody, tool-policy
tool-policy          → types
```
