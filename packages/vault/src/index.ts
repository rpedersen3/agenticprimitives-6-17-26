// @agenticprimitives/vault — the Agentic Delegated Data Vault seam (spec 277).
//
// Phase 1: the `Vault` interface + data-classification taxonomy + persisted
// envelope shape + an in-memory reference adapter. Encryption, field
// projection, entitlements, and DecryptGrant key-release land in later phases
// behind this same interface. Storage adapters (D1/R2) live in the consuming
// app/runtime — this package stays runtime-agnostic and dependency-free.

export const PACKAGE_NAME = '@agenticprimitives/vault';
export const PACKAGE_STATUS = 'w1-phase1' as const;
export const SPEC_REF = 'specs/277-mcp-delegated-vault-authorization.md';

export {
  type VaultClassification,
  type VaultResource,
  type VaultObject,
  type VaultReadRequest,
  type VaultWriteRequest,
  type VaultRef,
  type VaultObjectEnvelopeV1,
  SENSITIVE_CLASSIFICATIONS,
  isSensitiveClassification,
} from './types.js';

export { type Vault, createMemoryVault, projectFields } from './vault.js';

export {
  type DekWrapper,
  type SealedEnvelope,
  sealEnvelope,
  openEnvelope,
} from './envelope.js';
