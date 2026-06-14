---
"@agenticprimitives/a2a": minor
"@agenticprimitives/key-custody": patch
"@agenticprimitives/connect-auth": patch
---

Security hardening wave (harden/audit-2026-06-13).

- **a2a (NEW-A2A-2, high)**: `tasks/get` / `tasks/cancel` / `pushNotificationConfig/set` no longer trust a
  client-supplied `caller`. The caller MUST sign `hashA2aTaskRequest({ method, taskId, agentSA, chainId })`
  and pass `signature`; the agent verifies it via the new `OnChainChecks.verifyCallerSignature` (ERC-1271)
  before the party check — fail-closed on missing/invalid signature or a throwing verifier. **Breaking**:
  the three method params + `A2aWireAdapter.getTask/cancelTask` now take `signature`, and `OnChainChecks`
  gains `verifyCallerSignature`. New export: `hashA2aTaskRequest`.
- **key-custody (N-2, high)**: `aws-kms` backend now FAILS FAST at construction instead of throwing on first
  use (deferred-failure footgun). Only `gcp-kms` is production-ready.
- **connect-auth (N-1, high)**: removed four dead `passkey` exports (`beginSignup`/`completeSignup`/
  `beginLogin`/`completeLogin`) that threw "not implemented" from a published subpath.
