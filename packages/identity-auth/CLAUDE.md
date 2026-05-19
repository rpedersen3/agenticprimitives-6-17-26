# @agenticprimitives/identity-auth — Claude guide

## What this package owns
- Auth method modules: `./passkey`, `./siwe`, `./google` (tree-shakable subpaths).
- JWT session minting/verification with key rotation; CSRF helpers.
- **Signer interfaces** (`Signer`, `PasskeySigner`, `EOASigner`, `KMSSigner`) that `agent-account` and `delegation` consume.
- Salt-derivation helpers (label → CREATE2 salt, email → CREATE2 salt with rotation).

## What this package does NOT own
- The smart account itself → `@agenticprimitives/agent-account`.
- Concrete KMS-backed signers → `@agenticprimitives/key-custody` (provides backends; this package defines the interface).
- HTTP route wiring, cookie I/O, database adapters, OAuth client secrets (consumer-app territory).
- The delegation primitive → `@agenticprimitives/delegation`.

## Read these first (in order)
1. `capability.manifest.json` — boundary
2. `src/index.ts` — public API
3. `../../specs/200-identity-auth.md` — the contract
4. `src/sessions.ts` (when implementing JWT logic)
5. `src/methods/passkey.ts` (canonical implementation pattern for the other methods)

## Stable public exports
- **Session:** `mintSession`, `verifySession`, `SESSION_COOKIE`, `SESSION_TTL_SECONDS`
- **CSRF:** `csrfTokenFor`, `verifyCsrf`
- **Signer interfaces:** `Signer`, `PasskeySigner`, `EOASigner`, `KMSSigner` (types, no implementations)
- **Salt:** `deriveSaltFromLabel`, `deriveSaltFromEmail`
- **Method subpaths:** `@agenticprimitives/identity-auth/{passkey,siwe,google}`
- **Types:** `JwtClaims`, `AuthenticatedUser`, `AuthMethod`

## Allowed imports
`@agenticprimitives/types`, `viem`, `@noble/curves`, `@noble/hashes`.

## Forbidden imports
- `apps/*`
- Any other `@agenticprimitives/*` package (this is a base — others depend on it).

## Security invariants (DO NOT BREAK)
- JWT secrets MUST never be logged. Use redaction in error paths.
- CSRF origin allowlist MUST be exact-match parsed URL, never substring.
- Passkey WebAuthn challenges MUST be one-shot (replay-protected via nonce).
- Salt derivation MUST be deterministic and use keccak (not raw labels).
- Constant-time comparison for HMAC verifications.

## Validate the package
```bash
pnpm --filter @agenticprimitives/identity-auth typecheck
pnpm --filter @agenticprimitives/identity-auth test
```

## Common task routing
- Adding a new auth method → `src/methods/<name>.ts`, conform to existing module shape; export via package.json `exports`.
- Adding a new signer interface specialization → `src/signers.ts`; add type-only.
- Changing JWT claim shape → coordinate with `@agenticprimitives/delegation` (token verification reads claims).

## Generated files (ignore)
`dist/`, `node_modules/`, `coverage/`, `*.tsbuildinfo`.
