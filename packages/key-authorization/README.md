# @agenticprimitives/key-authorization

Policy-bound **one-time key release** (spec 277 §14). A `DecryptGrant` binds *who / which tool /
which args / which vault fields / which purpose / which classification* by hash; the KAS
independently re-verifies it before any field is decrypted.

```ts
import { createDecryptGrant, createLocalDevKeyAuthorizationService } from '@agenticprimitives/key-authorization';

const grant = await createDecryptGrant({
  id: 'urn:ap:decrypt-grant:abc', issuer, audience, principal,
  mcp: { resourceUri, serverId, toolName: 'get_pii', argsHash },
  authorization: { delegationHash, entitlementHashes, policyHash },
  vault: { vaultId, objectIds, resource: 'person-pii', fields: ['email'], purpose: 'support', classificationCeiling: 'pii.sensitive' },
  constraints: { ttlSeconds: 120, notBefore, expiresAt, oneTimeUse: true },
  replay: { jti },
});

const kas = createLocalDevKeyAuthorizationService();
const decision = await kas.authorize(grant, { audience, principal, toolName: 'get_pii', argsHash, resource: 'person-pii', requestedFields: ['email'], classification: 'pii.sensitive' });
// decision.decision === 'allow' | 'deny'; releasedFields scope the decrypt. JTI is one-time.
```

Fail-closed; the one-time JTI is consumed only after every other check passes (a denied grant never
burns its JTI). The DEK unwrap itself is `key-custody`'s job once `authorize()` returns allow —
*custody is not authority*. Signed proofs, durable replay ledgers, and remote-KMS KAS are additive
(see [spec 277 §14](../../specs/277-mcp-delegated-vault-authorization.md)).
