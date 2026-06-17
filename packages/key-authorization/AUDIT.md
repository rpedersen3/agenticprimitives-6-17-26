# @agenticprimitives/key-authorization — audit notes

**Status:** grant + KAS verification (spec 277 §14). No durable replay ledger, no remote-KMS isolation, no signed-proof verification built-in yet.

## Trust model
- The `DecryptGrant` is the enforcement boundary. `verifyDecryptGrant` re-derives the `grantHash`
  over the presented body, then checks scope/fields/purpose/classification/validity/auth-hash
  binding, and finally consumes the one-time JTI. Fail-closed throughout.
- **Authority ≠ custody.** This package decides release; the DEK unwrap is `key-custody`'s job once
  `authorize()` returns allow. A grant that verifies does NOT itself expose key material.
- Grant **signature** verification is INJECTED (`verifySignature`); when omitted (demo/self-issued)
  the grant is trusted on `grantHash` integrity + scope alone — acceptable only for same-process,
  trusted-issuer flows. A remote/cross-trust KAS MUST supply `verifySignature`.

## Security invariants (tested — `test/unit/verify.test.ts`)
- **grantHash integrity** — any mutation of the grant body (tool, fields, principal, …) → `grant_hash_mismatch`.
- **One-time JTI** — a second `authorize` of the same grant → `jti_replay`; the JTI is consumed ONLY
  after all other checks pass (a denied grant is retryable).
- **Scope binding** — audience/principal/delegate/tool/argsHash/resource mismatch → specific deny.
- **Field subset / purpose / classification ceiling / validity window** — each fail-closed.
- **Auth-hash binding** — when the caller pins delegation/entitlement/policy hashes, a mismatch denies.

## Not yet present (additive — do not assume)
- Built-in Eip712/JWS proof verification; durable D1 / Durable-Object replay ledger; remote-KMS KAS
  (high-risk remote decrypt). The in-memory replay store is dev/test only.
