// spec 277 §6–§8,§15 — MCP OAuth compat + grant-bundle bridge.
import { describe, it, expect } from 'vitest';
import {
  createProtectedResourceMetadata,
  createWwwAuthenticateChallenge,
  buildInsufficientScopeResponse,
  parseBearer,
  requireMcpAudience,
  requireScopes,
  validateMcpBearerToken,
  parseAuthorizationDetails,
  createMcpGrantBundle,
  bindOAuthTokenToGrantBundle,
  resolveGrantBundleFromToken,
  type McpAccessTokenClaims,
  type McpGrantBundleV1,
} from '../../src/index.js';

const AUD = 'https://mcp.example.com/mcp';
const NOW = new Date('2026-06-17T00:00:00Z');
const nowSec = Math.floor(NOW.getTime() / 1000);

function claims(over: Partial<McpAccessTokenClaims> = {}): McpAccessTokenClaims {
  return {
    iss: 'https://auth.example.com',
    sub: 'did:pkh:eip155:8453:0xPrincipal',
    aud: AUD,
    exp: nowSec + 300,
    scope: 'mcp:invoke vault:pii:read',
    ap_grant_ref: 'urn:ap:mcp-grant:01J',
    ap_grant_hash: 'sha256:deadbeef',
    ...over,
  };
}

describe('metadata + challenge', () => {
  it('protected-resource metadata shape', () => {
    const m = createProtectedResourceMetadata({ resource: AUD, authorizationServers: ['https://auth.example.com'], scopesSupported: ['mcp:invoke'] });
    expect(m.resource).toBe(AUD);
    expect(m.bearer_methods_supported).toEqual(['header']);
  });
  it('WWW-Authenticate challenge + insufficient_scope 403', async () => {
    const h = createWwwAuthenticateChallenge({ resourceMetadataUrl: 'https://x/.well-known/oauth-protected-resource', error: 'insufficient_scope', scope: ['vault:pii:read'] });
    expect(h).toMatch(/^Bearer /);
    expect(h).toContain('error="insufficient_scope"');
    const r = buildInsufficientScopeResponse({ missingScopes: ['vault:pii:read'] });
    expect(r.status).toBe(403);
    expect(r.headers.get('www-authenticate')).toContain('insufficient_scope');
  });
});

describe('parseBearer + scope/audience helpers', () => {
  it('parseBearer', () => {
    expect(parseBearer('Bearer abc.def')).toBe('abc.def');
    expect(parseBearer('bearer x')).toBe('x');
    expect(parseBearer('Basic x')).toBeNull();
    expect(parseBearer(null)).toBeNull();
  });
  it('requireMcpAudience matches aud or resource', () => {
    expect(requireMcpAudience(claims(), AUD)).toBe(true);
    expect(requireMcpAudience(claims({ aud: 'other', resource: AUD }), AUD)).toBe(true);
    expect(requireMcpAudience(claims({ aud: 'other', resource: undefined }), AUD)).toBe(false);
  });
  it('requireScopes reports missing', () => {
    expect(requireScopes(claims(), ['mcp:invoke']).ok).toBe(true);
    expect(requireScopes(claims(), ['vault:write']).missing).toEqual(['vault:write']);
  });
});

describe('validateMcpBearerToken (signature injected)', () => {
  const verify = (c: McpAccessTokenClaims) => async () => c;
  it('accepts a well-formed token', async () => {
    const v = await validateMcpBearerToken('tok', { verify: verify(claims()), audience: AUD, requiredScopes: ['mcp:invoke'], requireGrantBinding: true, now: NOW });
    expect(v.ok).toBe(true);
  });
  it('fail-closed reasons', async () => {
    expect((await validateMcpBearerToken(null, { verify: verify(claims()), audience: AUD })).ok).toBe(false);
    expect(((await validateMcpBearerToken('t', { verify: verify(claims({ exp: nowSec - 1 })), audience: AUD, now: NOW })) as any).reason).toBe('expired');
    expect(((await validateMcpBearerToken('t', { verify: verify(claims({ aud: 'x', resource: undefined })), audience: AUD, now: NOW })) as any).reason).toBe('audience_mismatch');
    expect(((await validateMcpBearerToken('t', { verify: verify(claims()), audience: AUD, trustedIssuers: ['https://other'], now: NOW })) as any).reason).toBe('issuer_untrusted');
    expect(((await validateMcpBearerToken('t', { verify: verify(claims({ scope: 'mcp:invoke' })), audience: AUD, requiredScopes: ['vault:write'], now: NOW })) as any).missingScopes).toEqual(['vault:write']);
    expect(((await validateMcpBearerToken('t', { verify: verify(claims({ ap_grant_ref: undefined })), audience: AUD, requireGrantBinding: true, now: NOW })) as any).reason).toBe('grant_ref_missing');
    expect(((await validateMcpBearerToken('t', { verify: async () => { throw new Error('bad sig'); }, audience: AUD, now: NOW })) as any).reason).toBe('signature_invalid');
  });
});

describe('authorization_details', () => {
  it('parses only agentic_mcp_tool entries', () => {
    const parsed = parseAuthorizationDetails([
      { type: 'agentic_mcp_tool', mcp_server: 'urn:mcp:pii', tool: 'vault.read_pii', fields: ['email'] },
      { type: 'other' },
      { type: 'agentic_mcp_tool' }, // missing mcp_server/tool → dropped
    ]);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]!.tool).toBe('vault.read_pii');
  });
});

describe('grant bundle bridge', () => {
  async function bundle(over: Partial<McpGrantBundleV1> = {}): Promise<McpGrantBundleV1> {
    return createMcpGrantBundle({
      id: 'urn:ap:mcp-grant:01J',
      oauth: { issuer: 'https://auth', clientId: 'c1', subject: 'did:x', audience: AUD, scopes: ['mcp:invoke'] },
      principal: { id: 'did:pkh:eip155:8453:0xPrincipal' },
      mcp: { resourceUri: AUD, serverId: 'pii' },
      delegation: { delegationHash: 'sha256:del', expiresAt: '2026-06-18T00:00:00Z', caveatsHash: 'sha256:cav', revocation: { mode: 'none' } },
      entitlements: [],
      constraints: { maxTtlSeconds: 120 },
      replay: { jtiSeed: 'seed', nonceScope: 'tool-call' },
      policy: { profile: 'mcp-delegated-vault-v1', policyHash: 'sha256:pol', toolPolicyVersion: '1' },
      issuedAt: '2026-06-17T00:00:00Z',
      expiresAt: '2026-06-18T00:00:00Z',
      status: 'active',
      ...over,
    });
  }

  it('createMcpGrantBundle stamps a stable canonical hash; bindOAuthTokenToGrantBundle exposes ref+hash', async () => {
    const b = await bundle();
    expect(b.hash).toMatch(/^sha256:[0-9a-f]{64}$/);
    const binding = bindOAuthTokenToGrantBundle(b);
    expect(binding.ap_grant_ref).toBe(b.id);
    expect(binding.ap_grant_hash).toBe(b.hash);
  });

  it('resolveGrantBundleFromToken: hash-match allow; mismatch/revoked/expired/not-found deny', async () => {
    const b = await bundle();
    const store = (m: McpGrantBundleV1 | null) => ({ get: async () => m });
    expect((await resolveGrantBundleFromToken(claims({ ap_grant_hash: b.hash }), store(b), NOW)).ok).toBe(true);
    expect(((await resolveGrantBundleFromToken(claims({ ap_grant_hash: 'sha256:wrong' }), store(b), NOW)) as any).reason).toBe('hash_mismatch');
    expect(((await resolveGrantBundleFromToken(claims({ ap_grant_hash: b.hash }), store({ ...b, status: 'revoked' }), NOW)) as any).reason).toBe('revoked');
    expect(((await resolveGrantBundleFromToken(claims({ ap_grant_hash: b.hash }), store(null), NOW)) as any).reason).toBe('not_found');
    expect(((await resolveGrantBundleFromToken(claims({ ap_grant_ref: undefined }), store(b), NOW)) as any).reason).toBe('grant_ref_missing');
  });
});
