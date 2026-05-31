---
'@agenticprimitives/mcp-runtime': minor
---

R5.8 — `verifyDelegationForResource` production gate (P0-3 closure).

### Breaking

- **`verifyDelegationForResource` signature changed.** Pre-R5.8:
  `(token, config, ctx?: { toolName?, timestamp? })`. Post-R5.8:
  `(token, config, opts?: VerifyDelegationForResourceOpts)`, where
  `VerifyDelegationForResourceOpts` mirrors `withDelegation` opts:
  `{ toolName, timestamp, classification, auditSink, correlationId,
  metricsSink, traceparent, environment, developmentMode, quorumProof }`.

### Why

External senior-architect audit P0-3: the pre-R5.8 helper called
`verifyDelegationToken` with only signature/audience/JTI inputs,
skipping the entire production policy layer that `withDelegation`
enforces — no threshold-policy decision, no policy engine, no
audit trail, no quorum gate. A consumer that used this helper
instead of the wrapper got a silent policy-bypass discount.

### New behaviour

- **Construction-time gate (audit H1):** in production mode,
  missing `classification` or `auditSink` THROWS with the same
  remediation message as `withDelegation`.
- **Threshold-policy gate (audit H3):** when `classification` is
  set, `evaluateThresholdPolicy` derives `requireQuorumCaveat` and
  `requireAcceptedOnChain` and threads them into the verifier.
- **Classification policy gate (audit H2):** post-verify,
  `evaluatePolicy` runs the classification decision; `deny` and
  `requires-consent` (unless satisfied by on-chain blessing) cause
  `{ error: 'auth-failed' }`.
- **Audit emission:** `mcp-runtime.verify-resource.{accept,reject}`
  events written to the supplied sink. Private reason goes to
  audit; public surface stays opaque (H7-F.1).
- **Error contract:** returns `{ principal, grants }` on success or
  `{ error: 'auth-failed' | 'auth-misconfigured' }` on failure.
  Pre-R5.8 returned the raw `verifyDelegationToken` error string.

### Tests

- 9 new R5.8 tests in `test/unit/with-delegation.test.ts`.
- 62/62 mcp-runtime tests pass.

### Migration

Consumers using `verifyDelegationForResource` in production must
add `classification` (from `declareResource(...)`) and `auditSink`
to the opts. Tests can opt out with `developmentMode: true` or
`environment: 'development'`.
