// GET /.well-known/agent.json — legacy A2A discovery alias (spec 231).
import { proxyA2a, type A2aProxyEnv } from '../_lib/a2a-proxy';

export const onRequest = ({ request, env }: { request: Request; env: A2aProxyEnv }): Promise<Response> =>
  proxyA2a(request, env, '/.well-known/agent.json');
