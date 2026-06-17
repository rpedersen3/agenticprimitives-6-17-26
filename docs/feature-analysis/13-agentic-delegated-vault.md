# 13 - Agentic delegated vaults: PII, entitlements, delegations, and key-gated MCP storage

**Focus area:** encrypted data vaults, privacy vaults, field-level encryption, tokenization, KMS/transit systems, key release, and entitlement-gated sensitive tool data.
**AP packages in scope:** planned `vault`, planned `key-authorization`, planned `entitlements`, `key-custody`, `mcp-runtime`, `delegation`, `tool-policy`, `audit`; apps `demo-mcp`, `demo-a2a`; sibling `verifiable-content-demo`.
**Target architecture:** a delegation-gated, entitlement-aware, key-release-controlled vault for PII, private delegations, entitlements, OAuth grant context, agent memory, and MCP/A2A sensitive tool data.

OAuth is only an MCP compatibility adapter for public HTTP ingress. It is not the vault authority model.

> Gap layers: `[Contracts]` Solidity surface - `[SDK]` TS packages/backends - `[UX]` product surface (**deferred**). See [index](index.md#gap-layers-every-gap-is-classified-into-exactly-one).

---

## Category verdict at a glance

| Product / standard | Type | Tags | Verdict |
| --- | --- | --- | --- |
| Open Privacy Vault / OPV | OSS privacy vault | VAULT POLICY | **Closest OSS implementation reference** - PII-as-a-service, no plaintext storage, pluggable crypto, field-level redaction/access |
| Piiano Vault | Commercial privacy vault | VAULT POLICY AUDIT | **Best feature checklist** - field encryption, key rotation, encrypted search, audit, masking/tokenization |
| Skyflow | Commercial privacy vault | VAULT POLICY AUDIT | **Best commercial benchmark** - mature privacy vault vocabulary, tokenization, de-identification, governance |
| DataBunker | OSS/self-hosted PII vault | VAULT POLICY | **Closest self-hosted PII vault product shape** - tokenized personal records, encrypted storage, hash indexes |
| Acra | OSS/commercial DB security suite | VAULT CUSTODY POLICY | **Best field-encryption hardening reference** - app/db field encryption, searchable encrypted data, compartmented decrypt |
| Encrypted Data Vaults / EDV | Open architecture | VAULT CUSTODY POLICY | **Best standards anchor** - encrypted object storage, encrypted indexes, provider opacity |
| Evervault | Commercial encryption/key separation | VAULT CUSTODY | **Best custody/separation pattern** - dual custody, policy-bound decrypt, app-owned ciphertext |
| Thorn / Subrose | OSS privacy vault | VAULT POLICY AUDIT | Track - conceptually aligned but pre-alpha |
| Baffle | Commercial data protection | VAULT CUSTODY | Benchmark - field/record encryption, tokenization, masking |
| HashiCorp Vault Transit / OpenBao Transit | OSS/commercial crypto service | CUSTODY VAULT | **Integrate** as crypto backend, not AP data store |
| AWS/GCP/Azure KMS | Cloud KMS/HSM | CUSTODY AUDIT | **Integrate** for KEK/DEK protection and key evidence |
| Arcade / Composio / agentgateway / TrueFoundry | MCP/agent gateway | MCP POLICY AUDIT | Adjacent comparator - gateway/runtime/credential-vault patterns, not AP vault substitutes |
| UCAN / ZCAP-LD / Biscuit / Macaroons | Capability/delegation systems | DELEG POLICY | Adjacent comparator - attenuation/caveat semantics, not encrypted vault storage |
| Microsoft Presidio | OSS PII detection/redaction | VAULT POLICY | Adjacent utility - PII detection/masking, not secure storage |

---

## Target architecture

```
Agent / A2A / MCP caller
   |
   | signed delegation + entitlement
   v
MCP/A2A policy runtime
   |
   | exact tool/action/resource/field/purpose check
   v
Vault authorization layer
   |
   | one-time key-release grant
   v
Encrypted vault storage
   |
   | D1/Postgres metadata + R2/S3 ciphertext
   v
field-projected result + PII-free audit
```

Public MCP compatibility is a wrapper around that path:

```
Generic public MCP client
   |
   | OAuth token for MCP compatibility
   v
MCP ingress adapter
   |
   | resolves Agentic Grant Bundle
   v
normal delegated vault path
```

The thesis:

> Agentic Primitives is building an agent-controlled encrypted data vault where PII, delegations, entitlements, secrets, and private agent memory are released only through signed delegation, entitlement, exact invocation policy, one-time key grants, and audit. OAuth is merely an optional compatibility adapter for public MCP clients.

## Standards and open architecture

| Standard / pattern | What it gives AP | What AP should take | Missing for AP |
| --- | --- | --- | --- |
| EDV | Provider-opaque encrypted document storage, encrypted indexing, portability | Vault object envelope, encrypted tags/indexes, storage-provider opacity | MCP/A2A delegation, entitlement checks, key-release policy |
| Solid Pods | User-controlled data storage and interoperability | Long-term personal data portability adapter | Field-level cryptographic MCP enforcement |
| W3C VC / status lists | Signed entitlements, holder/issuer/verifier model, revocation/suspension | Entitlement credentials and status checks | Vault storage and decrypt-grant flow |
| Field-level encryption | Database remains blind to sensitive fields | Object and field-level encryption, field projection | Rotation, search, audit, exact invocation policy |

EDV is the best storage standard to learn from because it focuses on storing, indexing, and retrieving encrypted data without the storage provider seeing or analyzing plaintext.

## Closest Matches - Ranked

| Rank | Project/product | Why it is close | Main gap versus AP |
| --- | --- | --- | --- |
| 1 | Open Privacy Vault / OPV | Open-source PII-as-a-service, no plaintext storage, pluggable encryption, field-level access/redaction/validation | No agentic delegation or MCP/A2A-native entitlement model |
| 2 | Piiano Vault | Strongest feature benchmark: field-level encryption, key rotation, encrypted search, audit, granular controls, masking/tokenization | Not agentic/MCP-native; server distribution appears release/SDK-oriented rather than fully open-source server |
| 3 | Skyflow | Mature commercial privacy vault with tokenization, polymorphic encryption, redaction, governance, PII workflows | Commercial product; not standards-first/AP-native |
| 4 | DataBunker | Self-hosted PII/PHI/KYC vault with tokenization, encrypted storage, hash indexes, no plaintext storage | Traditional PII vault; weaker fit for delegation/entitlement/key-release semantics |
| 5 | Acra | Application/database-level field encryption, searchable encrypted data patterns, secure compartmented decryption | More DB security suite than vault product |
| 6 | EDV ecosystem | Best standards-aligned storage architecture: encrypted storage, encrypted indexing, provider opacity, portability | Spec/storage layer, not a complete PII/product vault |
| 7 | Evervault | Close on dual custody: app stores encrypted data while vendor manages keys; data policies are conceptually relevant | Key/data-flow platform, not AP-owned vault with local entitlement enforcement |
| 8 | Thorn / Subrose | Open-source privacy vault with encryption, tokenization, access control, audit logs | Pre-alpha; conceptual reference, not mature foundation |
| 9 | HashiCorp Vault / OpenBao Transit + Transform | Useful crypto/tokenization backend for the vault | Not the vault authority model; belongs underneath AP vault |
| 10 | Arcade / Composio / agentgateway / TrueFoundry | MCP runtime/gateway/credential-vaulting patterns | Agent/MCP gateways, not delegated encrypted PII vaults |

The closest composite architecture is:

```
Open Privacy Vault / Piiano-style PII vault
  + EDV-style encrypted storage envelopes
  + Acra-style field-level encryption discipline
  + Evervault-style dual custody / policy-bound decrypt
  + HashiCorp/OpenBao/AWS-KMS-style crypto backend
  + UCAN/ZCAP/Biscuit-style delegation/caveat semantics
  + MCP gateway-style runtime enforcement and audit
```

The missing piece across that landscape is AP's differentiator: delegated vault access for MCP/A2A tools controlled by signed delegation, entitlement credentials, exact invocation binding, field/purpose/classification policy, key-custody-backed release, and PII-free audit evidence.

## Direct Privacy Vault Comparators

| Product | Relevant features | What AP should copy | What AP should do differently |
| --- | --- | --- | --- |
| Open Privacy Vault / OPV | OSS PII-as-a-service, no plaintext storage, pluggable encryption engines including Vault-style backends, fine-grained field-level access/redaction/validation, database adapters | PII-as-a-service API shape; field policy/redaction; pluggable encryption engine interface; bring-your-own-database adapter model; token strategy; structural PII validation | Add delegation-bound access, entitlement credentials, MCP/A2A invocation binding, exact args hash, key-release grants, PII-free audit evidence, Cloudflare D1/R2 adapters |
| DataBunker | Self-hosted PII/PHI/KYC vault, tokenization, encrypted storage, hash-based indexes, no plaintext storage, restricted bulk retrieval | Self-hosted PII vault positioning; tokenized references for apps; hash-based lookup indexes; bulk retrieval restrictions; secure personal-record API model | Add field/purpose/classification entitlement checks, delegation-controlled decrypt, per-tool MCP runtime integration, key-custody-backed envelope encryption, DecryptGrant release |
| Acra | Application/database-level field encryption, searchable encrypted data, secure decryption compartments, database leakage prevention, intrusion detection | Field-level encryption architecture; secure decrypt compartment; database-leakage threat model; search over encrypted data patterns; multi-layer access-control mindset | Add vault object/resource model, agentic delegation and entitlement proof, MCP/A2A tool-call binding, PII vault APIs rather than only DB protection |
| Thorn / Subrose | OSS privacy vault with encryption, tokenization, configurable access control, audit logs, secret rotation, custom encryption providers | Developer-facing privacy vault framing; every-action audit logs; configurable encryption providers; cloud/on-prem/serverless ambition | Do not depend on it as mature base; avoid broad compliance claims before AP implementation hardens |
| Skyflow | Mature commercial data privacy vault, tokenization, polymorphic encryption, redaction, safe data use/sharing/analytics, governance/compliance positioning | Privacy vault product vocabulary; tokenization + encryption + redaction bundle; data residency/governance UX; structured PII workflows; analytics-safe privacy model | Make authority cryptographic and agent-native; support MCP/A2A invocation binding; keep vault standards-first and portable; integrate with AP delegation/key-custody |
| Piiano Vault | Field-level encryption, key rotation, encrypted search, full audit logs, granular access controls, masking, tokenization, own-cloud deployment | Field-level encryption, key rotation, encrypted search, full access audit, masking/tokenization, own-cloud deployment model, granular access controls | Use as feature benchmark; AP authority must be signed delegation + entitlement + exact invocation |
| Evervault | Dual custody: app stores encrypted data while key authority is separate; policy-bound decrypt and runtime data policies | Dual custody; policy-bound decrypt; encrypted values stored in normal infra; proxy/relay decrypt patterns; runtime data policies | Use AP key-custody, bind decrypt to delegation + entitlement, support object/field records, D1/R2 storage, MCP/A2A invocation context |
| Baffle | Field/record encryption, tokenization, FPE, masking, proxy/database protection | Enterprise deployment patterns | Not agentic or delegation-native |

## EDV Implementations and Clients

EDV is the standards lineage, not the complete AP product. Relevant implementations include EDV clients and servers such as Digital Bazaar-style EDV clients and TrustBloc-style EDV servers.

What to borrow:

- encrypted object envelope ideas
- encrypted indexing model
- storage-provider opacity
- vault controller / storage agent separation
- portable storage API

What AP adds:

- PII-oriented field model
- delegation-gated reads/writes
- entitlement-bound projection
- MCP/A2A runtime context
- KMS/key-custody integration
- audit and key-release evidence

## KMS, transit crypto, and key custody

`@agenticprimitives/key-custody` is the vault's cryptographic substrate, not the vault product.

| Backend | Relevant features | Use in AP vault | AP still owns |
| --- | --- | --- | --- |
| HashiCorp Vault Transit | Encrypt/decrypt/sign/HMAC as a crypto service; does not store app data | Transit crypto backend | DecryptGrant, entitlement binding, MCP/A2A invocation binding |
| OpenBao Transit | OSS Vault-compatible transit crypto | OSS-friendly crypto backend | Same AP authority layer |
| AWS KMS | Envelope encryption, data keys, managed KEKs | Cloud KEK/DEK backend | Field-level policy and audit-bound release |
| GCP KMS / Azure Key Vault | Cloud KMS wrapping/unwrapping/signing | Enterprise adapters | AP vault resource model and key-release policy |
| Cloudflare secrets / R2 encryption | Runtime/storage defense-in-depth | Deployment infrastructure | Must not become root vault authority |

KMS/HSM protects keys. The AP vault protects data. Delegations and entitlements decide release.

## Adjacent MCP and Agent Gateways

These are not vault substitutes, but they benchmark the runtime and gateway layer.

| Project/product | Relevant features | What AP should copy | Why it does not replace AP vault |
| --- | --- | --- | --- |
| Arcade | MCP runtime/governance, authorization, tool catalog, audit, credential vaulting, just-in-time tokens | MCP gateway UX, credential isolation, tool-level authorization, audit expectations | Center of gravity is gateway/tool governance, not encrypted PII vault storage with AP delegation/entitlement proofs |
| Composio | MCP gateway, credential vaulting, tool-level RBAC, observability, keeping API keys/OAuth tokens away from agents | Connected-account ergonomics, token-vault patterns, tool catalog conventions | Stores/mediates credentials for tools; does not define AP vault object envelopes or DecryptGrant release |
| agentgateway | Open-source MCP/A2A proxy with security, observability, OAuth/JWT/API-key auth, RBAC, policy | Proxy architecture, policy checkpoints, runtime observability | Gateway, not vault authority or encrypted PII storage |
| TrueFoundry MCP Gateway | Centralized MCP server access, OAuth, guardrails, credential management, audit trail | Enterprise MCP gateway posture, guardrails, curation | Runtime gateway, not agentic delegated vault |

Use these for MCP gateway UX, credential-vaulting, observability, runtime policy checkpoints, and avoiding credentials in model context.

## Adjacent Delegation and Policy Systems

These compare to AP delegation/caveat semantics, not to vault storage.

| System | Relevant idea | AP use |
| --- | --- | --- |
| UCAN | DID-based creation, delegation, and invocation of authority by agents | Delegation/capability semantics and offline proof ideas |
| ZCAP-LD | Signed capability chains with caveats; parent caveats constrain descendants | Caveat attenuation model |
| Biscuit | Offline attenuation and decentralized verification with logic-language policy | Policy proof and attenuation ideas |
| Macaroons | Caveated authorization credentials for decentralized delegation | Request-bound caveat patterns |
| OpenFGA / SpiceDB | Relationship-based authorization graph | Off-chain relationship/directory permission adapter, not vault key release |
| Cedar | Formal policy language and validation | Future tool-policy language inspiration |

Microsoft Presidio is also useful as a PII detection/redaction utility, not as secure vault storage.

## Field-level encryption and search

Object-level encryption is not enough for AP's PII and private agent data. The vault should support:

- object-level encryption
- field-level encryption
- field projection
- masking
- tokenization
- encrypted exact-match tags
- deterministic blind indexes where appropriate
- key rotation
- crypto-shredding

Recommended field domains:

| Data | Encryption shape |
| --- | --- |
| `email` | separate encrypted field or field group |
| `phone` | separate encrypted field or field group |
| `address` | separate encrypted field or field group |
| `ssn` / tax identifiers | separate high-risk field key |
| OAuth refresh tokens / external API tokens | `secret.high` field key |
| private delegations | `delegation.private` key domain |
| entitlement private payloads | `entitlement.private` key domain |

## Competitive Feature Matrix

| Capability | OPV | DataBunker | Acra | EDV | Skyflow | Piiano | Evervault | Transit/KMS | MCP gateways | Proposed AP Vault |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Provider-opaque encrypted storage | Yes | Yes | Yes | Yes | Yes | Yes | Partial | Backend only | No | Yes |
| Field-level PII controls | Yes | Partial | Yes | Partial | Yes | Yes | Policy-specific | No | No | Yes |
| Tokenization | Yes | Yes | No | No | Yes | Yes | Token/proxy patterns | Transform only | Credential tokens | Yes |
| Masking/redaction | Yes | Partial | Partial | No | Yes | Yes | Policy-specific | Transform only | Response guards | Yes |
| Encrypted indexes/tags | Some | Hash indexes | Searchable patterns | Yes | Product-specific | Yes | No | No | No | Yes |
| Key rotation | Backend-dependent | Yes | Yes | Backend-dependent | Yes | Yes | Yes | Yes | No | Yes |
| Crypto-shredding | Backend-dependent | Key deletion/rotation | Possible | Possible | Product-specific | Product-specific | Key policy/deletion | Key disable/delete | No | Yes |
| Delegation-aware access | No | No | No | No | No | No | No | No | No | Yes |
| MCP tool-call binding | No | No | No | No | No | No | No | No | Yes | Yes |
| A2A delegation binding | No | No | No | No | No | No | No | No | Some gateway support | Yes |
| Entitlement credential checks | No | No | No | No | Product-specific | Product-specific | Policy-specific | No | Policy-specific | Yes |
| One-time key-release grant | No | No | No | No | Product-specific | No | Closest conceptually | No | JIT token analog | Yes |
| Fail-hard PII audit | Some | Some | Some | No | Product-specific | Yes | Product-specific | Backend audit | Yes | Yes |
| Cloudflare D1/R2 adapter | DB adapter likely portable | Self-hosted | DB/proxy oriented | Could be built | No | No | No | No | No | Yes |
| Standards-first portability | OSS | OSS/self-hosted | OSS/commercial | Yes | Commercial API | Product-specific | Commercial API | Backend standard-ish | Product-specific | Yes |

## AP vault object model

```ts
export type VaultObjectEnvelopeV1 = {
  type: "VaultObjectEnvelopeV1";
  id: `urn:ap:vault-object:${string}`;
  vaultId: `urn:ap:vault:${string}`;
  ownerPrincipal: string;
  resource: string;
  schema: string;
  classification:
    | "public"
    | "internal"
    | "pii.low"
    | "pii.sensitive"
    | "secret.high"
    | "delegation.private"
    | "entitlement.private"
    | "agent.memory.private"
    | "regulated.high";
  aad: {
    objectId: string;
    vaultId: string;
    ownerPrincipal: string;
    resource: string;
    schema: string;
    classification: string;
    policyProfile: "agentic-delegated-vault-v1";
    createdAt: string;
  };
  crypto: {
    alg: "A256GCM";
    ciphertextRef: string;
    wrappedDekRef: string;
    dekKid: string;
    keyVersion: string;
    aadHash: `sha256:${string}`;
    commitment: `sha256:${string}`;
  };
  fields?: Record<string, {
    classification: string;
    ciphertextRef?: string;
    wrappedDekRef?: string;
    encryptedTagRefs?: string[];
    commitment: `sha256:${string}`;
  }>;
  index?: {
    encryptedTags: Array<{ name: string; tag: string; version: string }>;
  };
  createdAt: string;
  updatedAt: string;
};
```

## Vault authorization context

Every vault read/write requires a verified authority context:

```ts
export type VaultAuthorizationContext = {
  principal: string;
  delegate?: string;
  invocation: {
    protocol: "mcp" | "a2a" | "internal";
    serverId?: string;
    toolName?: string;
    argsHash?: `sha256:${string}`;
    taskId?: string;
    messageId?: string;
  };
  delegation: {
    hash: `sha256:${string}`;
    verified: true;
    caveats: string[];
    expiresAt: string;
  };
  entitlement: {
    hashes: `sha256:${string}`[];
    resource: string;
    actions: string[];
    fields?: string[];
    purpose?: string;
    classificationCeiling?: string;
  };
  policy: {
    profile: "agentic-delegated-vault-v1";
    policyHash: `sha256:${string}`;
    riskTier: "low" | "medium" | "high" | "critical";
    exactCallRequired: boolean;
    keyReleaseRequired: boolean;
    auditRequired: boolean;
  };
  replay: {
    jti: string;
    consumed: true;
  };
};
```

No vault API should accept only `user_id`, `role`, `oauth_scope`, or `database_session` for sensitive release.

## DecryptGrant is the enforcement boundary

```ts
export type DecryptGrantV1 = {
  type: "DecryptGrantV1";
  id: `urn:ap:decrypt-grant:${string}`;
  principal: string;
  delegate?: string;
  vault: {
    vaultId: string;
    resource: string;
    objectIds: string[];
    fields?: string[];
    purpose?: string;
    classificationCeiling?: string;
  };
  invocation: {
    protocol: "mcp" | "a2a" | "internal";
    toolName?: string;
    argsHash?: `sha256:${string}`;
    audience: string;
  };
  evidence: {
    delegationHash: `sha256:${string}`;
    entitlementHashes: `sha256:${string}`[];
    policyHash: `sha256:${string}`;
    auditPrecommitHash?: `sha256:${string}`;
  };
  constraints: {
    oneTimeUse: true;
    notBefore: string;
    expiresAt: string;
    noPersist?: boolean;
    noTraining?: boolean;
    redactByDefault?: boolean;
  };
  replay: { jti: string };
  proof: { type: "EIP712" | "JWS"; signature: string };
};
```

The KAS rejects on wrong principal, delegate, vault, resource, field, purpose, classification, tool, args hash, policy hash, expiry, replayed JTI, missing audit precommit, revoked entitlement, or revoked delegation.

## Package recommendations

### P1 - `@agenticprimitives/vault`

Main package. Owns `VaultObjectEnvelopeV1`, field envelopes, storage adapters, encrypted tags, field projection, masking/tokenization interfaces, crypto-shredding, D1/R2 and Postgres/S3 adapters, migration helpers, and plaintext scanners.

### P1 - `@agenticprimitives/key-authorization`

Owns `DecryptGrantV1`, key-release decision objects, KAS interface, one-time grant replay store, Vault/OpenBao Transit adapter, AWS/GCP/Azure KMS adapters, local-dev KAS, and required-audit integration.

### P1 - `@agenticprimitives/entitlements`

Owns entitlement credentials and resource/action/field/purpose/classification matching, VC-compatible proof verification, revocation/status checks, D1/Postgres entitlement cache, and policy evidence objects.

### P1 - `@agenticprimitives/mcp-runtime` vault integration

Adds `withVaultAuthorization`, `withDelegatedVaultTool`, `VaultAuthorizationContext`, tool args hash binding, field projection enforcement, purpose enforcement, and audit enforcement.

### P2 - `@agenticprimitives/mcp-oauth`

MCP compatibility adapter only: protected-resource metadata, token verifier interface, OAuth token -> Agentic Grant Bundle resolver, `WWW-Authenticate` helpers, insufficient-scope helpers, Cloudflare OAuth adapter.

## Current app migration plan

1. Put vault interfaces around existing D1 PII and `vault_records` before OAuth work. Goal: all PII access goes through `ctx.vault.read/write`.
2. Encrypt PII and private authority artifacts. D1 holds metadata/tags/DEK refs; R2 holds ciphertext.
3. Add field-level projection. Tools request fields explicitly; vault physically decrypts only those fields.
4. Add entitlement checks for resource/action/fields/purpose.
5. Add `DecryptGrant` and KAS. Replace direct decrypt with grant-verified field projection.
6. Add required audit. PII reads/writes and key release fail closed if audit cannot commit.
7. Add public MCP OAuth compatibility after the vault path is solid.

## Focus-area gap rollup - by layer

### `[Contracts]` gaps - active

*None required for v0.* Delegation/caveat enforcer improvements may later add on-chain field/purpose enforcers, but the vault starts as off-chain package/runtime work.

### `[SDK]` / package gaps - active

| Gap | Evidence | Roadmap ID | Priority |
| --- | --- | --- | --- |
| EDV-style encrypted vault with object/field envelopes, encrypted tags, masking/tokenization, and adapters | EDV, Skyflow, Open Privacy Vault, Piiano-style vaults | FG-VAULT-1 | **P1** |
| `DecryptGrantV1` and key-release authorization service | KMS/Vault Transit separation; Evervault dual-custody pattern | FG-KAUTH-1 | **P1** |
| Entitlement credential/check API for resource/action/field/purpose/classification | W3C VC/status lists, Stigg/Keygen patterns | FG-ENT-5 | **P1** |
| MCP runtime vault authorization wrapper with exact args hash, field projection, purpose, fail-hard audit | MCP/A2A sensitive tools | FG-MCP-VLT-1 | **P1** |
| Required audit for vault read/write and key release | Privacy vault audit benchmarks | FG-AUD-5 | **P1** |
| MCP OAuth compatibility adapter for public HTTP clients | MCP authorization spec | FG-MCP-OAUTH-1 | P2 |

### `[UX]` gaps - deferred

| Gap | Evidence |
| --- | --- |
| Vault consent explorer showing resource/action/field/purpose/duration/risk | Skyflow/Piiano admin experiences, OAuth consent norms |
| Data subject portal for viewing grants, tokens, and vault access history | Privacy vault product patterns |

**Substrate advantages to preserve:** key-custody stays narrow ("custody is not authority"); vault owns data release; delegation and entitlements decide access; KMS/HSM protects keys only; audit stays PII-free and fail-hard for sensitive release.
