# @agenticprimitives/connect-auth — Claude guide

## Resolves to canonical Smart Agent
Authentication via passkey credential OR SIWE EOA MUST resolve to a canonical Smart Agent address ([ADR-0010](../../docs/architecture/decisions/0010-smart-agent-canonical-identifier.md)). The credential / EOA is a signer principal; the canonical identity is the SA address that has it as a custodian. Session JWTs include the canonical SA address as the primary subject; the credential / EOA is a signer claim only. Multiple SAs sharing a credential disambiguate at sign-in. See [spec 220 § 6](../../specs/220-agent-identity-bootstrap.md).

## Credentials rotate; SAs persist
Per [ADR-0011](../../docs/architecture/decisions/0011-credential-recovery-and-re-association.md), control credentials (passkeys, SIWE EOAs, hardware wallets) are replaceable facets. After credential recovery the new credential authenticates as the SAME canonical SA — same JWT primary subject. This package MUST NOT expose any credential add / replace / remove API: that authority belongs to [`@agenticprimitives/account-custody`](../custody) via `CustodyAction.RecoverAccount`. We only resolve credential → SA; we do not mutate the SA's credential set.

## What this package owns
- Auth method modules: `./passkey`, `./siwe`, `./google` (tree-shakable subpaths).
- JWT session minting/verification with key rotation; CSRF helpers.
- **`Signer` interfaces** (`Signer`, `PasskeySigner`, `EOASigner`, `KMSSigner`) — the architectural contract `agent-account` and `delegation` consume.
- Salt-derivation helpers (label → CREATE2 salt, email → CREATE2 salt).

## What this package does NOT own
- The smart account itself → `@agenticprimitives/agent-account`.
- Concrete KMS-backed signers → `@agenticprimitives/key-custody` (we define the interface; they provide backends).
- HTTP route wiring, cookie I/O, database adapters, OAuth client secrets (consumer-app territory).
- The delegation primitive → `@agenticprimitives/delegation`.

## Vocabulary
**Owns:** `Signer`, `PasskeySigner`, `EOASigner`, `KMSSigner` (interfaces only), `JwtClaims`, `AuthenticatedUser`, `AuthMethod`, `SESSION_COOKIE`. **"Session" here = JWT-cookie session bound to user identity.**
**Disambiguation:** see [`docs/architecture/vocabulary-map.md`](../../docs/architecture/vocabulary-map.md). The word "session" means a **different thing** in `@agenticprimitives/delegation` (a `SessionRow` binding a delegation to a session-signing keypair). If your change touches "session lifecycle" / "session encryption" / "session key", you are working in the wrong package — route to `delegation`.
**Does not use:** `Delegation`, `Caveat`, `Enforcer`, `SessionManager`, `SessionRow`, `A2AKeyProvider`, envelope encryption, JTI, MCP. See `capability.manifest.json:forbiddenTerms`.

## Read these first (in order)
1. `capability.manifest.json` — boundary
2. `src/index.ts` — public API
3. `../../specs/200-identity-auth.md` — the contract
4. `../../docs/architecture/vocabulary-map.md` — only if your change touches a term that lives in two packages

## Stable public exports
**Session:** `mintSession`, `verifySession`, `SESSION_COOKIE`, `SESSION_TTL_SECONDS`
**CSRF:** `csrfTokenFor`, `verifyCsrf`
**Signer interfaces:** `Signer`, `PasskeySigner`, `EOASigner`, `KMSSigner`
**Salt:** `deriveSaltFromLabel`, `deriveSaltFromEmail`
**Subpaths:** `@agenticprimitives/connect-auth/{passkey,siwe,google}`
**Types:** `JwtClaims`, `AuthenticatedUser`, `AuthMethod`

## Allowed imports
`@agenticprimitives/types`, `viem`, `@noble/curves`, `@noble/hashes`.

## Forbidden imports
- `apps/*`
- Any other `@agenticprimitives/*` package (this is a base; others depend on us).

## Drift triggers — STOP and route
- "Add session **encryption**, an envelope, or AAD" — **STOP.** Our session is a signed JWT, not an encrypted payload. Envelope encryption belongs in [`key-custody`](../key-custody). Session lifecycle belongs in [`delegation`](../delegation). See [ADR-0002](../../docs/architecture/decisions/0002-session-lifecycle-in-delegation.md).
- "Add a Delegation, Caveat, or Enforcer builder" — **STOP.** Belongs in [`delegation`](../delegation).
- "Implement a KMS backend or persist signing material" — **STOP.** Belongs in [`key-custody`](../key-custody). Define needs via `KMSSigner` interface here.
- "Read from / write to a database" — **STOP.** Framework-agnostic and stateless. Consumers wire DB.
- "Add MCP tool registration or HMAC envelope" — **STOP.** Belongs in [`mcp-runtime`](../mcp-runtime).

## Before you write code
- [ ] Does the change stay inside auth methods, JWT sessions, CSRF, salt derivation, or `Signer` interfaces?
- [ ] If "session" appears in my change, am I sure I mean **JWT-cookie session** (this package) and not the `delegation` `SessionRow`?
- [ ] Am I producing or consuming `Signer`? (Producing concrete signers = wrong package; that's `key-custody`. Defining the interface = right place.)
- [ ] Did I update `specs/200-identity-auth.md` if the public API changed?
- [ ] Are JWT secrets, OAuth client secrets, and any sensitive material kept out of logs and error messages?

## Security invariants (DO NOT BREAK)
- JWT secrets MUST never be logged. Use redaction in error paths.
- CSRF origin allowlist MUST be exact-match parsed URL, never substring.
- Passkey WebAuthn challenges MUST be one-shot (replay-protected via nonce).
- Salt derivation MUST be deterministic and use keccak (not raw labels).
- Constant-time comparison for HMAC verifications.

## Validate the package
```bash
pnpm --filter @agenticprimitives/connect-auth typecheck
pnpm --filter @agenticprimitives/connect-auth test
pnpm check:forbidden-terms
```

## Common task routing
- Adding a new auth method → `src/methods/<name>.ts`, conform to module shape; export via `package.json:exports`.
- Adding a new `Signer` specialization → `src/signers.ts`; type-only addition.
- Changing JWT claim shape → coordinate with [`delegation`](../delegation) (it reads claims).

## Documentation map
[`README.md`](README.md) · [`docs/concepts.md`](docs/concepts.md) · [`docs/api.md`](docs/api.md) · [`docs/security.md`](docs/security.md) · [`docs/troubleshooting.md`](docs/troubleshooting.md) · [`docs/migration.md`](docs/migration.md)

## Generated files (ignore)
`dist/`, `node_modules/`, `coverage/`, `*.tsbuildinfo`.
