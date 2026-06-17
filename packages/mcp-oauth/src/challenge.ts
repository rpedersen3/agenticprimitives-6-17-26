// WWW-Authenticate challenges (spec 277 §6.1 / RFC 9728 §5.1, RFC 6750).
// A 401/403 from a public MCP endpoint points the client at the protected-
// resource metadata + (for 403) the scopes it's missing.

function quote(v: string): string {
  // Escape backslash FIRST, then the quote — otherwise a `\` in the value would
  // corrupt the header / enable header injection (CodeQL: incomplete escaping).
  return `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/** Build a `Bearer …` WWW-Authenticate header value. */
export function createWwwAuthenticateChallenge(input: {
  resourceMetadataUrl?: string;
  error?: 'invalid_token' | 'insufficient_scope' | 'invalid_request';
  errorDescription?: string;
  scope?: string[];
}): string {
  const parts: string[] = [];
  if (input.resourceMetadataUrl) parts.push(`resource_metadata=${quote(input.resourceMetadataUrl)}`);
  if (input.error) parts.push(`error=${quote(input.error)}`);
  if (input.errorDescription) parts.push(`error_description=${quote(input.errorDescription)}`);
  if (input.scope && input.scope.length > 0) parts.push(`scope=${quote(input.scope.join(' '))}`);
  return parts.length > 0 ? `Bearer ${parts.join(', ')}` : 'Bearer';
}

/** A 401 challenge when no/invalid token was presented. */
export function buildUnauthorizedResponse(input: { resourceMetadataUrl?: string; errorDescription?: string }): Response {
  return new Response(JSON.stringify({ error: 'invalid_token', error_description: input.errorDescription ?? 'authentication required' }), {
    status: 401,
    headers: {
      'content-type': 'application/json',
      'www-authenticate': createWwwAuthenticateChallenge({ resourceMetadataUrl: input.resourceMetadataUrl, error: 'invalid_token', errorDescription: input.errorDescription }),
    },
  });
}

/** A 403 `insufficient_scope` response naming the scopes the token is missing. */
export function buildInsufficientScopeResponse(input: { missingScopes: string[]; resourceMetadataUrl?: string }): Response {
  return new Response(
    JSON.stringify({ error: 'insufficient_scope', error_description: `missing scope(s): ${input.missingScopes.join(' ')}`, scope: input.missingScopes.join(' ') }),
    {
      status: 403,
      headers: {
        'content-type': 'application/json',
        'www-authenticate': createWwwAuthenticateChallenge({ resourceMetadataUrl: input.resourceMetadataUrl, error: 'insufficient_scope', scope: input.missingScopes }),
      },
    },
  );
}
