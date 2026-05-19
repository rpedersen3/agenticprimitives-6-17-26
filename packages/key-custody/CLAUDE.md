# @agenticprimitives/key-custody — Claude guide

## What this package owns
- The `A2AKeyProvider` interface (envelope encryption + asymmetric signing + HMAC, all optional methods).
- Built-in providers: `LocalAesProvider` (dev), `AwsKmsProvider`, `GcpKmsProvider`.
- Built-in signers: `LocalSecp256k1Signer` (dev), `AwsKmsSigner`, `GcpKmsSigner`.
- Per-tool executor signers (`buildToolExecutorBackend(toolId, ...)`).
- viem adapter (`createKmsAccount(backend) → KMSSigner`).
- Relay-only signer (`getRelayOnlySigner` for Phase-B master-key safety).
- HMAC providers under `/mac` subpath (same backends, different threat model).

## What this package does NOT own
- **Session lifecycle** — moved to `@agenticprimitives/delegation`. This package exposes envelope primitives (`generateSessionDataKey`, `decryptSessionDataKey`); delegation's `SessionManager` wires them.
- AAD shape decisions (caller provides; this package binds).
- Authority / policy / delegation mechanics.
- Consumer-app env parsing (we read documented env vars; consumers wire them).

## Read these first (in order)
1. `capability.manifest.json` — boundary
2. `src/index.ts` — public API
3. `../../specs/203-key-custody.md` — the contract
4. `src/types.ts` (A2AKeyProvider interface)
5. `src/providers/local.ts` (canonical provider; AWS / GCP follow the same shape)

## Stable public exports
- **Interface:** `A2AKeyProvider`, `KmsAccountBackend`, `BuildOpts`
- **Factories:** `buildKeyProvider`, `buildSignerBackend`, `buildToolExecutorBackend`, `buildMacProvider`, `getRelayOnlySigner`
- **viem adapter:** `createKmsAccount`
- **Built-ins:** `LocalAesProvider`, `LocalSecp256k1Signer`, `AwsKmsProvider`, `AwsKmsSigner`, `GcpKmsProvider`, `GcpKmsSigner`
- **AAD helpers:** `canonicalContextBytes`

## Allowed imports
`@agenticprimitives/types`, `@agenticprimitives/identity-auth` (KMSSigner type), `viem`, `@noble/curves`, `@noble/hashes`, `@aws-sdk/client-kms`, `@google-cloud/kms`.

## Forbidden imports
- `apps/*`
- `agent-account`, `delegation`, `tool-policy`, `mcp-runtime` (these depend on us).

## Security invariants (DO NOT BREAK)
- **No production fallback.** AWS/GCP backends MUST fail-closed on outage. No local fallback path.
- **Production guard.** `local-aes` and any `*_PRIVATE_KEY` env MUST throw at boot when `NODE_ENV=production`.
- **Master-key separation.** Master signer, per-tool executor, and session-data-key wrapping MUST be distinct IAM-scoped KMS keys.
- **Relay-only master.** `getRelayOnlySigner` MUST throw on any `signMessage` / `signUserOp` call.
- **AAD trip-wire.** AES-GCM AAD and KMS EncryptionContext MUST be bound identically; any tampering trips both.
- **Audit trail.** Every `Decrypt` and signing op emits an audit row with `keyVersion`, hashed sessionId, optional toolId/actionId. Raw sessionId MUST NEVER be logged.

## Validate the package
```bash
pnpm --filter @agenticprimitives/key-custody typecheck
pnpm --filter @agenticprimitives/key-custody test
```

## Common task routing
- Adding a new KMS backend → implement `A2AKeyProvider` in `src/providers/<backend>.ts`, register in `buildKeyProvider`, add subpath export.
- Adding a new audit field → `src/audit.ts`; coordinate with `delegation` (it consumes the audit context).
- Touching crypto → must be reviewed by security; AAD invariants in particular.

## Generated files (ignore)
`dist/`, `node_modules/`, `coverage/`, `*.tsbuildinfo`.
