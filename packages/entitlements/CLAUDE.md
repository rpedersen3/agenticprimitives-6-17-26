# @agenticprimitives/entitlements — Claude guide

Durable **resource/action/field/purpose/classification authorization** over VC-compatible
entitlement credentials (spec 277 §10). The enforcement layer the vault / MCP runtime calls
**before decrypting fields**: "may this actor, for this audience+purpose, read these fields of
this resource at this classification?"

## What this package owns
- `AgenticEntitlementCredentialV1` — VC-shaped entitlement (issuer/subject/validity/status).
- `matchesEntitlement` / `resolveEntitlements` — pure, fail-closed matching (audience, resource,
  principal, action, fields-subset, purpose, classification ceiling, validity window).
- `EntitlementQuery` / `EntitlementDecision` / `EntitlementResolver` + `InMemoryEntitlementResolver`.

## What this package does NOT own (yet / other layers)
- **VC proof verification** of the credential's `proof` → `verifiable-credentials` (additive sub-wave;
  `verifyEntitlementCredential`/presentations). The matching engine assumes credentials are already trusted.
- **Revocation/suspension** via `credentialStatus` status lists → additive `BitstringStatusResolver`.
- **Storage caches** (`D1EntitlementCache`) → the consuming app/runtime (platform types).
- **Decryption / key-release** → `vault` + planned `key-authorization`.
- **Delegation/caveat semantics** → `delegation`. Entitlements are durable grants, not per-call tokens.

## Boundary
Generic + transport-agnostic (ADR-0021); no MCP/A2A/storage/KMS imports, no vertical vocabulary.
This (matching) release is dependency-free — it reads the credential SUBJECT only.

## Drift triggers — STOP
- "Verify the VC proof / fetch the status list here" — that's the additive VC/status layer; keep the
  matching engine pure + dependency-free.
- "Add a D1/R2 cache here" — storage adapters carry platform types; they live in the app/runtime.

## Validate
```bash
pnpm --filter @agenticprimitives/entitlements typecheck
pnpm --filter @agenticprimitives/entitlements test
```
