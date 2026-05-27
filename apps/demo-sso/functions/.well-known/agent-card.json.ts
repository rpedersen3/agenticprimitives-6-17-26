// GET /.well-known/agent-card.json — A2A discovery for `<handle>.impact-agent.io`
// (spec 231). Resolves the personal subdomain and proxies to demo-a2a.
import { proxyA2a, type A2aProxyEnv } from '../_lib/a2a-proxy';

export const onRequest = ({ request, env }: { request: Request; env: A2aProxyEnv }): Promise<Response> =>
  proxyA2a(request, env, '/.well-known/agent-card.json');
