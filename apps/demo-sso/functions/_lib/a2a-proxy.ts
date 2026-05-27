// A2A-by-subdomain proxy (spec 231). demo-sso (Pages) owns the
// `*.impact-agent.io` origin; the A2A agent logic lives in demo-a2a. These
// Functions resolve the personal subdomain from the request Host and forward
// the A2A paths to demo-a2a, injecting:
//   X-Agent-Subdomain  — the resolved label (e.g. "alice")
//   X-Public-Origin    — the public endpoint (https://alice.impact-agent.io)
// so the card advertises the public URL, not the workers.dev origin.
import { parseAgentSubdomain, personalAuthOrigin } from '../../src/lib/host';

export interface A2aProxyEnv {
  DEMO_A2A_URL: string;
}

/** Forward an A2A request to demo-a2a with personal-subdomain context injected.
 *  `upstreamPath` is the demo-a2a path to hit (e.g. `/.well-known/agent-card.json`
 *  or the incoming `/api/a2a/...`). */
export async function proxyA2a(request: Request, env: A2aProxyEnv, upstreamPath: string): Promise<Response> {
  if (!env.DEMO_A2A_URL) {
    return new Response(JSON.stringify({ error: 'DEMO_A2A_URL not configured on the Pages project.' }), {
      status: 503,
      headers: { 'content-type': 'application/json' },
    });
  }
  const incoming = new URL(request.url);
  const label = parseAgentSubdomain(incoming.hostname);
  const upstream = new URL(upstreamPath + incoming.search, env.DEMO_A2A_URL);

  const headers = new Headers(request.headers);
  if (label) {
    headers.set('x-agent-subdomain', label);
    headers.set('x-public-origin', personalAuthOrigin(label));
  } else {
    // Apex / non-subdomain → generic endpoint; ensure no stale injected header.
    headers.delete('x-agent-subdomain');
    headers.delete('x-public-origin');
  }

  // Buffer the body (A2A JSON-RPC payloads are small) to avoid Workers'
  // streamed-body `duplex: 'half'` requirement.
  const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
  const body = hasBody ? await request.arrayBuffer() : undefined;
  return fetch(upstream.toString(), { method: request.method, headers, body });
}
