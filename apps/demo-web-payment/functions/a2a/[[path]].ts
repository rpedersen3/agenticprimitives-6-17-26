/**
 * Pages Function — proxies /a2a/* to the demo-a2a Worker (the prod analog of the
 * vite dev proxy in vite.config.ts).
 *
 * The browser fetches relative `/a2a/...` paths (rpc + csrf + session deploy), so
 * the call is same-origin → no browser CORS. Server-side here we rewrite the
 * Origin/Referer to an ALREADY allow-listed origin (demo-web-pro's Pages URL) so
 * the Worker's CORS + origin-bound CSRF gates accept the hop WITHOUT adding this
 * app's own Pages URL to the Worker's ALLOWED_ORIGINS. One origin, consistent for
 * the /auth/csrf mint and the POST verify (CSRF is token-only, no cookie).
 *
 * `env.DEMO_A2A_URL` (the Worker URL) is bound as a Pages secret at deploy time:
 *   echo -n $URL | wrangler pages secret put DEMO_A2A_URL --project-name=...
 */

interface Env {
  DEMO_A2A_URL: string;
  PROXY_ORIGIN?: string;
}

const DEFAULT_ALLOWLISTED_ORIGIN = 'https://agenticprimitives-demo-pro.pages.dev';

export const onRequest = async (ctx: {
  request: Request;
  env: Env;
}): Promise<Response> => {
  const { request, env } = ctx;
  if (!env.DEMO_A2A_URL) {
    return new Response(
      JSON.stringify({
        error: 'DEMO_A2A_URL not configured on the Pages project.',
        hint: 'wrangler pages secret put DEMO_A2A_URL --project-name=agenticprimitives-demo-payment',
      }),
      { status: 503, headers: { 'content-type': 'application/json' } },
    );
  }

  const incoming = new URL(request.url);
  const upstreamPath = incoming.pathname.replace(/^\/a2a/, '') || '/';
  const upstreamUrl = new URL(upstreamPath + incoming.search, env.DEMO_A2A_URL);

  const allowlisted = env.PROXY_ORIGIN || DEFAULT_ALLOWLISTED_ORIGIN;
  const headers = new Headers(request.headers);
  headers.set('origin', allowlisted);
  headers.set('referer', `${allowlisted}/`);
  headers.delete('host'); // let fetch set the upstream host

  const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
  return fetch(upstreamUrl.toString(), {
    method: request.method,
    headers,
    body: hasBody ? request.body : undefined,
    redirect: 'manual',
    // streamed bodies require half-duplex on the Workers runtime
    ...(hasBody ? { duplex: 'half' } : {}),
  } as RequestInit);
};
