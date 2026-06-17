# @agenticprimitives/key-authorization — Claude guide

Policy-bound, **one-time key release** (spec 277 §14). The `DecryptGrant` is the enforcement
boundary: the KAS independently re-verifies it before any field is decrypted, so a leaked or
replayed grant can't release keys under a different principal, tool, args, vault, field, purpose,
or classification.

## What this package owns
- `DecryptGrantV1` + `createDecryptGrant` (canonical `grantHash`).
- `verifyDecryptGrant` — fail-closed KAS check: scope (audience/principal/delegate/tool/argsHash/
  resource), field-subset, purpose, classification ceiling, validity window, authorization-hash
  binding, and **one-time JTI** (consumed only after all other checks pass).
- `ReplayStore` + `createInMemoryReplayStore`; `KeyAuthorizationService` + `createLocalDevKeyAuthorizationService`.

## What this package does NOT own
- **Key custody / the DEK unwrap** → `key-custody`. *Custody is not authority* — this package DECIDES
  release; key-custody performs it once `authorize()` returns allow.
- **Grant signature schemes** (Eip712Signature2026 / JWS) → verification is INJECTED (`verifySignature`);
  signing belongs to the issuer (verifiable-credentials / connect-auth).
- **Durable replay ledgers** (D1 / Durable Object) + **remote-KMS KAS** → the consuming app/runtime
  (platform types). The in-memory store is dev/test only.
- **Entitlement matching / delegation verification** → `entitlements` / `delegation`. The grant BINDS
  their hashes; this package checks the binding, it doesn't re-derive them.

## Boundary
Generic, transport-agnostic (ADR-0021), fail-closed (ADR-0013). This release is dependency-free
(WebCrypto SHA-256 only). No MCP/A2A/storage/KMS imports, no vertical vocabulary.

## Validate
```bash
pnpm --filter @agenticprimitives/key-authorization typecheck
pnpm --filter @agenticprimitives/key-authorization test
```
