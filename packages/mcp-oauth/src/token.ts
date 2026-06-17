// MCP bearer-token validation (spec 277 §8). The signature/decode is INJECTED
// (`verify` — JWT verification needs the AS's keys/JWKS, which the app wires);
// this module enforces the CLAIM policy: audience/resource, issuer trust, expiry,
// not-before, required scopes, and the presence of the grant reference + hash.
//
// Inbound MCP tokens MUST NOT be reused downstream (use a separate token /
// RFC 8693 exchange). This module returns claims for the grant-bundle bridge; it
// never forwards the token.

import type {
  McpAccessTokenClaims,
  BearerValidation,
  AgenticMcpAuthorizationDetail,
} from './types.js';

export function parseBearer(authorizationHeader: string | null | undefined): string | null {
  if (!authorizationHeader) return null;
  // Linear, backtrack-free split (avoids the `\s+(.+)` overlap → no ReDoS): find the
  // first whitespace run, require scheme `Bearer`, take the rest as the token.
  const h = authorizationHeader.trim();
  const sep = h.search(/\s/);
  if (sep === -1) return null;
  if (h.slice(0, sep).toLowerCase() !== 'bearer') return null;
  const token = h.slice(sep + 1).trim();
  return token.length > 0 ? token : null;
}

export function scopesOf(claims: McpAccessTokenClaims): string[] {
  return claims.scope ? claims.scope.split(/\s+/).filter(Boolean) : [];
}

export function requireMcpAudience(claims: McpAccessTokenClaims, audience: string): boolean {
  return claims.aud === audience || claims.resource === audience;
}

export function requireScopes(claims: McpAccessTokenClaims, required: string[]): { ok: boolean; missing: string[] } {
  const have = new Set(scopesOf(claims));
  const missing = required.filter((s) => !have.has(s));
  return { ok: missing.length === 0, missing };
}

export interface ValidateMcpBearerOpts {
  /** Verify signature + decode → claims (or null if signature/format invalid). INJECTED. */
  verify: (token: string) => Promise<McpAccessTokenClaims | null>;
  audience: string;
  /** When set, the token's `iss` must be in this allowlist. */
  trustedIssuers?: string[];
  /** When set, `client_id` must match. */
  expectedClientId?: string;
  requiredScopes?: string[];
  /** Require the AP grant binding (ref + hash) — true for the delegated vault path. */
  requireGrantBinding?: boolean;
  now?: Date;
}

/** Validate an MCP bearer token's claims after the injected signature check.
 *  Fail-closed: any failed check returns `{ ok:false, reason }`. */
export async function validateMcpBearerToken(token: string | null, opts: ValidateMcpBearerOpts): Promise<BearerValidation> {
  if (!token) return { ok: false, reason: 'missing_token' };
  let claims: McpAccessTokenClaims | null;
  try {
    claims = await opts.verify(token);
  } catch {
    return { ok: false, reason: 'signature_invalid' };
  }
  if (!claims || typeof claims.iss !== 'string' || typeof claims.aud !== 'string') {
    return { ok: false, reason: 'malformed' };
  }

  const now = Math.floor((opts.now ?? new Date()).getTime() / 1000);
  if (typeof claims.exp === 'number' && now >= claims.exp) return { ok: false, reason: 'expired' };
  if (typeof claims.nbf === 'number' && now < claims.nbf) return { ok: false, reason: 'not_yet_valid' };
  if (opts.trustedIssuers && !opts.trustedIssuers.includes(claims.iss)) return { ok: false, reason: 'issuer_untrusted' };
  if (!requireMcpAudience(claims, opts.audience)) return { ok: false, reason: 'audience_mismatch' };
  if (opts.expectedClientId && claims.client_id !== opts.expectedClientId) return { ok: false, reason: 'client_mismatch' };

  if (opts.requiredScopes && opts.requiredScopes.length > 0) {
    const { ok, missing } = requireScopes(claims, opts.requiredScopes);
    if (!ok) return { ok: false, reason: 'insufficient_scope', missingScopes: missing };
  }

  if (opts.requireGrantBinding) {
    if (!claims.ap_grant_ref) return { ok: false, reason: 'grant_ref_missing' };
    if (!claims.ap_grant_hash) return { ok: false, reason: 'grant_hash_missing' };
  }

  return { ok: true, claims, scopes: scopesOf(claims) };
}

// ── §6.3 Rich Authorization Request (authorization_details) ──────────

export function buildAuthorizationDetailsRequest(detail: AgenticMcpAuthorizationDetail): AgenticMcpAuthorizationDetail {
  return { ...detail, type: 'agentic_mcp_tool' };
}

/** Parse + filter an `authorization_details` array to the agentic_mcp_tool entries. */
export function parseAuthorizationDetails(raw: unknown): AgenticMcpAuthorizationDetail[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (d): d is AgenticMcpAuthorizationDetail =>
      !!d && typeof d === 'object' && (d as { type?: unknown }).type === 'agentic_mcp_tool' && typeof (d as { mcp_server?: unknown }).mcp_server === 'string' && typeof (d as { tool?: unknown }).tool === 'string',
  );
}
