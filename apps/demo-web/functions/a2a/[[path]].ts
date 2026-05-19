/**
 * Pages Function — proxies /a2a/* to the demo-a2a Worker.
 *
 * Pages `_redirects` with status 200 to an EXTERNAL origin is silently
 * ignored; only same-origin rewrites (typically for SPA fallback) are
 * supported. Cross-origin proxying requires a Function.
 *
 * The demo-a2a Worker URL is bound via `env.DEMO_A2A_URL`, set by
 * `scripts/deploy-cloudflare.ts` immediately after the demo-a2a deploy:
 *   echo -n $URL | wrangler pages secret put DEMO_A2A_URL --project-name=...
 *
 * Why not direct browser → demo-a2a calls? The frontend uses relative
 * fetch('/a2a/...') paths throughout (siwe-flow.ts, authorize-flow.ts,
 * read-profile-flow.ts, App.tsx). Refactoring to absolute URLs would
 * touch many call sites; a proxy keeps the frontend identical to local
 * dev where Vite's proxy serves the same role.
 */

interface Env {
  DEMO_A2A_URL: string;
}

export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  if (!env.DEMO_A2A_URL) {
    return new Response(
      JSON.stringify({
        error: 'DEMO_A2A_URL not configured on the Pages project.',
        hint: 'Run `pnpm deploy:cloudflare`, or `wrangler pages secret put DEMO_A2A_URL`.',
      }),
      { status: 503, headers: { 'content-type': 'application/json' } },
    );
  }

  const incoming = new URL(request.url);
  const upstreamPath = incoming.pathname.replace(/^\/a2a/, '') || '/';
  const upstreamUrl = new URL(upstreamPath + incoming.search, env.DEMO_A2A_URL);

  // `new Request(url, request)` copies method/headers/body. The Origin
  // header (set by the browser) flows through unchanged so the demo-a2a
  // Worker's ALLOWED_ORIGINS check sees the real Pages origin.
  return fetch(new Request(upstreamUrl.toString(), request));
};
