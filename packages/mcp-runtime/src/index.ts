// @agenticprimitives/mcp-runtime — public API
//
// See ../../specs/205-mcp-runtime.md for the full contract.

// H7-B.8: `withCrossDelegation` + `verifyCrossDelegationForResource` removed
// from the public surface (XPKG-002 / EXT-024 closure). Both were stubs that
// unconditionally rejected. They will resurface behind `./experimental` per
// spec 100 §6 when the cross-delegation work resumes.
export {
  withDelegation,
  verifyDelegationForResource,
  McpAuthError,
} from './with-delegation';
export { declareResource } from './declare-resource';
export {
  createMemoryJtiStore,
  createSqliteJtiStore,
  createPostgresJtiStore,
  type MigratableJtiStore,
} from './jti-stores';
export {
  generateServiceMac,
  verifyServiceMac,
  bodyDigestHex,
} from './service-mac';
export type {
  MacProviderLike,
  ServiceMacContext,
  ServiceMacHeaders,
} from './service-mac';

export type {
  Address,
  Hex,
  Caveat,
  DataScopeGrant,
  Delegation,
  EnforcerAddressMap,
  JtiStore,
  ToolClassification,
  McpResourceVerifyConfig,
  ResourceDefinition,
  BetterSqlite3DatabaseLike,
  PgPoolLike,
} from './types';
