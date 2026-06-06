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
  const res = await fetch(new Request(upstreamUrl.toString(), request));

  // demo-a2a also serves DIRECT cross-site callers (demo-web-pro), so it sets the CSRF cookie
  // `SameSite=None`. But the browser reaches demo-a2a SAME-ORIGIN through this /a2a/* proxy, where
  // `None` is unnecessary AND is dropped by Chrome's third-party-cookie blocking — so `agentic-csrf`
  // never sticks and every mutating request (vault get/set) storms `403 csrf required`. Downgrade the
  // proxied cookie to `SameSite=Lax`: correct for a same-origin proxy, never 3p-blocked, and still sent
  // on every same-origin /a2a/* request.
  const hdr = res.headers as Headers & { getSetCookie?: () => string[] };
  const cookies = hdr.getSetCookie?.() ?? (res.headers.get('set-cookie') ? [res.headers.get('set-cookie') as string] : []);
  if (cookies.some((c) => /SameSite=None/i.test(c))) {
    const headers = new Headers(res.headers);
    headers.delete('set-cookie');
    for (const c of cookies) headers.append('set-cookie', c.replace(/;\s*SameSite=None/gi, '; SameSite=Lax'));
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
  }
  return res;
};
