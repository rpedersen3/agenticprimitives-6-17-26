# @agenticprimitives/delegation — Claude guide

## NOT the credential-recovery layer
A delegation is **agent → agent** authority: SA A grants SA B the right to take scoped actions on A's behalf. It is NOT a credential change. Adding, replacing, or removing a passkey / SIWE EOA / hardware wallet on an SA is a [credential-recovery operation](../../docs/architecture/decisions/0011-credential-recovery-and-re-association.md) routed through [`@agenticprimitives/custody`](../custody) — NEVER through a Caveat, Steward grant, session, or token here. A delegation issued by an SA MUST remain valid across that SA's credential rotation (principal = SA address, not the credential). A delegated party MUST NOT gain custody powers through delegation. See [ADR-0011](../../docs/architecture/decisions/0011-credential-recovery-and-re-association.md) + [spec 221](../../specs/221-credential-recovery.md).

## What this package owns
- `Delegation` struct, `Caveat` types, `DataScopeGrant`. EIP-712 hashing.
- Caveat builders (8 on-chain enforcers + 3 off-chain sentinels) and the **fail-closed** evaluator.
- `DelegationClient` (browser-side issuance via a `Signer`).
- Token mint/verify: `mintDelegationToken`, `verifyDelegationToken`, `verifyCrossDelegation`.
- **Session lifecycle** — `SessionManager`, `SessionStore`, `SessionRow`, `SessionPackage`, `SessionMeta`. Absorbed from former kms scope per [ADR-0002](../../docs/architecture/decisions/0002-session-lifecycle-in-delegation.md).
- On-chain revocation (`isRevoked`, `revokeDelegation`).
- `JtiStore` interface (adapters live in `mcp-runtime`).

## What this package does NOT own
- Smart-account internals → [`agent-account`](../agent-account) (we use it for ERC-1271 verification only).
- KMS provider implementations, envelope encryption algorithms, AAD encoding → [`key-custody`](../key-custody).
- MCP-specific transport or wrappers → [`mcp-runtime`](../mcp-runtime).
- Policy taxonomy / risk tiers → [`tool-policy`](../tool-policy).
- Contract addresses (caller-supplied via `EnforcerAddressMap`).

## Vocabulary
**Owns:** `Delegation`, `Caveat`, `Enforcer`, `DelegationToken`, `principal`, `SessionManager`, `SessionRow`, `SessionPackage`, `SessionMeta`, `JtiStore` (interface), `EnforcerAddressMap`.
**Disambiguation (critical):**
- **"session"** here = `SessionRow` binding a `Delegation` to a session-signing keypair. In [`identity-auth`](../identity-auth) "session" is a JWT-cookie session — completely different concept.
- **"signer"** here = a `Signer` from `identity-auth`. We consume; we don't define the interface.
- **"AAD"** is named here at the shape level (what fields go in) but encoded by `key-custody.canonicalContextBytes`.
- **"principal"** = the verified `delegator` address after verification. Used by `mcp-runtime` as `principal: Address` in handler args.
See [`docs/architecture/vocabulary-map.md`](../../docs/architecture/vocabulary-map.md).
**Does not use:** concrete KMS backends (`LocalAesProvider`, `AwsKmsProvider`, `GcpKmsProvider`), `AES-GCM`, `evaluatePolicy`, `withDelegation`, `@modelcontextprotocol`, `passkey`/`SIWE` internals. See `capability.manifest.json:forbiddenTerms`.

## Read these first (in order)
1. `capability.manifest.json` — boundary
2. `src/index.ts` — public API surface (32 exports)
3. `../../specs/202-delegation.md` — the contract (8 caveat types, sentinels, full lifecycle)
4. `../../docs/architecture/decisions/0002-session-lifecycle-in-delegation.md` — why session lifecycle is here
5. `../../docs/architecture/vocabulary-map.md` — when "session" is ambiguous
6. `src/caveats.ts` (builders + evaluator); `src/sessions.ts` (SessionManager); `src/token.ts` (mint + verify)

## Stable public exports
**Caveats:** `ROOT_AUTHORITY`, `buildCaveat`, `buildMcpToolScopeCaveat`, `buildDataScopeCaveat`, `buildDelegateBindingCaveat`, `encodeTimestampTerms`, `encodeValueTerms`, `encodeAllowedTargetsTerms`, `encodeAllowedMethodsTerms`
**Hashing:** `hashDelegation`, `hashCaveats`, `evaluateCaveats`
**Browser:** `DelegationClient`
**Sessions:** `SessionManager`, `SessionStore`
**Token:** `mintDelegationToken`, `verifyDelegationToken`, `verifyCrossDelegation`
**On-chain:** `isRevoked`, `revokeDelegation`
**Types:** `Delegation`, `Caveat`, `DataScopeGrant`, `DelegationTokenClaims`, `EnforcerAddressMap`, `JtiStore`, `CaveatContext`, `VerifyOpts`, `VerifyError`, `SessionRow`, `SessionPackage`, `SessionMeta`

## Allowed imports
`@agenticprimitives/types`, `@agenticprimitives/identity-auth` (`Signer` types), `@agenticprimitives/agent-account` (ERC-1271 verification), `@agenticprimitives/key-custody` (`A2AKeyProvider`, `canonicalContextBytes`), `viem`, `@noble/curves`, `@noble/hashes`.

## Forbidden imports
- `apps/*`
- `tool-policy`, `mcp-runtime` (they depend on us; back-edges create cycles).
- `@modelcontextprotocol/sdk` (transport-specific; `mcp-runtime`'s job).

## Drift triggers — STOP and route
- "Implement AES-GCM, envelope encryption, or a KMS backend" — **STOP.** Belongs in [`key-custody`](../key-custody). Consume the `A2AKeyProvider` interface; don't reimplement primitives. [ADR-0002](../../docs/architecture/decisions/0002-session-lifecycle-in-delegation.md).
- "Add an MCP-specific verify wrapper or HMAC envelope" — **STOP.** Belongs in [`mcp-runtime`](../mcp-runtime). [ADR-0004](../../docs/architecture/decisions/0004-mcp-runtime-as-middleware.md).
- "Define a risk tier or classification taxonomy" — **STOP.** Belongs in [`tool-policy`](../tool-policy). [ADR-0003](../../docs/architecture/decisions/0003-tool-policy-protocol-agnostic.md).
- "Implement a custom auth method or JWT session" — **STOP.** Belongs in [`identity-auth`](../identity-auth).
- "Add an `AgentAccountClient` method (deploy / getAddress / etc.)" — **STOP.** Belongs in [`agent-account`](../agent-account).
- "Add a permissive default to the caveat evaluator" — **HARD STOP.** Fail-closed is a security invariant. Unknown enforcer → reject. No exceptions.

## Before you write code
- [ ] Is the change about caveats, EIP-712 hashing, token envelope, session lifecycle, or on-chain revocation?
- [ ] If "session" appears in my change, am I sure I mean **delegation's `SessionRow`** (right place) and not `identity-auth`'s JWT session?
- [ ] If I'm encrypting bytes, am I calling `key-custody` primitives — not reimplementing them here?
- [ ] If I'm changing caveat eval, did I preserve fail-closed semantics? Unknown enforcer → reject.
- [ ] Did I update `specs/202-delegation.md` if the public API or behavior changed?
- [ ] Are session private keys handled only as encrypted payloads at rest?

## Security invariants (DO NOT BREAK)
- **Caveat evaluator MUST be fail-closed.** Unknown enforcer addresses → reject. Verbatim from smart-agent's evaluator.
- **Session private keys MUST never appear in plaintext at rest.** Always envelope-encrypted via `key-custody` before persistence.
- **Tokens MUST embed delegation AND session-key signature over canonical claims.** Verification recovers session key from signature; mismatch → reject.
- **JTI usage tracking MUST be atomic.** Safe under concurrent writers; never decrement; never double-count.
- **DelegateBinding caveat MUST validate BOTH `delegateSmartAccount` AND `delegatePersonAgent`.** Skipping either is a known regression pattern.

## Validate the package
```bash
pnpm --filter @agenticprimitives/delegation typecheck
pnpm --filter @agenticprimitives/delegation test
pnpm check:forbidden-terms
```

## Common task routing
- Adding a new caveat type → `src/caveats.ts` (builder + encoder), `src/evaluator.ts` (dispatch entry), `src/index.ts` (export). Add a golden test.
- Changing token envelope → `src/token.ts`; coordinate with `mcp-runtime` (it parses).
- Adding a session lifecycle method → `src/sessions.ts`; integration test in this package.

## Capabilities this package participates in
- **Multi-sig + threshold policy** — see [spec 207](../../specs/207-smart-account-threshold-policy.md) + [demo guide](../../apps/demo-web-pro/docs/multi-sig/guide.md). This package owns: `buildQuorumCaveat` (peer of the existing caveat builders) + the `requireQuorumForTier` opt on `verifyDelegationToken`. Signer set is implicit in the caveats a `Delegation` carries; threshold=1 is the trivial case.
- **Audit / forensics trail** — see [spec 206](../../specs/206-audit.md) + [demo guide](../../apps/demo-mcp/docs/audit/guide.md). This package emits: `delegation.mint` (on `mintDelegationToken`), `delegation.verify.accept` + `delegation.verify.reject` (on `verifyDelegationToken`).
- Index of cross-cutting capabilities: [`docs/architecture/cross-cutting-capabilities.md`](../../docs/architecture/cross-cutting-capabilities.md).

## Generated files (ignore)
`dist/`, `node_modules/`, `coverage/`, `*.tsbuildinfo`, `test/fixtures/golden/`.
