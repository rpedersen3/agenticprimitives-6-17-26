# Spec 203 — `@agenticprimitives/key-custody`

**Capability:** Pluggable envelope encryption + signers + HMAC providers. Narrower than smart-agent's `apps/a2a-agent/src/auth/*` grouping because session lifecycle lives in `delegation`.
**Status:** v0 draft · 2026-05-19
**Reference implementation:** `smart-agent/packages/sdk/src/key-custody/*`; `smart-agent/apps/a2a-agent/src/auth/{key-provider,a2a-signer,encryption,mac-provider,sign-outbound}.ts`.

> **Net change from the original 003 spec:** session lifecycle (`encryptSessionPackage` / `decryptSessionPackage` and the `SessionManager`) moves to `@agenticprimitives/delegation`. This package now owns the **primitives** that delegation's `SessionManager` calls. HMAC providers stay in this package under the `/mac` subpath because they share KMS backends with envelope encryption, even though the threat model differs.

---

## 1. Goal

Pluggable KMS abstraction with four jobs, no more:

1. **Envelope-encrypt** arbitrary opaque payloads at rest, bound to AAD context the caller supplies.
2. **Sign** tokens and on-chain transactions using a key the KMS holds (a master signer or a per-tool executor signer), without exfiltrating the key.
3. **Generate HMACs** for inter-service envelopes (web↔a2a, a2a↔mcp).
4. **Swap backends** — local-AES (dev), AWS KMS, GCP KMS — by changing env, with a hard guard against using dev backends in production.

**Out of scope (moved to `delegation`):** session-package shape, session lifecycle state machine, AAD shape decisions. This package exposes `generateSessionDataKey` and `decryptSessionDataKey` as low-level primitives; `delegation.SessionManager` wires them into the lifecycle.

---

## 2. Backends shipped in v0

| Backend | Use case | Provider classes |
| --- | --- | --- |
| `local-aes` | Local dev only (refuses to boot in `NODE_ENV=production`) | `LocalAesProvider`, `LocalSecp256k1Signer` |
| `aws-kms` | Production AWS | `AwsKmsProvider`, `AwsKmsSigner` (ECC_SECG_P256K1) |
| `gcp-kms` | Production GCP | `GcpKmsProvider`, `GcpKmsSigner` (EC_SIGN_SECP256K1_SHA256) |

`vault-transit` is deliberately NOT shipped (smart-agent removed it in G-PR-1). Consumers needing Vault implement the `A2AKeyProvider` interface against it.

Smart-agent ref: `packages/sdk/src/key-custody/{local-aes-provider,aws-kms-provider,gcp-kms-provider,local-secp256k1-signer,aws-kms-signer,gcp-kms-signer,tool-executor-signer}.ts`; selector at `apps/a2a-agent/src/auth/key-provider.ts:302-633`.

---

## 3. Core interface

```ts
export interface A2AKeyProvider {
  readonly keyVersion: string;

  /** Generate a fresh data key; return plaintext + KMS-wrapped blob. AAD context bound by KMS EncryptionContext. */
  generateSessionDataKey(input: {
    aadContext: Record<string, string>;
  }): Promise<{
    plaintextDataKey: Uint8Array;
    encryptedDataKey: Uint8Array;
    keyId: string;
    keyVersion: string;
  }>;

  /** Decrypt a wrapped data key. AAD must match exactly what was used at wrap time. */
  decryptSessionDataKey(input: {
    encryptedDataKey: Uint8Array;
    aadContext: Record<string, string>;
    keyId: string;
    keyVersion: string;
  }): Promise<Uint8Array>;

  /** Asymmetric secp256k1 signing — for master / per-tool signers. Optional. */
  signA2AAction?(input: {
    digest: Uint8Array;
    auditContext?: { toolId?: string; sessionId?: string; actionId?: string };
  }): Promise<{ signature: Uint8Array; keyId: string; signerAddress: Address }>;

  /** HMAC-SHA-256 for inter-service envelopes. Optional. */
  generateMac?(input: {
    canonicalMessage: Uint8Array;
    service: string;
    audience: string;
  }): Promise<{ mac: Uint8Array; keyId: string }>;
}
```

Optional methods because not every backend implements every capability (e.g., `local-aes` doesn't implement `signA2AAction`; a separate signer backend pairs with it).

---

## 4. Public API

```ts
// Provider factories (selected by env or explicit config)
export function buildKeyProvider(opts: BuildOpts): A2AKeyProvider;
export function buildSignerBackend(opts: BuildOpts): KmsAccountBackend;
export function buildToolExecutorBackend(toolId: string, opts: BuildOpts): KmsAccountBackend;
export function getRelayOnlySigner(opts: BuildOpts): KmsAccountBackend;

// Per-subject custodian signer — a secp256k1 key bound to an OIDC subject,
// derived from the server master (spec 235: Google × KMS custody). The
// returned backend's address is the per-subject custodian `C_sub`.
//   local-aes: HKDF(master, info = "kms-custodian:v1:<enc(iss)>:<enc(sub)>:<rotation>") → priv,
//              wrapped in LocalSecp256k1Signer (production guard applies).
//   gcp-kms / aws-kms: NOT YET BUILT — fail closed (no silent fallback, ADR-0013).
export function deriveSubjectSigner(opts: BuildOpts & { subject: SubjectId }): KmsAccountBackend;
export function deriveSubjectPrivateKeyHex(master: Uint8Array, subject: SubjectId): Hex; // pure (tested)
export function subjectCanonicalMessage(subject: SubjectId): string;
export interface SubjectId { iss: string; sub: string; rotation?: number }

// Built-in implementations (also via subpaths)
export { LocalAesProvider, LocalSecp256k1Signer } from './providers/local';
export { AwsKmsProvider, AwsKmsSigner } from './providers/aws';
export { GcpKmsProvider, GcpKmsSigner } from './providers/gcp';

// Signer wrapper for viem
export interface KmsAccountBackend {
  signA2AAction: NonNullable<A2AKeyProvider['signA2AAction']>;
  getSignerAddress(): Promise<Address>;
}
export function createKmsAccount(backend: KmsAccountBackend, opts?: { sessionId?: string; chainId?: number }): Promise<KMSSigner>;

// AAD helpers (consumed by delegation.SessionManager)
export function canonicalContextBytes(ctx: Record<string, string>): Uint8Array;

// MAC providers (subpath: @agenticprimitives/key-custody/mac)
export function buildMacProvider(audience: string, opts: BuildOpts): A2AKeyProvider;
```

### Configuration via env (consumer-set)
```
A2A_KMS_BACKEND=local-aes | aws-kms | gcp-kms

# local-aes (dev only)
A2A_SESSION_SECRET=<hex>

# aws-kms
AWS_REGION=...
AWS_ROLE_ARN=...
AWS_KMS_SESSION_KEY_ID=...               # data-key wrapping
AWS_KMS_MASTER_SIGNER_KEY_ID=...         # secp256k1 master signer
AWS_KMS_TOOL_EXECUTOR_<TOOL>_KEY_ID=...  # per-tool signers
AWS_KMS_MAC_<AUDIENCE>_KEY_ID=...        # HMAC keys

# gcp-kms (Workload Identity Federation required)
GCP_PROJECT=...
GCP_KMS_LOCATION=...
GCP_KMS_KEY_RING=...
GCP_KMS_SESSION_KEY=...
GCP_KMS_MASTER_SIGNER_KEY=...
GCP_KMS_TOOL_EXECUTOR_<TOOL>_KEY=...
GCP_KMS_MAC_<AUDIENCE>_KEY=...
```

---

## 5. Security boundaries (preserved from smart-agent)

1. **No production fallback.** AWS/GCP backends fail-closed if KMS unreachable.
2. **Production guard.** `local-aes` and any `*_PRIVATE_KEY` env throw at boot when `NODE_ENV=production`.
3. **Master-key separation.** The master signer, per-tool executor keys, and session-data-key wrapping keys are distinct IAM-scoped KMS keys.
4. **Relay-only master.** In Phase B, `getRelayOnlySigner()` returns a signer that throws on any `signMessage` / `signUserOp` call. Master is broadcaster only.
5. **AAD trip-wire.** AES-GCM AAD and KMS EncryptionContext are bound identically; any tampering trips both checks.
6. **Audit trails.** Every `Decrypt` and signing operation emits an audit row including `keyVersion`, hashed sessionId, optional toolId/actionId. Raw sessionId never logged.

---

## 6. Test plan (v0)

- Unit: AES-GCM round trip, KMS provider mocks for AWS/GCP, production guard rejection.
- Integration: `LocalAesProvider` + `LocalSecp256k1Signer` paired through a mock `SessionManager` (real `SessionManager` lives in `delegation`'s test suite).
- Negative: tampered AAD (KMS context mismatch), wrong `keyVersion`.
- Conformance (against real AWS/GCP): provider trip-wire test in CI behind opt-in env to avoid charging KMS calls.

---

## 7. Known in-flight items (003-intent-marketplace-proposal)

- **GCP KMS rollout (G-PR-1 → G-PR-5):** envelope + master signer + MAC live; per-tool executor (G-PR-4) in progress.
- **Phase B master-relay-only:** `getRelayOnlySigner` introduced.
- **Per-tool executor signer (K5):** stable for existing tool families (`round-awards`, `disbursement`); pattern generalizes via `buildToolExecutorBackend(toolId, ...)`.

---

## 8. Smart-agent file index

| Concern | File | Lines |
| --- | --- | --- |
| Provider interface | `packages/sdk/src/key-custody/types.ts` | 58–145 |
| Backend selector | `apps/a2a-agent/src/auth/key-provider.ts` | 302–633 |
| Signer wrapper | `apps/a2a-agent/src/auth/a2a-signer.ts` | 1–340 |
| MAC selector | `apps/a2a-agent/src/auth/mac-provider.ts` | 53–166 |
| Outbound MAC signing | `apps/a2a-agent/src/auth/sign-outbound.ts` | 63–79 |
| AWS provider | `packages/sdk/src/key-custody/aws-kms-provider.ts` | full |
| GCP provider | `packages/sdk/src/key-custody/gcp-kms-provider.ts` | full |
| Local AES | `packages/sdk/src/key-custody/local-aes-provider.ts` | full |
| Per-tool signer | `packages/sdk/src/key-custody/tool-executor-signer.ts` | full |
