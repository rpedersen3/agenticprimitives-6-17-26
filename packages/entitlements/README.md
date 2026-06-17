# @agenticprimitives/entitlements

Durable **resource/action/field/purpose/classification authorization** over VC-compatible
entitlement credentials (spec 277 §10) — the check the vault / MCP runtime runs **before**
decrypting any field.

```ts
import { InMemoryEntitlementResolver } from '@agenticprimitives/entitlements';

const resolver = new InMemoryEntitlementResolver([entitlementCredential]);
const decision = await resolver.resolve({
  actor: 'eip155:8453:0xsession…',
  principal: 'eip155:8453:0xowner…',
  audience: 'urn:mcp:server:person',
  resource: 'person-pii',
  action: 'read',
  fields: ['email'],
  purpose: 'support-ticket',
  classification: 'pii.sensitive',
  at: new Date(),
});
// decision.decision === 'allow' | 'deny'; decision.allowedFields scopes the projection
```

Fail-closed: allowed only if some credential matches on every dimension. This release is the
**matching engine** + in-memory resolver; VC proof verification, status-list revocation, and storage
caches layer on top (see [spec 277 §10](../../specs/277-mcp-delegated-vault-authorization.md)).
