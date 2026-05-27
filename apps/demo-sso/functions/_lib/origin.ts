// Issuer-origin resolution behind the `*.impact-agent.io` subdomain-router
// Worker (spec 231 / Option 2). The router proxies a person's subdomain
// (`alice.impact-agent.io`) to this pages.dev origin, so `new URL(request.url)
// .origin` here would read the pages.dev host — wrong for the per-person OP
// issuer (spec 230: `iss` MUST equal the serving subdomain).
//
// The router forwards the real host as `X-Forwarded-Host` + a shared
// `X-Proxy-Secret`. We trust `X-Forwarded-Host` ONLY when the secret matches —
// otherwise a request straight to `<project>.pages.dev` could spoof the issuer
// for any handle. With no secret configured (apex / direct pages.dev / local
// dev), we fall back to the real request origin, which is already correct.

export function resolveOrigin(request: Request, env: { PROXY_SHARED_SECRET?: string }): string {
  const fwdHost = request.headers.get('x-forwarded-host');
  const presented = request.headers.get('x-proxy-secret');
  if (fwdHost && env.PROXY_SHARED_SECRET && presented === env.PROXY_SHARED_SECRET) {
    // Single label only (alice.impact-agent.io) — defensive parse, https only.
    if (/^[a-z0-9.-]+$/i.test(fwdHost)) return `https://${fwdHost}`;
  }
  return new URL(request.url).origin;
}
