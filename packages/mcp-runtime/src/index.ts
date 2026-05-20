// @agenticprimitives/mcp-runtime — public API
//
// See ../../specs/205-mcp-runtime.md for the full contract.

export {
  withDelegation,
  withCrossDelegation,
  verifyDelegationForResource,
  verifyCrossDelegationForResource,
  McpAuthError,
} from './with-delegation';
export { declareResource } from './declare-resource';
export {
  createMemoryJtiStore,
  createSqliteJtiStore,
  createPostgresJtiStore,
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
