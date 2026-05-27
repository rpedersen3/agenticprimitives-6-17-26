// /api/a2a/* — A2A JSON-RPC message endpoint for `<handle>.impact-agent.io`
// (spec 231). Proxies to demo-a2a with the personal-subdomain context injected.
import { proxyA2a, type A2aProxyEnv } from '../../_lib/a2a-proxy';

export const onRequest = ({ request, env }: { request: Request; env: A2aProxyEnv }): Promise<Response> => {
  // Pass the incoming path through verbatim (`/api/a2a` or `/api/a2a/...`).
  const path = new URL(request.url).pathname;
  return proxyA2a(request, env, path);
};
