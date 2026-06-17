// Protected-resource metadata (spec 277 §6.1 / RFC 9728). Public HTTP MCP
// servers serve this at /.well-known/oauth-protected-resource[/mcp] so clients
// discover the authorization server + scopes.

import type { OAuthProtectedResourceMetadata } from './types.js';

export function createProtectedResourceMetadata(input: {
  resource: string;
  authorizationServers: string[];
  scopesSupported: string[];
  resourceDocumentation?: string;
}): OAuthProtectedResourceMetadata {
  return {
    resource: input.resource,
    authorization_servers: input.authorizationServers,
    scopes_supported: input.scopesSupported,
    bearer_methods_supported: ['header'],
    ...(input.resourceDocumentation ? { resource_documentation: input.resourceDocumentation } : {}),
  };
}

/** Build the `GET /.well-known/oauth-protected-resource` response (Web `Response`). */
export function serveProtectedResourceMetadata(metadata: OAuthProtectedResourceMetadata): Response {
  return new Response(JSON.stringify(metadata), {
    status: 200,
    headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=3600' },
  });
}
