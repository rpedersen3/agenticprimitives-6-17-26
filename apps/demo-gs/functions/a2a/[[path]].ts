/**
 * Pages Function — proxies /a2a/* to the deployed demo-a2a Worker (spec 252: demo-gs reuses demo-a2a
 * for SA deploy + the per-agent vault relayer rather than re-porting it). Same pattern as demo-jp.
 *
 * The demo-a2a Worker URL is bound via `env.DEMO_A2A_URL`:
 *   echo -n https://demo-a2a-production.<acct>.workers.dev | \
 *     wrangler pages secret put DEMO_A2A_URL --project-name=agenticprimitives-demo-gs
 *
 * The browser uses relative fetch('/a2a/...') so prod matches Vite's dev proxy.
 */

interface Env {
  DEMO_A2A_URL: string;
}

export const onRequest = async ({ request, env }: { request: Request; env: Env }): Promise<Response> => {
  if (!env.DEMO_A2A_URL) {
    return new Response(
      JSON.stringify({
        error: 'DEMO_A2A_URL not configured on the Pages project.',
        hint: 'wrangler pages secret put DEMO_A2A_URL --project-name=agenticprimitives-demo-gs',
      }),
      { status: 503, headers: { 'content-type': 'application/json' } },
    );
  }

  const incoming = new URL(request.url);
  const upstreamPath = incoming.pathname.replace(/^\/a2a/, '') || '/';
  const upstreamUrl = new URL(upstreamPath + incoming.search, env.DEMO_A2A_URL);

  // `new Request(url, request)` copies method/headers/body. The Origin header flows through so
  // demo-a2a's ALLOWED_ORIGINS check sees the real Pages origin.
  return fetch(new Request(upstreamUrl.toString(), request));
};
