# @agenticprimitives/vault

The **Agentic Delegated Data Vault** seam (spec 277). Every sensitive read/write goes through the
`Vault` interface — never direct database access — so encryption, field projection, entitlement
checks, and one-time key-release (`DecryptGrant`) can be layered in behind it without changing call
sites.

```ts
import { createMemoryVault, type Vault } from '@agenticprimitives/vault';

const vault: Vault = createMemoryVault();
await vault.write({ owner: 'eip155:8453:0xabc…', resource: 'person-pii', data: { email: 'a@b.c' }, classification: 'pii.sensitive' });
const obj = await vault.read({ owner: 'eip155:8453:0xabc…', resource: 'person-pii', fields: ['email'] });
// obj?.data === { email: 'a@b.c' }
```

**Phase 1** (this release): the interface + classification taxonomy + persisted envelope shape + an
in-memory reference adapter. Production storage adapters (D1, R2) implement `Vault` in the consuming
app/runtime (they carry platform types). Encryption, entitlements, and DecryptGrant land in later
phases behind this same interface — see [spec 277](../../specs/277-mcp-delegated-vault-authorization.md).
