// Vault types (spec 277 — Agentic Delegated Data Vault). Phase 1 surface: the
// runtime `Vault` seam + the data classification taxonomy + the persisted
// envelope shape. Encryption (the `crypto`/`fields` envelope population),
// field projection, entitlements, and DecryptGrant are later phases — this
// file is intentionally storage/runtime-agnostic and dependency-free so it can
// be the shared contract every adapter (D1, R2, in-memory) implements.

/** Sensitivity class of a vault object — drives encryption key domain, field
 *  policy, and the classification ceiling on a read (spec 277 §13 / doc 13). */
export type VaultClassification =
  | 'public'
  | 'internal'
  | 'pii.low'
  | 'pii.sensitive'
  | 'secret.high'
  | 'delegation.private'
  | 'entitlement.private'
  | 'agent.memory.private'
  | 'regulated.high';

/** Classifications that hold PII/secret material — used by callers to decide
 *  when custody-grade authorization + (Phase 2+) encryption are mandatory. */
export const SENSITIVE_CLASSIFICATIONS: readonly VaultClassification[] = [
  'pii.low',
  'pii.sensitive',
  'secret.high',
  'delegation.private',
  'entitlement.private',
  'agent.memory.private',
  'regulated.high',
];

export function isSensitiveClassification(c: VaultClassification): boolean {
  return SENSITIVE_CLASSIFICATIONS.includes(c);
}

/** A logical resource address within an owner's vault, e.g. `person-pii`,
 *  `org-sensitive`, `vault:contacts`. Opaque to the package; the app/adapter
 *  maps it to physical storage. */
export type VaultResource = string;

/** The result of a vault read — the materialized object the caller works with.
 *  In Phase 1 `data` is the stored plaintext; in Phase 2+ it is the decrypted,
 *  field-projected payload. */
export interface VaultObject<T = unknown> {
  owner: string;
  resource: VaultResource;
  classification: VaultClassification;
  data: T;
  updatedAt: string;
}

/** A read request. `fields` (Phase 3) requests an explicit field projection;
 *  when omitted the whole object is returned. */
export interface VaultReadRequest {
  owner: string;
  resource: VaultResource;
  fields?: string[];
}

/** A write request. `data === null` soft-deletes (tombstone). */
export interface VaultWriteRequest<T = unknown> {
  owner: string;
  resource: VaultResource;
  data: T | null;
  classification?: VaultClassification;
}

/** A lightweight reference to a live object (no payload) — what `list` returns. */
export interface VaultRef {
  resource: VaultResource;
  classification: VaultClassification;
  updatedAt: string;
}

/**
 * The persisted vault object envelope (spec 277 §13.5 / doc 13). Phase 1
 * adapters MAY store plaintext via `plaintext` (the metadata-only envelope);
 * Phase 2 populates `crypto` (+ optional per-`fields` envelopes) and drops
 * `plaintext`. Modeled now so storage adapters share one on-disk shape across
 * the plaintext→encrypted migration.
 */
export interface VaultObjectEnvelopeV1<T = unknown> {
  type: 'VaultObjectEnvelopeV1';
  owner: string;
  resource: VaultResource;
  classification: VaultClassification;
  /** Phase 1 only — the plaintext payload, present until encryption lands. */
  plaintext?: T;
  /** Phase 2+ — envelope-encryption refs; mutually exclusive with `plaintext`. */
  crypto?: {
    alg: 'A256GCM';
    ciphertextRef: string;
    wrappedDekRef: string;
    dekKid: string;
    keyVersion: string;
    aadHash: `sha256:${string}`;
  };
  createdAt: string;
  updatedAt: string;
  /** Soft-delete marker; tombstoned objects are absent from reads/lists. */
  deletedAt?: string | null;
}
