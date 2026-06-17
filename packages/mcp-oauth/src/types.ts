// MCP OAuth compatibility types (spec 277 §6–§8 + §15).
//
// OAuth here is ONLY a compatibility adapter for public HTTP MCP clients — it is
// NOT the vault authority model. A validated bearer token carries a *reference +
// hash* to an Agentic Grant Bundle (the real delegation/entitlement context);
// the normal delegated vault path then runs. No private delegation/entitlement
// payload ever rides in the token, and an inbound MCP token is never reused
// downstream.

export type Sha256 = `sha256:${string}`;

// ── §6.1 Protected Resource Metadata (RFC 9728) ──────────────────────
export interface OAuthProtectedResourceMetadata {
  resource: string;
  authorization_servers: string[];
  scopes_supported: string[];
  bearer_methods_supported: ['header'];
  resource_documentation?: string;
}

// ── §6.2 Recommended scopes (coarse compatibility hints; NOT field authority) ──
export const MCP_OAUTH_SCOPES = [
  'mcp:invoke',
  'mcp:tools:list',
  'mcp:resources:list',
  'vault:read',
  'vault:write',
  'vault:pii:read',
  'vault:pii:write',
  'vault:export',
  'vault:admin',
  'entitlement:read',
  'entitlement:write',
  'delegation:read',
  'delegation:write',
] as const;
export type McpOAuthScope = (typeof MCP_OAUTH_SCOPES)[number];

// ── §6.3 Rich Authorization Request (RFC 9396 authorization_details entry) ──
export interface AgenticMcpAuthorizationDetail {
  type: 'agentic_mcp_tool';
  locations?: string[];
  mcp_server: string;
  tool: string;
  resources?: string[];
  actions?: string[];
  fields?: string[];
  purpose?: string;
  constraints?: {
    noPersist?: boolean;
    noTraining?: boolean;
    redactByDefault?: boolean;
  };
}

// ── §8 OAuth Token Profile — the MCP access-token claims ─────────────
export interface McpAccessTokenClaims {
  iss: string;
  sub: string;
  aud: string;
  client_id?: string;
  jti?: string;
  iat?: number;
  exp?: number;
  nbf?: number;
  scope?: string;
  resource?: string;
  /** Agentic Primitives binding — references the grant bundle, never its payload. */
  ap_principal?: string;
  ap_delegate?: string;
  ap_grant_ref?: string;
  ap_grant_hash?: Sha256;
  ap_policy_profile?: string;
}

export type BearerRejectReason =
  | 'missing_token'
  | 'malformed'
  | 'signature_invalid'
  | 'expired'
  | 'not_yet_valid'
  | 'audience_mismatch'
  | 'issuer_untrusted'
  | 'client_mismatch'
  | 'insufficient_scope'
  | 'grant_ref_missing'
  | 'grant_hash_missing';

export type BearerValidation =
  | { ok: true; claims: McpAccessTokenClaims; scopes: string[] }
  | { ok: false; reason: BearerRejectReason; missingScopes?: string[] };

// ── §7 Agentic Grant Bundle — the OAuth↔AP authorization bridge ──────
export interface McpGrantBundleV1 {
  type: 'McpGrantBundleV1';
  id: `urn:ap:mcp-grant:${string}`;
  hash: Sha256;
  oauth: {
    issuer: string;
    clientId: string;
    subject: string;
    audience: string;
    scopes: string[];
    authorizationDetailsHash?: Sha256;
  };
  principal: { id: string; account?: string };
  delegate?: { id: string; account?: string };
  mcp: { resourceUri: string; serverId: string; allowedTools?: string[] };
  delegation: {
    delegationHash: Sha256;
    delegationTokenRef?: string;
    chainId?: number;
    expiresAt: string;
    caveatsHash: Sha256;
    revocation: { mode: 'onchain' | 'registry' | 'status-list' | 'none'; ref?: string };
  };
  entitlements: Array<{
    entitlementHash: Sha256;
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
  replay: { jtiSeed: string; nonceScope: 'oauth-token' | 'tool-call' | 'decrypt-grant' };
  policy: { profile: 'mcp-delegated-vault-v1'; policyHash: Sha256; toolPolicyVersion: string };
  issuedAt: string;
  expiresAt: string;
  status: 'active' | 'revoked' | 'expired';
}

/** Store for encrypted grant bundles (the index/blob lives in the app/runtime;
 *  this is the lookup contract the token→bundle resolver uses). */
export interface GrantBundleStore {
  get(id: string): Promise<McpGrantBundleV1 | null>;
}
