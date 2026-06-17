// @agenticprimitives/mcp-oauth — MCP OAuth compatibility + Agentic Grant Bundle
// bridge (spec 277 §6–§8, §15).
//
// OAuth is ONLY a compatibility adapter for public HTTP MCP clients — NOT the
// vault authority model. This package: protected-resource metadata, scopes,
// WWW-Authenticate challenges, bearer-token CLAIM validation (signature
// injected), the authorization_details (RAR) shape, and the Agentic Grant
// Bundle (token references it by id+hash; the normal delegated vault path runs
// off the bundle). Dependency-free + runtime-agnostic; JWT verification, the
// authorization server, and the encrypted bundle store live in the app/runtime.
// An inbound MCP token is never reused downstream.

export const PACKAGE_NAME = '@agenticprimitives/mcp-oauth';
export const PACKAGE_STATUS = 'w1-compat-bridge' as const;
export const SPEC_REF = 'specs/277-mcp-delegated-vault-authorization.md';

export {
  type Sha256,
  type OAuthProtectedResourceMetadata,
  type McpOAuthScope,
  type AgenticMcpAuthorizationDetail,
  type McpAccessTokenClaims,
  type BearerRejectReason,
  type BearerValidation,
  type McpGrantBundleV1,
  type GrantBundleStore,
  MCP_OAUTH_SCOPES,
} from './types.js';

export { createProtectedResourceMetadata, serveProtectedResourceMetadata } from './metadata.js';

export {
  createWwwAuthenticateChallenge,
  buildUnauthorizedResponse,
  buildInsufficientScopeResponse,
} from './challenge.js';

export {
  type ValidateMcpBearerOpts,
  parseBearer,
  scopesOf,
  requireMcpAudience,
  requireScopes,
  validateMcpBearerToken,
  buildAuthorizationDetailsRequest,
  parseAuthorizationDetails,
} from './token.js';

export {
  type GrantBundleResolution,
  sha256Hex,
  computeGrantBundleHash,
  createMcpGrantBundle,
  bindOAuthTokenToGrantBundle,
  resolveGrantBundleFromToken,
} from './bundle.js';
