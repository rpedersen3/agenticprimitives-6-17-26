# @agenticprimitives/mcp-oauth

MCP **OAuth compatibility** adapter + **Agentic Grant Bundle** bridge (spec 277). OAuth is an ingress
adapter for public HTTP MCP clients — **not** the vault authority. A validated token references a grant
bundle by id+hash; the normal delegated vault path runs off the bundle.

```ts
import { validateMcpBearerToken, resolveGrantBundleFromToken, buildInsufficientScopeResponse } from '@agenticprimitives/mcp-oauth';

const v = await validateMcpBearerToken(parseBearer(req.headers.get('authorization')), {
  verify: (tok) => jwks.verify(tok),          // injected: signature + decode → claims
  audience: 'https://mcp.example.com/mcp',
  requiredScopes: ['mcp:invoke', 'vault:pii:read'],
  requireGrantBinding: true,
});
if (!v.ok) return v.reason === 'insufficient_scope'
  ? buildInsufficientScopeResponse({ missingScopes: v.missingScopes!, resourceMetadataUrl })
  : buildUnauthorizedResponse({ resourceMetadataUrl });

const r = await resolveGrantBundleFromToken(v.claims, grantBundleStore);  // store injected
// r.bundle → delegation/entitlement hashes → normal delegated vault path
```

Dependency-free + runtime-agnostic. The authorization server, JWT/JWKS verification, and the encrypted
grant-bundle store live in the app/runtime. An inbound MCP token is never reused downstream. See
[spec 277 §6–§8, §15](../../specs/277-mcp-delegated-vault-authorization.md).
