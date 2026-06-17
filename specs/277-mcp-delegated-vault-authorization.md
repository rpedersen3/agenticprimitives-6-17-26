# Spec 277 - Agentic Delegated Data Vault (AP-MCP-DVA v0.1)

**Status:** Proposed implementation spec (2026-06-16).
**Owns:** The architecture and implementation plan for a delegation-gated encrypted data vault with entitlements, deterministic policy, one-time key-release grants, field-projected plaintext release, and PII-free audit. MCP OAuth is an optional public HTTP ingress adapter, not the vault authority model.
**Target repos/apps:** `agenticprimitives`, `apps/demo-mcp`, `apps/demo-a2a`, sibling `verifiable-content-demo`.
**Companion specs:** [202](./202-delegation.md), [203](./203-key-custody.md), [204](./204-tool-policy.md), [205](./205-mcp-runtime.md), [206](./206-audit.md), [242](./242-trust-credentials-and-public-assertions.md), [247](./247-per-agent-mcp-vault.md), [265](./265-federated-user-data-access.md), [266](./266-verifiable-content-substrate.md), [276](./276-kms-consumer-surface.md).
**Architecture-of-record:** ADR-0010 (SA address is identity), ADR-0013 (no silent fallback), ADR-0021 (generic packages vs apps), ADR-0037 (Ring 0 primitives, external integration/UX elsewhere).

Core decision: **The delegated encrypted vault is the product architecture. Use OAuth only for MCP compatibility at the public HTTP boundary.**

KMS/HSM protects keys. The AP vault protects data. Delegations and entitlements decide release.

---

## 1. Goals

1. **Delegated encrypted vault.** PII, private entitlements, private delegations, session grants, grant bundles, agent memory, and vault records are encrypted vault objects. D1/R2/SQL/S3 hold ciphertext, metadata, encrypted tags, and references.
2. **Delegation-native authorization.** Fine-grained authority comes from delegation chains, entitlements, tool policy, replay protection, key release, and audit.
3. **Field-projected key release.** Sensitive reads decrypt only approved fields for an approved purpose, bound to exact invocation evidence.
4. **Remote MCP compatibility.** Public HTTP MCP servers expose OAuth protected-resource metadata, accept bearer tokens, validate audience/resource binding, return insufficient-scope challenges, and never pass inbound MCP tokens downstream.
5. **A2A compatibility.** A2A remains the agent-facing orchestration boundary. Public A2A-to-MCP calls obtain MCP OAuth tokens server-side; private service-bound MCP calls may skip OAuth but must still run the delegated vault runtime.
6. **Portable implementation.** Cloudflare Workers, Durable Objects, D1, and R2 are adapters, not the trust model. Core packages work with other HTTP runtimes, stores, blob systems, and KMS/HSM providers.

## 2. Non-goals

Do not implement:

```
OAuth scope vault:read -> read/decrypt all vault PII
```

Do implement:

```
OAuth token valid for this MCP resource
  -> resolve Agentic Grant Bundle
  -> verify delegation
  -> verify entitlement
  -> evaluate tool policy
  -> issue short-lived decrypt grant
  -> decrypt only allowed fields
```

OAuth `authorization_details` (RFC 9396 Rich Authorization Requests) may request or bootstrap access, but the canonical authority is the Agentic Grant Bundle plus entitlement proof.

## 3. Standards Profile

### 3.1 MCP OAuth Compatibility

For any public HTTP MCP server:

| Requirement | Behavior |
|---|---|
| Protected resource metadata | Expose OAuth protected-resource metadata. |
| Authorization server discovery | Client discovers AS from protected-resource metadata. |
| Resource indicator | Client requests a token for the canonical MCP resource URI. |
| Bearer token usage | Client sends `Authorization: Bearer <token>` on each HTTP MCP request. |
| Audience validation | MCP server accepts only tokens issued for that MCP resource. |
| Runtime insufficient scope | MCP server returns `403` with `WWW-Authenticate` insufficient-scope challenge. |
| No token passthrough | MCP server must not pass the inbound MCP token to downstream APIs, KMS, or external services. |

### 3.2 A2A Compatibility

A2A remains the external agent protocol where appropriate. Missing entitlements or required consent map to A2A's in-task authorization pattern (`TASK_STATE_AUTH_REQUIRED`) rather than leaking internal policy detail.

### 3.3 Encrypted Vault Storage

The storage model follows EDV-style principles: encrypted data objects, encrypted indexes/tags, storage-provider opacity, and portable storage adapters.

### 3.4 Entitlements

Durable entitlements use W3C VC-compatible credentials or typed signed attestations. Status/revocation should support VC status patterns such as Bitstring Status List when privacy matters.

## 4. Architecture

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
   | Short-lived decrypt grant
   v
Encrypted Vault Storage
   |
   | D1/R2/Postgres/S3/etc. contain ciphertext, metadata, encrypted tags
   v
Minimized MCP result + PII-free audit
```

OAuth is a public-MCP ingress adapter around that path:

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

### 4.1 Four-layer Authority

Every protected MCP tool invocation evaluates:

1. **Delegation:** Is this agent/session/tool allowed to act for the principal?
2. **Entitlement:** Is this actor allowed to perform this action on this resource/field/purpose?
3. **Tool policy:** Does the exact invocation satisfy risk-tier, field projection, purpose, replay, and audit rules?
4. **Key release:** Should the vault/KMS release decrypt capability for this exact operation?
5. **OAuth compatibility, public HTTP only:** Is this request allowed to reach this MCP HTTP resource?

### 4.2 Runtime Modes

```ts
export type McpAuthorizationMode =
  | "public-http-oauth"
  | "private-a2a-delegated"
  | "stdio-dev";
```

| Mode | Use | Requirements |
|---|---|---|
| `public-http-oauth` | HTTP MCP endpoints reachable by third-party MCP clients | Must expose metadata, validate bearer token issuer/expiry/audience/resource, reject wrong audience, avoid token passthrough, resolve Agentic Grant Bundle before sensitive tools. |
| `private-a2a-delegated` | A2A is public boundary; MCP is private, service-bound, or in-process | May skip OAuth on the internal hop; must still verify delegation, entitlement, replay, tool policy, key release, and audit. |
| `stdio-dev` | Local development | Must not be enabled in production; must use dev credentials; should still support delegation/runtime tests. |

## 5. Canonical Decision Object

Every sensitive MCP call produces a deterministic decision:

```ts
export type McpAuthorizationDecisionV1 = {
  decision: "allow" | "deny";
  reason:
    | "oauth_invalid"
    | "oauth_wrong_audience"
    | "grant_bundle_missing"
    | "delegation_invalid"
    | "delegation_revoked"
    | "delegation_expired"
    | "jti_replay"
    | "entitlement_missing"
    | "entitlement_revoked"
    | "entitlement_expired"
    | "tool_policy_denied"
    | "key_release_denied"
    | "audit_required_failed"
    | "allow";
  principal: string;
  delegate?: string;
  clientId?: string;
  mcp: {
    resourceUri: string;
    serverId: string;
    toolName: string;
    argsHash: string;
  };
  authorization: {
    oauthTokenHash?: string;
    grantBundleId?: string;
    grantBundleHash?: string;
    delegationHash?: string;
    entitlementHashes: string[];
    policyHash: string;
  };
  access: {
    resource: string;
    actions: string[];
    fields?: string[];
    purpose?: string;
    classificationCeiling?: string;
    ttlSeconds: number;
  };
  constraints: {
    noPersist?: boolean;
    noTraining?: boolean;
    redactByDefault?: boolean;
    exactCallRequired?: boolean;
  };
  audit: {
    mode: "fail-soft" | "fail-hard";
    eventType: string;
  };
};
```

For PII, private entitlement data, private delegation data, key operations, exports, and break-glass operations, `audit.mode` is `fail-hard`.

## 6. OAuth Compatibility Profile

### 6.1 Protected Resource Metadata

Package helper:

```ts
export function createProtectedResourceMetadata(input: {
  resource: string;
  authorizationServers: string[];
  scopesSupported: string[];
  bearerMethodsSupported?: ["header"];
  resourceDocumentation?: string;
}): OAuthProtectedResourceMetadata;
```

Public HTTP MCP servers implement:

```
GET /.well-known/oauth-protected-resource
GET /.well-known/oauth-protected-resource/mcp
```

Challenges include the protected-resource metadata URI when useful.

### 6.2 Recommended Scopes

Scopes are coarse compatibility hints:

```
mcp:invoke
mcp:tools:list
mcp:resources:list
vault:read
vault:write
vault:pii:read
vault:pii:write
vault:export
vault:admin
entitlement:read
entitlement:write
delegation:read
delegation:write
```

Do not encode field-level authority purely in scopes.

### 6.3 Rich Authorization Request Shape

Clients that support authorization details may request:

```json
{
  "type": "agentic_mcp_tool",
  "locations": ["https://mcp.example.com/mcp"],
  "mcp_server": "urn:mcp:pii-vault",
  "tool": "vault.read_pii",
  "resources": ["urn:ap:vault:user:123/profile"],
  "actions": ["read"],
  "fields": ["email", "phone"],
  "purpose": "customer_support",
  "constraints": {
    "noPersist": true,
    "noTraining": true,
    "redactByDefault": true
  }
}
```

The access token carries a reference/hash to the resulting Agentic Grant Bundle, not the private entitlement/delegation payload.

## 7. Agentic Grant Bundle

The Agentic Grant Bundle bridges MCP-compatible OAuth and Agentic Primitives authorization.

```ts
export type McpGrantBundleV1 = {
  type: "McpGrantBundleV1";
  id: `urn:ap:mcp-grant:${string}`;
  hash: `sha256:${string}`;
  oauth: {
    issuer: string;
    clientId: string;
    subject: string;
    audience: string;
    scopes: string[];
    authorizationDetailsHash?: `sha256:${string}`;
  };
  principal: { id: string; account?: string };
  delegate?: { id: string; account?: string };
  mcp: {
    resourceUri: string;
    serverId: string;
    allowedTools?: string[];
  };
  delegation: {
    delegationHash: `sha256:${string}`;
    delegationTokenRef?: string;
    chainId?: number;
    expiresAt: string;
    caveatsHash: `sha256:${string}`;
    revocation: {
      mode: "onchain" | "registry" | "status-list" | "none";
      ref?: string;
    };
  };
  entitlements: Array<{
    entitlementHash: `sha256:${string}`;
    credentialRef?: string;
    issuer: string;
    subject: string;
    resource: string;
    actions: string[];
    fields?: string[];
    purpose?: string;
    classificationCeiling?: string;
    validUntil?: string;
    statusRef?: string;
  }>;
  constraints: {
    noPersist?: boolean;
    noTraining?: boolean;
    redactByDefault?: boolean;
    exactCallRequired?: boolean;
    maxTtlSeconds: number;
  };
  replay: {
    jtiSeed: string;
    nonceScope: "oauth-token" | "tool-call" | "decrypt-grant";
  };
  policy: {
    profile: "mcp-delegated-vault-v1";
    policyHash: `sha256:${string}`;
    toolPolicyVersion: string;
  };
  issuedAt: string;
  expiresAt: string;
  status: "active" | "revoked" | "expired";
};
```

Grant bundles are encrypted vault objects, not plaintext rows.

Index row:

```ts
export type McpGrantBundleIndexRow = {
  id: string;
  ownerPrincipal: string;
  clientId: string;
  mcpResourceUri: string;
  bundleHash: string;
  ciphertextRef: string;
  status: "active" | "revoked" | "expired";
  expiresAt: string;
  createdAt: string;
};
```

Blob path:

```
grant-bundles/{env}/{bundleId}/{version}.cbor
```

## 8. OAuth Token Profile

Access tokens are short-lived and audience-bound:

```json
{
  "iss": "https://auth.example.com",
  "sub": "did:pkh:eip155:8453:0xPrincipalSmartAgent",
  "aud": "https://mcp.example.com/mcp",
  "client_id": "client_123",
  "jti": "tok_01J...",
  "iat": 1780000000,
  "exp": 1780000300,
  "scope": "mcp:invoke vault:pii:read",
  "resource": "https://mcp.example.com/mcp",
  "ap_principal": "did:pkh:eip155:8453:0xPrincipal",
  "ap_delegate": "did:pkh:eip155:8453:0xDelegate",
  "ap_grant_ref": "urn:ap:mcp-grant:01J...",
  "ap_grant_hash": "sha256:...",
  "ap_policy_profile": "mcp-delegated-vault-v1"
}
```

MCP server validation:

- issuer and signature
- expiry and not-before if present
- audience/resource
- client binding where configured
- JTI/replay policy where configured
- grant reference and grant hash

Inbound MCP tokens must not be reused downstream. If a downstream OAuth credential is needed, use a separate downstream token or RFC 8693-style token exchange.

## 9. Delegation Model

`@agenticprimitives/delegation` remains canonical. Add MCP/vault caveat builders:

```ts
export function mcpAudienceCaveat(resourceUri: string): Caveat;
export function mcpServerCaveat(serverId: string): Caveat;
export function mcpToolCaveat(toolName: string): Caveat;
export function mcpArgsHashCaveat(argsHash: string): Caveat;
export function resourceCaveat(resourceUrn: string): Caveat;
export function fieldProjectionCaveat(fields: string[]): Caveat;
export function purposeCaveat(purpose: string): Caveat;
export function oauthGrantBindingCaveat(grantBundleHash: string): Caveat;
export function maxTtlCaveat(seconds: number): Caveat;
```

Sensitive tools require audience, server, tool, args hash, resource, field projection, purpose, expiry, JTI, and grant-bundle-hash binding.

## 10. Entitlements Package

Create `packages/entitlements` as `@agenticprimitives/entitlements`.

Purpose: durable resource/action/field/purpose authorization over VC-compatible credentials.

```ts
export type AgenticEntitlementCredentialV1 = {
  "@context": string[];
  type: ["VerifiableCredential", "AgenticEntitlementCredentialV1"];
  id: `urn:ap:entitlement:${string}`;
  issuer: string;
  validFrom: string;
  validUntil?: string;
  credentialSubject: {
    id: string;
    principal?: string;
    audience: string;
    resource: string;
    actions: Array<
      | "read"
      | "write"
      | "list"
      | "delete"
      | "share"
      | "export"
      | "key.rotate"
      | "break-glass"
    >;
    fields?: string[];
    purpose?: string;
    classificationCeiling?:
      | "public"
      | "internal"
      | "pii.low"
      | "pii.sensitive"
      | "secret.high"
      | "regulated.high";
    constraints?: {
      noPersist?: boolean;
      noTraining?: boolean;
      redactByDefault?: boolean;
      requiresFreshConsent?: boolean;
      requiresStepUp?: boolean;
      requiresQuorum?: boolean;
    };
  };
  credentialStatus?: {
    id: string;
    type: "BitstringStatusListEntry" | string;
    statusPurpose: "revocation" | "suspension" | string;
  };
  proof: unknown;
};
```

Resolver API:

```ts
export type EntitlementQuery = {
  actor: string;
  principal?: string;
  audience: string;
  resource: string;
  action: string;
  fields?: string[];
  purpose?: string;
  at: Date;
};

export type EntitlementDecision = {
  decision: "allow" | "deny";
  reason:
    | "matched"
    | "not_found"
    | "expired"
    | "revoked"
    | "suspended"
    | "field_not_allowed"
    | "purpose_not_allowed"
    | "classification_exceeded"
    | "audience_mismatch"
    | "resource_mismatch";
  matchedCredentials: string[];
  allowedFields?: string[];
  constraints?: Record<string, unknown>;
};

export interface EntitlementResolver {
  resolve(query: EntitlementQuery): Promise<EntitlementDecision>;
}
```

Exports: `issueEntitlementCredential`, `verifyEntitlementCredential`, `createEntitlementPresentation`, `verifyEntitlementPresentation`, `resolveEntitlements`, `matchesEntitlement`, `InMemoryEntitlementResolver`, `D1EntitlementCache`, `BitstringStatusResolver`.

## 11. Tool Policy Updates

`@agenticprimitives/tool-policy` remains protocol-agnostic. It may define MCP/vault vocabulary strings, but must not import MCP, A2A, OAuth, storage, or KMS libraries.

```ts
export type AgenticToolAuthMode =
  | "none"
  | "delegation"
  | "oauth+delegation"
  | "oauth+delegation+entitlement"
  | "oauth+delegation+entitlement+key-release";

export type AgenticToolAnnotations = {
  "@sa-tool": string;
  "@sa-risk-tier": "low" | "medium" | "high" | "critical";
  "@sa-auth": AgenticToolAuthMode;
  "@sa-resource-kind"?:
    | "profile"
    | "pii"
    | "delegation"
    | "entitlement"
    | "vault"
    | "key"
    | "audit";
  "@sa-actions"?: string[];
  "@sa-fields"?: string[];
  "@sa-purpose-required"?: boolean;
  "@sa-exact-call-required"?: boolean;
  "@sa-key-release-required"?: boolean;
  "@sa-audit-mode"?: "fail-soft" | "fail-hard";
};
```

Policy profiles:

- `mcp-basic-v1`
- `mcp-delegated-v1`
- `mcp-delegated-entitlement-v1`
- `mcp-delegated-vault-v1`
- `mcp-critical-admin-v1`

Unknown classification fails closed.

## 12. Key-Custody Relationship

`@agenticprimitives/key-custody` is the vault's cryptographic substrate, not the vault solution itself.

It owns:

- KMS/HSM-backed key custody
- data-key generation and wrapping
- wrapped data-key decrypt/unwrap
- signing
- HMAC/MAC primitives
- AAD binding
- production no-local-fallback guardrails

The vault owns:

- encrypted vault records
- object/field envelopes
- storage adapters
- field projection
- masking/tokenization
- encrypted tags and indexes
- vault resource model
- no-plaintext guarantees
- authorization context and plaintext release

Dependency direction:

```
vault -> key-custody
vault -> delegation
vault -> entitlements
vault -> tool-policy
vault -> audit
```

Never:

```
key-custody -> vault
key-custody -> delegation
key-custody -> entitlements
key-custody -> mcp-runtime
key-custody -> tool-policy
```

Focused `key-custody` updates for vault support:

```ts
export interface A2AKeyProvider {
  generateDataKey?(input: {
    aadContext: Record<string, unknown>;
    keyPurpose?: "session" | "vault-object" | "vault-field" | "grant";
  }): Promise<{
    plaintextDataKey: Uint8Array;
    encryptedDataKey: Uint8Array;
    keyId: string;
    keyVersion: string;
  }>;

  decryptDataKey?(input: {
    encryptedDataKey: Uint8Array;
    aadContext: Record<string, unknown>;
    keyId: string;
    keyVersion: string;
  }): Promise<Uint8Array>;
}
```

Keep existing `generateSessionDataKey` / `decryptSessionDataKey` for compatibility and alias them to the generalized data-key methods where possible.

Vault-specific AAD helper:

```ts
export function vaultAadContext(input: {
  vaultId: string;
  objectId: string;
  ownerPrincipal: string;
  resource: string;
  field?: string;
  classification: string;
  schema: string;
  policyProfile: "agentic-delegated-vault-v1";
}): Record<string, unknown>;
```

The helper must only canonicalize caller-supplied vault metadata. It must not evaluate delegation, entitlement, policy, storage, or routing.

Envelope encrypt/decrypt audit becomes required for vault use. It must emit hashes/refs only: `keyId`, `keyVersion`, `vaultId`, `objectHash`, `fieldHash`, `resourceHash`, `classification`, `policyHash`, `delegationHash`, `entitlementHash`. No raw PII, field values, OAuth tokens, or private grants.

## 13. Vault Package

Create `packages/vault` as `@agenticprimitives/vault`.

Purpose: EDV-style encrypted vault objects, portable storage adapters, encrypted tags, and field-projected read/write APIs.

### 13.1 Vault Product Requirements

The vault package should borrow the strongest privacy-vault product patterns, especially from Open Privacy Vault / OPV, DataBunker, Piiano-style vaults, Acra, EDV, and Evervault. These become explicit package requirements, not app-only conventions.

What to borrow:

- **PII-as-a-service API shape.** Apps should call a narrow vault API for create/read/write/mask/tokenize/validate, not query PII tables directly.
- **Field-level policy and redaction.** Field projection, masking, redaction, tokenization, and validation are first-class operations.
- **Pluggable encryption engine interface.** The vault can use `key-custody`, Vault/OpenBao Transit, cloud KMS, local-dev crypto, or future HSM adapters behind one interface.
- **Bring-your-own-database adapter model.** D1/R2 are first Cloudflare adapters; Postgres/S3 and other stores must be possible without changing authority semantics.
- **Token strategy.** Apps can receive stable tokens/aliases for sensitive values while plaintext remains releasable only through vault authorization.
- **Structural PII validation.** The vault validates schema/field shape before write and can reject malformed PII or classify fields before encryption.

AP additions that competitor vaults do not provide together:

- **Delegation-bound access.** Reads/writes require a verified `VaultAuthorizationContext`, not just role, API key, database session, or OAuth scope.
- **Entitlement credentials.** Resource/action/field/purpose/classification access is checked against entitlement credentials or signed attestations.
- **MCP/A2A invocation binding.** Access binds to `protocol`, `serverId`, `toolName`, `taskId`/`messageId`, and audience where available.
- **Exact tool args hash.** Sensitive tools bind release to the canonical hash of the exact arguments approved by policy.
- **Key-release grants.** Decrypt requires a short-lived, one-time, field-scoped `DecryptGrantV1`.
- **PII-free audit evidence.** Audit records use hashes/refs and fail hard for sensitive read/write/key-release operations.
- **Cloudflare D1/R2 adapters.** D1 stores metadata/index rows; R2 stores encrypted blobs. Neither stores plaintext PII.

### 13.2 PII-as-a-Service API

```ts
export interface AgenticVault {
  put<T>(input: {
    authorization: VaultAuthorizationContext;
    resource: string;
    schema: string;
    classification: VaultClassification;
    value: T;
    fieldPolicy?: VaultFieldPolicy;
  }): Promise<VaultObjectEnvelopeV1>;

  read<T>(input: {
    authorization: VaultAuthorizationContext;
    resource: string;
    fields?: string[];
    purpose?: string;
  }): Promise<T>;

  write<T>(input: {
    authorization: VaultAuthorizationContext;
    resource: string;
    patch: Partial<T>;
    purpose?: string;
  }): Promise<void>;

  mask(input: {
    authorization: VaultAuthorizationContext;
    resource: string;
    fields?: string[];
    maskProfile: string;
  }): Promise<Record<string, unknown>>;

  tokenize(input: {
    authorization: VaultAuthorizationContext;
    resource: string;
    fields: string[];
    tokenProfile: string;
  }): Promise<Record<string, string>>;

  validate(input: {
    schema: string;
    classification: VaultClassification;
    value: unknown;
    fieldPolicy?: VaultFieldPolicy;
  }): Promise<VaultValidationResult>;

  rotateKeys(input: {
    authorization: VaultAuthorizationContext;
    resource?: string;
    classification?: VaultClassification;
  }): Promise<void>;

  cryptoShred(input: {
    authorization: VaultAuthorizationContext;
    resource: string;
  }): Promise<void>;
}
```

### 13.3 Field Policy, Validation, and Tokens

```ts
export type VaultClassification =
  | "public"
  | "internal"
  | "pii.low"
  | "pii.sensitive"
  | "secret.high"
  | "delegation.private"
  | "entitlement.private"
  | "agent.memory.private"
  | "regulated.high";

export type VaultFieldPolicy = Record<string, {
  classification: VaultClassification;
  required?: boolean;
  redaction?: "none" | "mask" | "last4" | "email-domain" | "token-only";
  tokenProfile?: string;
  encryptedTag?: boolean;
  fieldDek?: boolean;
  validators?: Array<"email" | "phone" | "postal-address" | "url" | "non-empty" | string>;
}>;

export type VaultValidationResult =
  | { ok: true; normalized?: unknown; detectedFields?: Record<string, VaultClassification> }
  | { ok: false; issues: Array<{ path: string; code: string; message: string }> };

export type VaultTokenRef = {
  type: "VaultTokenRef";
  token: `vlt_${string}`;
  vaultId: string;
  resource: string;
  field?: string;
  tokenProfile: string;
  tokenHash: `sha256:${string}`;
  expiresAt?: string;
};
```

Tokens are references, not authority. A token may identify or stand in for a sensitive value, but resolving it still requires normal vault authorization and, for sensitive fields, key release.

### 13.4 Pluggable Crypto and Storage Adapters

```ts
export interface VaultEncryptionEngine {
  encryptField(input: EncryptVaultFieldInput): Promise<EncryptedVaultField>;
  decryptField(input: DecryptVaultFieldInput): Promise<unknown>;
  encryptObject(input: EncryptObjectInput): Promise<EncryptedVaultObject>;
  decryptProjection(input: DecryptProjectionInput): Promise<Record<string, unknown>>;
  rotateObjectKey(input: RotateObjectKeyInput): Promise<VaultObjectEnvelopeV1>;
  cryptoShred(input: CryptoShredInput): Promise<void>;
}

export interface VaultMetadataStore {
  putEnvelope(envelope: VaultObjectEnvelopeV1): Promise<void>;
  getEnvelope(objectId: string): Promise<VaultObjectEnvelopeV1 | null>;
  findByResource(input: { ownerPrincipal: string; resource: string }): Promise<VaultObjectEnvelopeV1[]>;
  queryByEncryptedTag(query: EncryptedTagQuery): Promise<VaultObjectEnvelopeV1[]>;
}

export interface VaultBlobStore {
  getCiphertext(ref: string): Promise<ArrayBuffer>;
  putCiphertext(ref: string, body: ArrayBuffer): Promise<void>;
  deleteCiphertext(ref: string): Promise<void>;
}
```

Cloudflare adapters implement these interfaces with D1 metadata, R2 ciphertext blobs, and optional Durable Object write coordination. Postgres/S3 adapters should be equivalent peers, not separate semantics.

### 13.5 Envelope

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
  index?: {
    encryptedTags: Array<{
      name: string;
      tag: string;
      version: string;
    }>;
  };
  createdAt: string;
  updatedAt: string;
};
```

### 13.6 Low-Level Storage and Crypto APIs

```ts
export interface VaultStorage {
  putObject(input: PutVaultObjectInput): Promise<VaultObjectEnvelopeV1>;
  getEnvelope(objectId: string): Promise<VaultObjectEnvelopeV1 | null>;
  getCiphertext(ref: string): Promise<ArrayBuffer>;
  putCiphertext(ref: string, body: ArrayBuffer): Promise<void>;
  queryByEncryptedTag(query: EncryptedTagQuery): Promise<VaultObjectEnvelopeV1[]>;
}

export interface VaultCryptoProvider {
  encryptObject(input: EncryptObjectInput): Promise<EncryptedVaultObject>;
  decryptProjection(input: DecryptProjectionInput): Promise<Record<string, unknown>>;
  rotateObjectKey(input: RotateObjectKeyInput): Promise<VaultObjectEnvelopeV1>;
  cryptoShred(input: CryptoShredInput): Promise<void>;
}
```

Exports: `putVaultObject`, `getVaultObjectEnvelope`, `readVaultProjection`, `writeVaultProjection`, `maskVaultProjection`, `tokenizeVaultFields`, `validateVaultObject`, `queryEncryptedTags`, `rotateVaultObjectKey`, `cryptoShredVaultObject`.

Cloudflare subpath exports:

```ts
createD1VaultMetadataStore()
createR2VaultBlobStore()
createDurableObjectVaultCoordinator()
createCloudflareVault()
```

### 13.7 Encryption Requirements

- Must use authenticated encryption.
- Must bind AAD to object ID, vault ID, owner, resource, schema, classification, and policy profile.
- Should use per-object DEKs.
- Should use per-field DEKs for highly sensitive PII.
- Must wrap DEKs with KMS/HSM-backed KEKs in production.
- Must support crypto-shredding by disabling/deleting wrapped DEKs or KEK versions.
- Must not store plaintext PII in D1/R2/logs/audit/traces/prompts.
- Must not allow `vault.read` to call data-key decrypt before delegation, entitlement, tool-policy, replay, and audit precommit checks succeed.
- Must support redaction/masking without releasing unapproved plaintext fields.
- Must support tokenization where the token itself is not sufficient authority to resolve plaintext.

## 14. Key Authorization Package

Create `packages/key-authorization` as `@agenticprimitives/key-authorization`.

Purpose: policy-bound key release. This package consumes `key-custody` primitives, but authority remains delegation/entitlement/policy.

### 13.1 Decrypt Grant

```ts
export type DecryptGrantV1 = {
  type: "DecryptGrantV1";
  id: `urn:ap:decrypt-grant:${string}`;
  grantHash: `sha256:${string}`;
  issuer: string;
  audience: string;
  principal: string;
  delegate?: string;
  mcp: {
    resourceUri: string;
    serverId: string;
    toolName: string;
    argsHash: string;
  };
  authorization: {
    oauthTokenHash?: string;
    grantBundleHash: `sha256:${string}`;
    delegationHash: `sha256:${string}`;
    entitlementHashes: `sha256:${string}`[];
    policyHash: `sha256:${string}`;
  };
  vault: {
    vaultId: string;
    objectIds: string[];
    resource: string;
    fields?: string[];
    purpose?: string;
    classificationCeiling?: string;
  };
  constraints: {
    ttlSeconds: number;
    notBefore: string;
    expiresAt: string;
    oneTimeUse: true;
    noPersist?: boolean;
    noTraining?: boolean;
  };
  replay: { jti: string };
  proof: {
    type: "Eip712Signature2026" | "JWS" | string;
    signature: string;
  };
};
```

### 13.2 KAS Behavior

The Key Authorization Service independently verifies:

- grant signature, issuer, audience, expiry
- JTI one-time use
- grant bundle hash
- delegation hash
- entitlement hashes
- policy hash
- vault object IDs
- allowed fields, purpose, classification ceiling
- required audit pre-commit

High-risk data should prefer remote decrypt: MCP sends ciphertext + grant to KAS, KAS decrypts only approved fields, and returns a minimized plaintext projection. Medium-risk flows may unwrap a DEK into MCP memory only after policy succeeds.

Exports: `createDecryptGrant`, `verifyDecryptGrant`, `KeyAuthorizationService`, `LocalDevKeyAuthorizationService`, `RemoteKmsKeyAuthorizationService`, `CloudflareKeyAuthorizationClient`, `D1KeyGrantLedger`, `DurableObjectGrantReplayStore`.

## 15. MCP OAuth Package

Create `packages/mcp-oauth` as `@agenticprimitives/mcp-oauth`.

Purpose: MCP OAuth compatibility layer and grant-bundle bridge.

Exports:

```ts
createProtectedResourceMetadata()
serveProtectedResourceMetadata()
createWwwAuthenticateChallenge()
validateMcpBearerToken()
requireMcpAudience()
buildInsufficientScopeResponse()
parseAuthorizationDetails()
buildAuthorizationDetailsRequest()
createMcpGrantBundle()
bindOAuthTokenToGrantBundle()
resolveGrantBundleFromToken()
```

Cloudflare subpath:

```ts
createCloudflareMcpOAuthProvider()
createCloudflareGrantBundleStore()
```

No package should pass an inbound MCP access token to downstream services.

## 16. Audit Updates

`@agenticprimitives/audit` adds required audit mode:

```ts
export type AuditWriteMode = "best-effort" | "required";

export interface RequiredAuditSink {
  appendRequired(event: AuditEvent): Promise<{
    eventId: string;
    eventHash: string;
    committedAt: string;
  }>;
}
```

Required event actions:

```
oauth.token.validated
oauth.token.rejected
mcp.grant_bundle.resolved
delegation.verified
delegation.rejected
entitlement.verified
entitlement.rejected
tool_policy.allow
tool_policy.deny
vault.object.read.requested
key_release.requested
key_release.approved
key_release.denied
vault.object.decrypted
vault.object.written
vault.object.crypto_shredded
```

Audit events must not include raw PII, OAuth tokens, refresh tokens, private delegations, private entitlement payloads, prompts containing PII, or decrypted vault payloads.

## 17. MCP Runtime Pipeline

`@agenticprimitives/mcp-runtime` adds:

```ts
export function withMcpDelegatedAuthorization<TArgs, TResult>(
  config: McpDelegatedAuthorizationConfig,
  handler: McpDelegatedToolHandler<TArgs, TResult>
): McpToolHandler<TArgs, TResult>;
```

Config:

```ts
export type McpDelegatedAuthorizationConfig = {
  mode: "public-http-oauth" | "private-a2a-delegated" | "stdio-dev";
  mcp: { serverId: string; resourceUri: string };
  oauth?: {
    verifier: McpOAuthTokenVerifier;
    requiredScopes?: string[];
    protectedResourceMetadataUri: string;
  };
  grants: {
    store: McpGrantBundleStore;
    resolver: McpGrantBundleResolver;
  };
  delegation: {
    verifier: DelegationVerifier;
    replayStore: JtiReplayStore;
  };
  entitlements: { resolver: EntitlementResolver };
  policy: { evaluator: ToolPolicyEvaluator };
  vault?: { storage: VaultStorage; crypto: VaultCryptoProvider };
  keyAuthorization?: { broker: KeyAuthorizationService };
  audit: {
    sink: AuditSink | RequiredAuditSink;
    defaultMode: "best-effort" | "required";
  };
};
```

Runtime order:

1. Parse MCP tool call.
2. Compute canonical args hash.
3. In public HTTP mode, validate OAuth token and audience/resource.
4. Resolve Agentic Grant Bundle from token claims or server session.
5. Verify grant bundle hash and status.
6. Verify delegation chain.
7. Check revocation.
8. Check JTI replay.
9. Resolve entitlements.
10. Evaluate tool policy.
11. If key release is required, create `DecryptGrantV1` and ask KAS for allowed projection.
12. Execute handler with minimized authorized context.
13. Redact response by default where required.
14. Commit PII-free audit event.
15. Return MCP result.

Context:

```ts
export type McpDelegatedToolContext = {
  principal: string;
  delegate?: string;
  oauth?: {
    clientId: string;
    tokenHash: string;
    scopes: string[];
    audience: string;
  };
  grantBundle: McpGrantBundleV1;
  authorization: McpAuthorizationDecisionV1;
  vault: {
    read<T>(input: {
      resource: string;
      fields?: string[];
      purpose?: string;
    }): Promise<T>;
    write<T>(input: {
      resource: string;
      value: T;
      fields?: string[];
      purpose?: string;
    }): Promise<void>;
  };
  audit: {
    append(event: Partial<AuditEvent>): Promise<void>;
  };
};
```

Example:

```ts
server.registerTool(
  "vault.read_pii",
  {
    title: "Read PII",
    annotations: {
      "@sa-tool": "vault.read_pii",
      "@sa-risk-tier": "high",
      "@sa-auth": "oauth+delegation+entitlement+key-release",
      "@sa-resource-kind": "pii",
      "@sa-actions": ["read"],
      "@sa-purpose-required": true,
      "@sa-exact-call-required": true,
      "@sa-key-release-required": true,
      "@sa-audit-mode": "fail-hard"
    },
    inputSchema: {
      resource: "string",
      fields: "string[]",
      purpose: "string"
    }
  },
  withMcpDelegatedAuthorization(config, async (args, ctx) => {
    return ctx.vault.read({
      resource: args.resource,
      fields: args.fields,
      purpose: args.purpose
    });
  })
);
```

## 18. A2A Package Updates

`@agenticprimitives/a2a` adds MCP bridge helpers:

```ts
createMcpOAuthBridge()
createMcpDelegatedBridgeSkill()
mapMcpAuthErrorToA2aTaskState()
```

A2A bridge rules:

- Obtain MCP access tokens server-side.
- Never expose MCP OAuth tokens to browsers or prompts.
- Bind MCP token to the same grant bundle hash when A2A already has valid Agentic authorization.
- Map missing entitlement / consent to `TASK_STATE_AUTH_REQUIRED`.

## 19. Database and Storage Schema

Core SQL tables:

```sql
CREATE TABLE oauth_clients (
  client_id TEXT PRIMARY KEY,
  client_metadata_json TEXT NOT NULL,
  jwks_uri TEXT,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE oauth_authorization_sessions (
  id TEXT PRIMARY KEY,
  user_principal TEXT NOT NULL,
  client_id TEXT NOT NULL,
  resource_uri TEXT NOT NULL,
  requested_scopes TEXT NOT NULL,
  authorization_details_hash TEXT,
  pkce_challenge_hash TEXT,
  csrf_hash TEXT,
  status TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE oauth_access_token_index (
  jti_hash TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL,
  grant_bundle_id TEXT NOT NULL,
  subject TEXT NOT NULL,
  client_id TEXT NOT NULL,
  audience TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE mcp_grant_bundles (
  id TEXT PRIMARY KEY,
  owner_principal TEXT NOT NULL,
  client_id TEXT NOT NULL,
  mcp_resource_uri TEXT NOT NULL,
  bundle_hash TEXT NOT NULL,
  ciphertext_ref TEXT NOT NULL,
  status TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE vault_objects (
  object_id TEXT PRIMARY KEY,
  vault_id TEXT NOT NULL,
  owner_principal TEXT NOT NULL,
  resource_urn TEXT NOT NULL,
  classification TEXT NOT NULL,
  schema_uri TEXT NOT NULL,
  ciphertext_ref TEXT NOT NULL,
  wrapped_dek_ref TEXT NOT NULL,
  aad_hash TEXT NOT NULL,
  commitment TEXT NOT NULL,
  key_version TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE vault_index_tags (
  vault_id TEXT NOT NULL,
  tag_name TEXT NOT NULL,
  tag_hmac TEXT NOT NULL,
  object_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (vault_id, tag_name, tag_hmac, object_id)
);

CREATE TABLE entitlement_cache (
  entitlement_hash TEXT PRIMARY KEY,
  subject TEXT NOT NULL,
  issuer TEXT NOT NULL,
  status TEXT NOT NULL,
  valid_from TEXT,
  valid_until TEXT,
  status_ref TEXT,
  cached_until TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE jti_replay (
  jti_hash TEXT PRIMARY KEY,
  first_seen_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE key_grant_ledger (
  grant_id TEXT PRIMARY KEY,
  grant_hash TEXT NOT NULL,
  principal TEXT NOT NULL,
  resource_hash TEXT NOT NULL,
  fields_hash TEXT,
  policy_hash TEXT NOT NULL,
  status TEXT NOT NULL,
  issued_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE audit_events (
  event_id TEXT PRIMARY KEY,
  event_hash TEXT NOT NULL,
  prev_hash TEXT,
  event_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
```

Blob paths:

```
vault/{env}/{vaultId}/{objectId}/{version}.cbor
grant-bundles/{env}/{bundleId}/{version}.cbor
entitlements/{env}/{entitlementHash}.cbor
audit/{env}/{yyyy}/{mm}/{dd}/{eventId}.json
```

Durable Objects are recommended for OAuth authorization sessions, PKCE/CSRF state, per-principal replay state, per-vault write serialization, A2A task/session state, and short-lived grant locks.

## 20. Request Flows

### 19.1 Generic MCP Client

1. Client calls `/mcp` without token.
2. MCP returns `401` with `WWW-Authenticate`.
3. Client fetches protected resource metadata.
4. Client discovers authorization server.
5. Client starts OAuth authorization code + PKCE with `resource=<mcp-uri>`, scopes, and optional authorization details.
6. User authenticates and consents.
7. Authorization server creates encrypted Agentic Grant Bundle.
8. Authorization server issues short-lived audience-bound access token with `ap_grant_ref` and `ap_grant_hash`.
9. Client calls MCP with bearer token.
10. MCP validates OAuth and resolves grant bundle.
11. MCP verifies delegation, entitlement, policy, replay, key release.
12. Tool returns minimized result.

### 19.2 A2A to Public MCP

1. External agent calls A2A endpoint.
2. A2A validates Agentic delegation and entitlement intent.
3. A2A obtains MCP OAuth token server-side for the MCP resource.
4. A2A calls MCP with bearer token.
5. MCP performs the same validation as the generic client flow.
6. A2A returns task/message result.

### 19.3 Private A2A to MCP

1. A2A validates request.
2. A2A invokes MCP runtime in-process or through service binding.
3. No OAuth token is required on the private hop.
4. MCP runtime still validates delegation, entitlement, replay, policy, key release, and audit.

### 19.4 Vault Read

1. MCP receives `vault.read_pii`.
2. Runtime computes args hash.
3. Runtime validates OAuth token in public HTTP mode.
4. Runtime resolves grant bundle.
5. Runtime verifies delegation, caveats, revocation, expiry, JTI, entitlement, and policy.
6. Runtime fetches vault envelopes only.
7. Runtime creates `DecryptGrantV1`.
8. KAS verifies grant independently.
9. KAS writes required audit/ledger event.
10. KAS decrypts only approved fields.
11. MCP returns minimized projection.
12. Runtime writes PII-free audit event.

## 21. Error Behavior

### 20.1 Public HTTP MCP

| Condition | Response |
|---|---|
| Missing OAuth token | `401` with `WWW-Authenticate` and protected resource metadata. |
| Invalid/expired token | `401`. |
| Wrong audience/resource | `401`. |
| Insufficient OAuth scope | `403` with `insufficient_scope` challenge. |
| Grant bundle missing/revoked | `403`. |
| Delegation invalid/revoked | `403`. |
| Entitlement missing | `403`; optional consent/step-up flow. |
| JTI replay | `403` or `409`. |
| KMS unavailable | `503`, fail closed for PII/key release. |
| Required audit unavailable | `503`, fail closed for PII/key release. |

### 20.2 A2A

Map missing entitlement or required consent to `TASK_STATE_AUTH_REQUIRED`. Do not expose raw internal policy details in task messages.

## 22. App Transition Plan

### 22.1 `apps/demo-mcp`

Phase 1 - Vault interfaces around existing data:

- Wrap current D1 PII rows and `vault_records` behind `@agenticprimitives/vault` interfaces.
- Preserve current app behavior while forcing all PII access through `ctx.vault.read/write`.
- Keep `AP_MCP_AUTH_MODE=private-a2a-delegated` as the default while vault storage hardens.

Phase 2 - Encrypt D1 PII and private authority artifacts:

- Replace plaintext PII rows and `vault_records` with vault object metadata and encrypted blobs.
- D1 holds metadata, refs, encrypted tags, entitlement cache, JTI replay, and audit index.
- R2 holds encrypted vault blobs, grant bundles, private delegations, and private entitlement payloads.

Phase 3 - Field projection and entitlements:

- Sensitive tools request explicit `resource`, `fields`, and `purpose`.
- Verify entitlements before decrypting any field.
- Physically decrypt only approved fields.

Phase 4 - Key release:

- Sensitive tools request `DecryptGrantV1`.
- Direct vault decrypt in handlers is forbidden for PII.

Phase 5 - Required audit:

- PII read/write/key-release operations fail closed if required audit cannot commit.

Phase 6 - OAuth compatibility shell:

- Add `/.well-known/oauth-protected-resource`, `/.well-known/oauth-protected-resource/mcp`, `/authorize`, `/token`, optional `/register`, and `/mcp`.
- Use `@agenticprimitives/mcp-oauth`.
- Remove delegation material from public user-visible MCP tool schemas.
- Public authority moves to bearer token -> grant ref/hash -> encrypted bundle -> normal delegated vault authorization.

### 22.2 `apps/demo-a2a`

Phase 1 - MCP OAuth bridge:

- Add `createMcpOAuthBridge({ mcpResourceUri, authorizationServer, grantBundleStore, tokenCache })`.
- Obtain MCP access tokens server-side.
- Do not expose MCP OAuth tokens to browser or prompt.

Phase 2 - Map entitlement failures:

- Convert entitlement-required or insufficient-scope into `TASK_STATE_AUTH_REQUIRED`.

Phase 3 - Same grant bundle:

- Bind MCP OAuth token to the same Agentic grant bundle hash when A2A already holds valid authorization.

### 22.3 `verifiable-content-demo`

Phase 1 - Replace custom entitlement checks:

- Move content access policy to `@agenticprimitives/entitlements`.
- Public-domain content can be low-risk/no entitlement.
- Licensed/private content requires entitlement; private corpus additionally requires key release.

Phase 2 - Store private retrieval payloads in vault:

- Descriptors stay public/verifiable.
- Private text and retrieval payloads become encrypted vault objects.
- Commitment chain remains: descriptor commitment -> encrypted vault object commitment -> decrypt only after entitlement.

Phase 3 - Add MCP OAuth compatibility:

- Public HTTP MCP content server exposes protected-resource metadata.
- Require audience-bound MCP access token.
- Resolve grant bundle, then evaluate content entitlement and normal vault/key-release path.

### 22.4 Web/demo apps

Consent UX shows MCP server, client app, principal, delegate/agent, tools, resources, actions, fields, purpose, duration, constraints, and risk tier.

On approval:

1. User signs Agentic delegation.
2. Entitlement is issued or selected.
3. OAuth AS creates encrypted grant bundle.
4. OAuth AS issues audience-bound MCP token.

Sensitive information collection should use URL-mode/hosted consent flows, not generic MCP form elicitation for secrets.

## 23. Cloudflare Deployment Recommendation

```
Worker: public MCP endpoint
  - Streamable HTTP MCP transport
  - protected resource metadata
  - OAuth validation
  - MCP runtime wrapper

Worker or route group: authorization server
  - authorize/token/register endpoints
  - consent UX
  - grant bundle creation

Durable Objects
  - OAuth sessions, PKCE/CSRF, A2A tasks, replay, vault write coordination

D1
  - metadata, grant bundle index, entitlement cache, JTI replay, audit index, key grant ledger

R2
  - encrypted vault blobs, encrypted grant bundles, encrypted private entitlement/delegation payloads

External KMS/HSM or isolated key service
  - KEKs, DEK unwrap/decrypt, decrypt grant verification
```

## 24. Security Invariants

CI should enforce where possible:

1. OAuth token alone must never decrypt PII.
2. OAuth token with wrong audience must be rejected.
3. OAuth token must not be passed downstream.
4. Delegation must be audience-bound, tool-bound, resource-bound, and expiry-bound.
5. Sensitive tools must require exact args hash.
6. Entitlements must be checked on every sensitive tool call.
7. Revoked delegation or entitlement fails closed.
8. JTI replay fails closed.
9. Unknown tool classification fails closed.
10. D1/R2 must not contain plaintext PII.
11. Audit events must not contain raw PII or tokens.
12. PII/key-release operations fail closed if required audit fails.
13. Vault decrypt must be field-projected; no over-fetching.
14. KAS verifies decrypt grants independently.
15. Break-glass/export/key-rotation requires critical-tier policy.

## 25. Test Plan

OAuth:

- missing token -> `401` + protected resource metadata
- expired token -> `401`
- wrong audience -> `401`
- missing scope -> `403 insufficient_scope`
- valid token but missing grant bundle -> `403`
- tampered grant hash -> `403`
- token passthrough attempt -> blocked

Delegation:

- valid delegation -> proceeds
- expired/revoked delegation -> deny
- wrong MCP audience/tool/args hash -> deny
- JTI replay -> deny

Entitlement:

- valid field entitlement -> only those fields
- missing field -> deny or omit
- wrong purpose -> deny
- expired/revoked/suspended -> deny
- classification ceiling exceeded -> deny

Vault:

- D1/R2 contain no plaintext PII
- AAD mismatch -> decrypt fails
- wrong resource binding -> decrypt fails
- field projection decrypts only allowed fields
- crypto-shredded object cannot decrypt

KAS:

- valid decrypt grant -> allow
- expired/replayed grant -> deny
- wrong policy/entitlement/object -> deny
- fail-hard audit unavailable -> deny

Apps:

- `demo-a2a` can call `demo-mcp` with OAuth-bound grant
- browser never sees MCP access token
- generic MCP client discovers auth server
- generic MCP client can list low-risk tools after OAuth
- generic MCP client cannot read PII without AP grant bundle

## 26. Implementation Order

### Milestone 1 - Spec, Vault Types, and Policy Constants

Add:

- `specs/277-mcp-delegated-vault-authorization.md`
- `VaultObjectEnvelopeV1`, `VaultAuthorizationContext`, and `DecryptGrantV1` fixtures
- `tool-policy` profile constants for `agentic-delegated-vault-v1`
- standard vault denial reasons and test vectors

Deliverables: vault risk taxonomy, annotations, denial reasons, fixtures.

### Milestone 2 - `@agenticprimitives/vault`

Implement vault envelope, D1 metadata adapter, R2 blob adapter, WebCrypto AES-GCM provider, AAD binding, encrypted tags, masking/tokenization interfaces, migration helpers, and plaintext scanners.

Put vault interfaces around existing `demo-mcp` PII and `vault_records` first, then migrate PII and private authority artifacts out of plaintext D1.

### Milestone 3 - `@agenticprimitives/entitlements`

Implement entitlement credentials, verification, matching, status/revocation, and cache adapters for resource/action/field/purpose/classification access.

Replace hard-coded entitlement checks in demos.

### Milestone 4 - `@agenticprimitives/key-authorization`

Implement decrypt grants, verification, one-time replay store, KAS interface, local dev KAS, KMS-backed production adapter, and required audit ledger.

Wire PII tools through key release.

### Milestone 5 - `mcp-runtime` Vault Integration

Implement `withVaultAuthorization` / `withMcpDelegatedAuthorization` around the vault path: exact args hash, entitlement resolution, field projection, purpose enforcement, replay checks, key-release grant, and fail-hard audit.

Sensitive tools should call `ctx.vault.read/write`, not direct database reads or direct decrypt.

### Milestone 6 - `@agenticprimitives/mcp-oauth`

Implement protected resource metadata, `WWW-Authenticate` helpers, token verifier interface, authorization details parser, grant bundle type, and encrypted grant store interface.

Update `demo-mcp` to expose metadata and support public OAuth mode only after the delegated vault path is solid. Update `demo-a2a` to obtain MCP tokens server-side.

### Milestone 7 - Hardening

Add negative security tests, secret/PII log scanner, database plaintext scanner, revocation tests, wrong-audience tests, token-passthrough tests, and CI policy that every sensitive tool has required annotations.

## 27. Final Package Shape

```
packages/
  vault/
    src/envelope.ts
    src/aad.ts
    src/crypto.ts
    src/storage.ts
    src/field-policy.ts
    src/validation.ts
    src/tokenization.ts
    src/masking.ts
    src/encrypted-tags.ts
    src/cloudflare-d1.ts
    src/cloudflare-r2.ts
    src/durable-object-coordinator.ts
    src/migrations.ts
    src/testing.ts

  key-authorization/
    src/decrypt-grant.ts
    src/grant-verifier.ts
    src/key-authorization-service.ts
    src/replay-store.ts
    src/d1-ledger.ts
    src/remote-client.ts
    src/testing.ts

  entitlements/
    src/credential.ts
    src/presentation.ts
    src/verify.ts
    src/match.ts
    src/resolver.ts
    src/status-list.ts
    src/d1-cache.ts
    src/testing.ts

  mcp-runtime/
    src/with-vault-authorization.ts
    src/with-mcp-delegated-authorization.ts
    src/oauth-context.ts
    src/grant-context.ts
    src/vault-context.ts
    src/errors.ts

  mcp-oauth/
    src/protected-resource.ts
    src/www-authenticate.ts
    src/token-verifier.ts
    src/authorization-details.ts
    src/grant-bundle.ts
    src/grant-store.ts
    src/cloudflare.ts
    src/testing.ts

  key-custody/src/vault-aad.ts
  tool-policy/src/profiles/agentic-delegated-vault-v1.ts
  delegation/src/caveats/mcp.ts
  delegation/src/caveats/vault.ts
  audit/src/required-sink.ts
  audit/src/events/mcp.ts
  audit/src/events/vault.ts
  audit/src/events/key-release.ts
```

Apps:

```
apps/demo-mcp/src/routes/protected-resource.ts
apps/demo-mcp/src/routes/authorize.ts
apps/demo-mcp/src/routes/token.ts
apps/demo-mcp/src/routes/mcp.ts
apps/demo-mcp/src/tools/vault-read-pii.ts
apps/demo-mcp/src/tools/vault-write-pii.ts
apps/demo-a2a/src/mcp-oauth-bridge.ts
apps/demo-a2a/src/entitlement-required.ts
```

## 28. Key Rule

KMS/HSM protects keys. The AP vault protects data. Delegations and entitlements decide release.

OAuth is only the MCP compatibility and ingress authorization adapter for public HTTP MCP servers.

OAuth tokens prove that a client/session may call an MCP resource. They do **not** grant PII access by themselves.

Sensitive vault tools require Agentic delegation, entitlement match, deterministic tool policy, replay protection, field-scoped key-release grant, and PII-free fail-hard audit. Public HTTP MCP tools additionally require OAuth audience validation.
