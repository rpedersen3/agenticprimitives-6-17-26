# @agenticprimitives/vault — Claude guide

The **Agentic Delegated Data Vault** seam (spec 277). Owns the `Vault` interface that every
sensitive read/write flows through, so encryption, field projection, entitlements, and
DecryptGrant key-release can be layered in behind it without touching call sites.

## What this package owns
- `Vault` interface — `read` / `write` / `list` (the seam).
- Data-classification taxonomy (`VaultClassification`, `SENSITIVE_CLASSIFICATIONS`).
- `VaultObjectEnvelopeV1` — the persisted object shape (plaintext in Phase 1; `crypto` refs in Phase 2+).
- `createMemoryVault()` — in-memory reference adapter (tests + local dev) + `projectFields`.

## What this package does NOT own (later phases / other layers)
- **Storage adapters** (D1, R2) — they carry platform types (Cloudflare, etc.), so they live in the
  consuming app/runtime, implementing `Vault`. This package stays runtime-agnostic + dependency-free.
- **Envelope encryption / key wrapping** → `key-custody` (Phase 2 populates `crypto`).
- **Entitlement checks** (resource/action/field/purpose) → planned `entitlements` (Phase 3).
- **DecryptGrant / KAS key-release** → planned `key-authorization` (Phase 4).
- **MCP/A2A invocation binding + the `withVaultAuthorization` pipeline** → `mcp-runtime` (Milestone 5).
- **OAuth MCP-compatibility ingress** → planned `mcp-oauth` (Phase 6, P2).

## Phasing (spec 277 §22.1 / §26)
Phase 1 (this): interface + plaintext-preserving adapters. Phase 2: encryption. Phase 3: field
projection + entitlements. Phase 4: DecryptGrant. Phase 5: required audit. Phase 6: OAuth shell.

## Boundary
Generic, vertical-agnostic (ADR-0021) and transport-agnostic — no MCP/A2A/Cloudflare imports, no
faith/vertical vocabulary. Phase 1 has no `@agenticprimitives/*` or runtime deps. `owner`/`resource`
are opaque strings; the adapter maps them to physical storage.

## Validate
```bash
pnpm --filter @agenticprimitives/vault typecheck
pnpm --filter @agenticprimitives/vault test
```
